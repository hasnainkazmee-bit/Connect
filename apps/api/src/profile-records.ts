import { Router } from "express";
import { z } from "zod";
import { pool, HttpError } from "./db.js";
import { requireAdmin } from "./auth.js";

export const optionalPublicUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    if (!value) return true;
    try {
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "Use a public HTTPS link.")
  .default("");
const date = z.iso.date().nullable().default(null);
const name = z.string().trim().min(2).max(180);
const licenseInput = z
  .object({
    expectedCompanyId: z.uuid().optional(),
    licenseType: name,
    licenseNumber: z.string().trim().min(1).max(100),
    authority: name,
    jurisdiction: name,
    holder: name,
    classification: z.string().trim().max(120).default(""),
    issuedOn: date,
    expiresOn: date,
    doesNotExpire: z.boolean().default(false),
    verificationUrl: optionalPublicUrl,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.issuedOn && v.expiresOn && v.expiresOn < v.issuedOn)
      ctx.addIssue({
        code: "custom",
        path: ["expiresOn"],
        message: "Expiry date must be on or after the issue date.",
      });
    if (v.doesNotExpire && v.expiresOn)
      ctx.addIssue({
        code: "custom",
        path: ["expiresOn"],
        message: "Remove the expiry date for a license that does not expire.",
      });
  });
const insuranceInput = z
  .object({
    expectedCompanyId: z.uuid().optional(),
    coverageType: name,
    insurer: name,
    coverageLimit: z
      .number()
      .positive()
      .max(1e12)
      .refine(
        (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.001,
        "Use no more than two decimal places.",
      )
      .nullable(),
    currency: z.enum(["USD", "CAD"]).default("USD"),
    limitBasis: z
      .enum(["", "per_occurrence", "aggregate", "statutory"])
      .default(""),
    expiresOn: z.iso.date(),
    verificationUrl: optionalPublicUrl,
  })
  .strict();

export const workSettingsInput = z
  .object({
    availability: z.enum([
      "",
      "accepting",
      "from_date",
      "limited",
      "unavailable",
    ]),
    availableFrom: date,
    crewCount: z.number().int().min(1).max(10000).nullable(),
    peoplePerCrew: z.number().int().min(1).max(1000).nullable(),
    capacityQuantity: z.number().positive().max(1e8).nullable(),
    capacityUnit: z.enum(["projects", "systems", "kW", "MW"]),
    capacityPeriod: z.enum(["week", "month"]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.availability === "from_date" && !v.availableFrom)
      ctx.addIssue({
        code: "custom",
        path: ["availableFrom"],
        message: "Choose the date you can start.",
      });
    if (v.availability !== "from_date" && v.availableFrom)
      ctx.addIssue({
        code: "custom",
        path: ["availableFrom"],
        message: "A start date is only needed when available from a date.",
      });
    if (
      ["projects", "systems"].includes(v.capacityUnit) &&
      v.capacityQuantity !== null &&
      !Number.isInteger(v.capacityQuantity)
    )
      ctx.addIssue({
        code: "custom",
        path: ["capacityQuantity"],
        message: "Use a whole number for projects or systems.",
      });
  });
export function workLabels(w: z.infer<typeof workSettingsInput>) {
  return {
    availability:
      w.availability === "from_date"
        ? `Available from ${w.availableFrom}`
        : (
            {
              "": "",
              accepting: "Accepting new work",
              limited: "Limited availability",
              unavailable: "Not taking new work",
            } as Record<string, string>
          )[w.availability],
    crewSize: [
      w.crewCount
        ? `${w.crewCount} ${w.crewCount === 1 ? "crew" : "crews"}`
        : "",
      w.peoplePerCrew ? `${w.peoplePerCrew} people per crew` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    capacity: w.capacityQuantity
      ? `Up to ${w.capacityQuantity} ${w.capacityUnit} per ${w.capacityPeriod}`
      : "",
  };
}

export function profileRecordRoutes() {
  const router = Router();
  for (const kind of ["licenses", "insurance"] as const) {
    // Both table names and column lists are fixed application constants.
    const table =
      kind === "licenses" ? "company_licenses" : "company_insurance";
    const schema = kind === "licenses" ? licenseInput : insuranceInput;
    const columns =
      kind === "licenses"
        ? [
            "license_type",
            "license_number",
            "authority",
            "jurisdiction",
            "holder",
            "classification",
            "issued_on",
            "expires_on",
            "does_not_expire",
            "verification_url",
          ]
        : [
            "coverage_type",
            "insurer",
            "coverage_limit",
            "currency",
            "limit_basis",
            "expires_on",
            "verification_url",
          ];
    const returning =
      kind === "licenses"
        ? "*,issued_on::text AS issued_on,expires_on::text AS expires_on"
        : "*,coverage_limit::float AS coverage_limit,expires_on::text AS expires_on";
    for (const method of ["post", "patch"] as const)
      router[method](
        `/companies/current/${kind}${method === "patch" ? "/:id" : ""}`,
        requireAdmin,
        async (req, res) => {
          const b = schema.parse(req.body);
          if (
            b.expectedCompanyId &&
            b.expectedCompanyId !== req.auth!.companyId
          )
            throw new HttpError(
              409,
              "Your active company changed. Open the correct company before saving.",
            );
          const data = Object.fromEntries(
            Object.entries(b).map(([key, value]) => [
              key.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase()),
              value,
            ]),
          );
          const values = columns.map((c) => data[c]);
          let rows;
          if (method === "post")
            ({ rows } = await pool.query(
              `INSERT INTO ${table}(company_id,${columns.join(",")}) VALUES($1,${columns.map((_, i) => "$" + (i + 2)).join(",")}) RETURNING ${returning}`,
              [req.auth!.companyId, ...values],
            ));
          else
            ({ rows } = await pool.query(
              `UPDATE ${table} SET ${columns.map((c, i) => `${c}=$${i + 1}`).join(",")},updated_at=now() WHERE company_id=$${values.length + 1} AND id=$${values.length + 2} RETURNING ${returning}`,
              [...values, req.auth!.companyId, z.uuid().parse(req.params.id)],
            ));
          if (!rows[0]) throw new HttpError(404, "This record was not found.");
          res.status(method === "post" ? 201 : 200).json(rows[0]);
        },
      );
    router.delete(
      `/companies/current/${kind}/:id`,
      requireAdmin,
      async (req, res) => {
        const { rowCount } = await pool.query(
          `DELETE FROM ${table} WHERE id=$1 AND company_id=$2`,
          [z.uuid().parse(req.params.id), req.auth!.companyId],
        );
        if (!rowCount) throw new HttpError(404, "This record was not found.");
        res.json({ ok: true });
      },
    );
  }
  return router;
}
