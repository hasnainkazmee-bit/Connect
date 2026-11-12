import { Router } from "express";
import { z } from "zod";
import { pool, HttpError } from "./db.js";
import { requireAdmin } from "./auth.js";
import { optionalPublicUrl } from "./profile-records.js";

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
    sourceUrl: optionalPublicUrl,
    expectedCompanyId: z.uuid().optional(),
    credentialNumber: z.string().trim().max(100).default(""),
    issuedOn: z.iso.date().nullable().default(null),
    doesNotExpire: z.boolean().default(false),
    period: z.string().trim().max(100).default(""),
    validUntil: z.iso.date().nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.issuedOn && v.validUntil && v.validUntil < v.issuedOn)
      ctx.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "Expiry date must be on or after the issue date.",
      });
    if (v.doesNotExpire && v.validUntil)
      ctx.addIssue({
        code: "custom",
        path: ["validUntil"],
        message:
          "Remove the expiry date for a certification that does not expire.",
      });
  });

export function credentialRoutes() {
  const router = Router();
  router.post(
    "/companies/current/credentials",
    requireAdmin,
    async (req, res) => {
      const b = credentialInput.parse(req.body);
      if (b.expectedCompanyId && b.expectedCompanyId !== req.auth!.companyId)
        throw new HttpError(
          409,
          "Your active company changed. Open the correct company before saving.",
        );
      // A company submission is never promoted to operator-reviewed evidence.
      const { rows } = await pool.query(
        `INSERT INTO company_credentials(company_id,category,title,organization,scope,scope_detail,description,source_url,evidence_basis,period,valid_until,credential_number,issued_on,does_not_expire)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'company',$9,$10,$11,$12,$13) RETURNING *,valid_until::text AS valid_until,issued_on::text AS issued_on`,
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
          b.credentialNumber,
          b.issuedOn,
          b.doesNotExpire,
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
      if (b.expectedCompanyId && b.expectedCompanyId !== req.auth!.companyId)
        throw new HttpError(
          409,
          "Your active company changed. Open the correct company before saving.",
        );
      const { rows } = await pool.query(
        `UPDATE company_credentials SET category=$1,title=$2,organization=$3,scope=$4,scope_detail=$5,description=$6,source_url=$7,period=$8,valid_until=$9,credential_number=$10,issued_on=$11,does_not_expire=$12,updated_at=now()
       WHERE id=$13 AND company_id=$14 AND catalog_key IS NULL RETURNING *,valid_until::text AS valid_until,issued_on::text AS issued_on`,
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
          b.credentialNumber,
          b.issuedOn,
          b.doesNotExpire,
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
