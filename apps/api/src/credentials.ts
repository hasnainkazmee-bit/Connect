import { Router } from "express";
import { z } from "zod";
import { pool, HttpError } from "./db.js";
import { requireAdmin } from "./auth.js";

export const credentialInput = z
  .object({
    category: z.enum([
      "certification",
      "qualification",
      "ranking",
      "directory",
      "membership",
    ]),
    title: z.string().trim().min(2).max(180),
    organization: z.string().trim().max(180).default(""),
    scope: z.enum(["company", "product", "personnel"]),
    scopeDetail: z.string().trim().min(2).max(600),
    description: z.string().trim().max(1200).default(""),
    sourceUrl: z
      .string()
      .max(2000)
      .url()
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password;
      }, "Use a public HTTPS source URL."),
    period: z.string().trim().max(100).default(""),
    validUntil: z.iso.date().nullable().default(null),
  })
  .strict();

export function credentialRoutes() {
  const router = Router();
  router.post(
    "/companies/current/credentials",
    requireAdmin,
    async (req, res) => {
      const b = credentialInput.parse(req.body);
      // A company submission is never promoted to operator-reviewed evidence.
      const { rows } = await pool.query(
        `INSERT INTO company_credentials(company_id,category,title,organization,scope,scope_detail,description,source_url,evidence_basis,period,valid_until)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'company',$9,$10) RETURNING *,valid_until::text AS valid_until`,
        [
          req.auth!.companyId,
          b.category,
          b.title,
          b.organization,
          b.scope,
          b.scopeDetail,
          b.description,
          b.sourceUrl,
          b.period,
          b.validUntil,
        ],
      );
      res.status(201).json(rows[0]);
    },
  );
  router.patch(
    "/companies/current/credentials/:id",
    requireAdmin,
    async (req, res) => {
      const id = z.string().uuid().parse(req.params.id);
      const b = credentialInput.parse(req.body);
      const { rows } = await pool.query(
        `UPDATE company_credentials SET category=$1,title=$2,organization=$3,scope=$4,scope_detail=$5,description=$6,source_url=$7,period=$8,valid_until=$9,updated_at=now()
       WHERE id=$10 AND company_id=$11 AND catalog_key IS NULL RETURNING *,valid_until::text AS valid_until`,
        [
          b.category,
          b.title,
          b.organization,
          b.scope,
          b.scopeDetail,
          b.description,
          b.sourceUrl,
          b.period,
          b.validUntil,
          id,
          req.auth!.companyId,
        ],
      );
      if (!rows[0])
        throw new HttpError(
          404,
          "Company-added credential not found. Sourced records are maintained by Connect.",
        );
      res.json(rows[0]);
    },
  );
  router.delete(
    "/companies/current/credentials/:id",
    requireAdmin,
    async (req, res) => {
      const { rowCount } = await pool.query(
        "DELETE FROM company_credentials WHERE id=$1 AND company_id=$2 AND catalog_key IS NULL",
        [z.string().uuid().parse(req.params.id), req.auth!.companyId],
      );
      if (!rowCount)
        throw new HttpError(
          404,
          "Company-added credential not found. Sourced records are maintained by Connect.",
        );
      res.json({ ok: true });
    },
  );
  return router;
}
