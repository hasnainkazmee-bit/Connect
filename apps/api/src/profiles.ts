import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import type { PoolClient } from "pg";
import { pool, tx, HttpError } from "./db.js";
import { requireAdmin, requireVerified } from "./auth.js";
import { checkQuota, storeBuffer, sendStored, deferDelete } from "./storage.js";
import { preventDuplicateCompany } from "./directory.js";

const uuid = z.string().uuid();
const reserved = new Set([
  "www",
  "app",
  "api",
  "admin",
  "administrator",
  "support",
  "help",
  "login",
  "signup",
  "register",
  "mail",
  "email",
  "static",
  "assets",
  "connect",
  "sunhub",
  "sunhubconnect",
  "settings",
  "account",
  "security",
  "status",
  "billing",
  "legal",
  "privacy",
  "terms",
  "cdn",
  "images",
  "media",
  "files",
  "auth",
  "oauth",
  "directory",
  "company",
  "invite",
  "join",
  "requests",
  "onboarding",
  "notifications",
  "session",
  "team",
  "mobile",
  "health",
  "ready",
  "uploads",
  "network",
  "messages",
  "posts",
  "write",
  "reviews",
  "test",
  "staging",
  "localhost",
  "claim",
  "sitemap.xml",
  "robots.txt",
]);
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(
    /^[a-z][a-z0-9-]*[a-z0-9]$/,
    "Use 3–30 letters, numbers, or hyphens; begin with a letter.",
  )
  .refine((v) => !reserved.has(v), "This username is reserved.");
export async function claimUsername(
  db: PoolClient,
  companyId: string,
  username: string,
) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,2))", [
    username,
  ]);
  const taken = await db.query(
    `SELECT 1 FROM companies WHERE (username=$1 OR slug=$1) AND id<>$2 UNION ALL SELECT 1 FROM company_username_history WHERE username=$1 AND company_id<>$2`,
    [username, companyId],
  );
  if (taken.rowCount)
    throw new HttpError(409, "That username is taken. Try another.");
  await db.query(
    "INSERT INTO company_username_history(username,company_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [username, companyId],
  );
  await db.query("UPDATE companies SET username=$1 WHERE id=$2", [
    username,
    companyId,
  ]);
}
export async function ensureUsername(
  db: PoolClient,
  companyId: string,
  name: string,
) {
  const current = (
    await db.query("SELECT username FROM companies WHERE id=$1 FOR UPDATE", [
      companyId,
    ])
  ).rows[0]?.username;
  if (current) return current as string;
  let base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");
  if (!/^[a-z]/.test(base))
    base = ("company-" + base).slice(0, 24).replace(/-+$/, "");
  if (base.length < 3 || reserved.has(base)) base += "-company";
  for (let number = 1; number <= 1000; number++) {
    const candidate =
      base.slice(0, 24).replace(/-+$/, "") + (number === 1 ? "" : "-" + number);
    try {
      await claimUsername(db, companyId, candidate);
      return candidate;
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409) throw error;
    }
  }
  throw new HttpError(
    409,
    "Please choose a unique company username in your profile.",
  );
}
const reviewVisible = `NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=r.user_id AND m.company_id=r.company_id)`;
export async function profileExtras(companyId: string) {
  const [achievements, reviews] = await Promise.all([
    pool.query(
      "SELECT * FROM company_achievements WHERE company_id=$1 ORDER BY year DESC NULLS LAST,created_at DESC",
      [companyId],
    ),
    pool.query(
      `SELECT count(*)::int AS count,round(avg(rating),1)::float AS average,json_build_array(count(*) FILTER(WHERE rating=5),count(*) FILTER(WHERE rating=4),count(*) FILTER(WHERE rating=3),count(*) FILTER(WHERE rating=2),count(*) FILTER(WHERE rating=1)) AS bins FROM company_reviews r WHERE company_id=$1 AND ${reviewVisible}`,
      [companyId],
    ),
  ]);
  const stats = reviews.rows[0];
  const distribution = [5, 4, 3, 2, 1].map((rating, index) => ({
    rating,
    count: Number(stats.bins[index]),
  }));
  return {
    achievements: achievements.rows,
    rating: { average: stats.average, count: stats.count, distribution },
  };
}
export function profileRoutes() {
  const router = Router();
  router.get("/site", async (req, res) => {
    const appOrigin = process.env.APP_ORIGIN || "http://localhost:5173";
    const profileDomain =
      process.env.PROFILE_DOMAIN || new URL(appOrigin).hostname;
    const hostname = req.hostname.toLowerCase();
    const prefix = hostname.endsWith("." + profileDomain)
      ? hostname.slice(0, -profileDomain.length - 1)
      : null;
    const profileUsername =
      prefix && usernameSchema.safeParse(prefix).success ? prefix : null;
    res.json({
      appOrigin,
      profileDomain,
      subdomainsEnabled: process.env.PROFILE_SUBDOMAINS_ENABLED === "true",
      profileUsername,
    });
  });
  router.patch("/companies/current/profile", requireAdmin, async (req, res) => {
    const b = z
      .object({
        name: z.string().trim().min(2).max(120),
        username: usernameSchema.optional(),
        tagline: z.string().trim().max(200),
        description: z.string().trim().max(3000),
        type: z.enum([
          "Installer",
          "EPC",
          "Developer",
          "Distributor",
          "Manufacturer",
          "Service provider",
        ]),
        location: z.string().trim().max(160),
        services: z.array(z.string().trim().min(1).max(80)).max(30),
        service_areas: z.array(z.string().trim().min(1).max(60)).max(30),
        audiences: z
          .array(z.enum(["Residential", "Commercial", "Utility-scale"]))
          .max(3)
          .optional(),
        phone: z
          .string()
          .trim()
          .max(40)
          .regex(/^[+\d\s().-]*$/, "Use a phone number.")
          .optional(),
        website: z
          .string()
          .max(2000)
          .refine(
            (v) =>
              !v || (/^https?:\/\//.test(v) && z.url().safeParse(v).success),
          ),
        employee_count: z.enum([
          "",
          "1–10",
          "11–50",
          "51–200",
          "201–500",
          "501–1,000",
          "1,000+",
        ]),
        established: z
          .number()
          .int()
          .min(1800)
          .max(new Date().getFullYear())
          .nullable(),
      })
      .parse(req.body);
    await tx(async (db) => {
      await preventDuplicateCompany(db, b.name, req.auth!.companyId!);
      await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        req.auth!.companyId,
      ]);
      if (b.username) await claimUsername(db, req.auth!.companyId!, b.username);
      await db.query(
        "UPDATE companies SET name=$1,tagline=$2,description=$3,type=$4,location=$5,services=$6,service_areas=$7,website=$8,employee_count=$9,established=$10 WHERE id=$11",
        [
          b.name,
          b.tagline,
          b.description,
          b.type,
          b.location,
          b.services,
          b.service_areas,
          b.website,
          b.employee_count,
          b.established,
          req.auth!.companyId,
        ],
      );
      await db.query(
        "UPDATE companies SET audiences=COALESCE($1::text[],audiences),phone=COALESCE($2,phone) WHERE id=$3",
        [b.audiences ?? null, b.phone ?? null, req.auth!.companyId],
      );
    });
    res.json({ ok: true });
  });
  router.get("/usernames/:username", async (req, res) => {
    const username = usernameSchema.parse(req.params.username);
    const r = await pool.query(
      "SELECT 1 FROM companies WHERE (username=$1 OR slug=$1) AND id IS DISTINCT FROM $2 UNION ALL SELECT 1 FROM company_username_history WHERE username=$1 AND company_id IS DISTINCT FROM $2",
      [username, req.auth?.companyId || null],
    );
    res.json({ username, available: !r.rowCount });
  });
  router.put("/companies/current/username", requireAdmin, async (req, res) => {
    const username = usernameSchema.parse(req.body.username);
    await tx((db) => claimUsername(db, req.auth!.companyId!, username));
    res.json({ username });
  });
  router.patch("/companies/current/details", requireAdmin, async (req, res) => {
    const b = z
      .object({
        employeeCount: z.enum([
          "",
          "1–10",
          "11–50",
          "51–200",
          "201–500",
          "501–1,000",
          "1,000+",
        ]),
        established: z
          .number()
          .int()
          .min(1800)
          .max(new Date().getFullYear())
          .nullable(),
      })
      .parse(req.body);
    await pool.query(
      "UPDATE companies SET employee_count=$1,established=$2 WHERE id=$3",
      [b.employeeCount, b.established, req.auth!.companyId],
    );
    res.json({ ok: true });
  });
  const achievement = z.object({
    title: z.string().trim().min(2).max(150),
    issuer: z.string().trim().max(150).default(""),
    year: z
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear() + 1)
      .nullable()
      .default(null),
    description: z.string().trim().max(2000).default(""),
    url: z
      .string()
      .max(2000)
      .refine(
        (v) => !v || (/^https?:\/\//.test(v) && z.url().safeParse(v).success),
      )
      .default(""),
  });
  router.post(
    "/companies/current/achievements",
    requireAdmin,
    async (req, res) => {
      const b = achievement.parse(req.body);
      const { rows } = await pool.query(
        "INSERT INTO company_achievements(company_id,title,issuer,year,description,url) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [req.auth!.companyId, b.title, b.issuer, b.year, b.description, b.url],
      );
      res.status(201).json(rows[0]);
    },
  );
  router.patch(
    "/companies/current/achievements/:id",
    requireAdmin,
    async (req, res) => {
      const b = achievement.parse(req.body);
      const { rows } = await pool.query(
        "UPDATE company_achievements SET title=$1,issuer=$2,year=$3,description=$4,url=$5 WHERE id=$6 AND company_id=$7 RETURNING *",
        [
          b.title,
          b.issuer,
          b.year,
          b.description,
          b.url,
          uuid.parse(req.params.id),
          req.auth!.companyId,
        ],
      );
      if (!rows.length) throw new HttpError(404, "Achievement not found.");
      res.json(rows[0]);
    },
  );
  router.delete(
    "/companies/current/achievements/:id",
    requireAdmin,
    async (req, res) => {
      const r = await pool.query(
        "DELETE FROM company_achievements WHERE id=$1 AND company_id=$2",
        [uuid.parse(req.params.id), req.auth!.companyId],
      );
      if (!r.rowCount) throw new HttpError(404, "Achievement not found.");
      res.json({ ok: true });
    },
  );
  const portfolio = z.object({
    name: z.string().trim().min(2).max(150),
    description: z.string().trim().max(3000).default(""),
    location: z.string().trim().max(160).default(""),
    size: z.string().trim().max(100).default(""),
    completedYear: z
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear() + 5)
      .nullable()
      .default(null),
    imageUrl: z
      .string()
      .regex(
        /^(|\/api\/company-assets\/[a-f0-9-]{36}|\/assets\/[a-zA-Z0-9._-]+)$/,
      )
      .default(""),
    url: z
      .string()
      .max(2000)
      .refine(
        (v) => !v || (/^https?:\/\//.test(v) && z.url().safeParse(v).success),
      )
      .default(""),
  });
  async function ownImage(url: string, companyId: string) {
    if (
      url.startsWith("/api/") &&
      !(
        await pool.query(
          "SELECT 1 FROM company_assets WHERE id=$1 AND company_id=$2",
          [url.split("/").pop(), companyId],
        )
      ).rowCount
    )
      throw new HttpError(400, "Choose an image uploaded by your company.");
  }
  router.post(
    "/companies/current/portfolio",
    requireAdmin,
    async (req, res) => {
      const b = portfolio.parse(req.body);
      await ownImage(b.imageUrl, req.auth!.companyId!);
      const { rows } = await pool.query(
        "INSERT INTO projects(company_id,name,description,location,size,completed_year,image_url,url) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          req.auth!.companyId,
          b.name,
          b.description,
          b.location,
          b.size,
          b.completedYear,
          b.imageUrl,
          b.url,
        ],
      );
      res.status(201).json(rows[0]);
    },
  );
  router.patch(
    "/companies/current/portfolio/:id",
    requireAdmin,
    async (req, res) => {
      const b = portfolio.parse(req.body);
      await ownImage(b.imageUrl, req.auth!.companyId!);
      const { rows } = await pool.query(
        "UPDATE projects SET name=$1,description=$2,location=$3,size=$4,completed_year=$5,image_url=$6,url=$7 WHERE id=$8 AND company_id=$9 RETURNING *",
        [
          b.name,
          b.description,
          b.location,
          b.size,
          b.completedYear,
          b.imageUrl,
          b.url,
          uuid.parse(req.params.id),
          req.auth!.companyId,
        ],
      );
      if (!rows.length) throw new HttpError(404, "Project not found.");
      res.json(rows[0]);
    },
  );
  router.delete(
    "/companies/current/portfolio/:id",
    requireAdmin,
    async (req, res) => {
      const r = await pool.query(
        "DELETE FROM projects WHERE id=$1 AND company_id=$2",
        [uuid.parse(req.params.id), req.auth!.companyId],
      );
      if (!r.rowCount) throw new HttpError(404, "Project not found.");
      res.json({ ok: true });
    },
  );
  router.post(
    "/companies/current/assets",
    requireAdmin,
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }).single("file"),
    async (req, res) => {
      const f = req.file;
      if (!f) throw new HttpError(400, "Choose a photo.");
      const type = await fileTypeFromBuffer(f.buffer);
      if (
        !type ||
        !["image/jpeg", "image/png", "image/webp"].includes(type.mime)
      )
        throw new HttpError(400, "Use JPG, PNG, or WebP.");
      const id = randomUUID(),
        key = "profiles/" + id;
      let stored = false;
      try {
        await tx(async (db) => {
          await checkQuota(db, req.auth!.companyId!, f.size);
          stored = true;
          const s = await storeBuffer(key, f.buffer, type.mime);
          await db.query(
            "INSERT INTO company_assets(id,company_id,storage_name,storage_backend,mime_type,size,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              id,
              req.auth!.companyId,
              key,
              s.storage_backend,
              type.mime,
              f.size,
              s.sha256,
            ],
          );
        });
      } catch (e) {
        if (stored)
          await deferDelete(
            process.env.STORAGE_BACKEND === "s3" ? "s3" : "local",
            key,
          );
        throw e;
      }
      res.status(201).json({ id, url: "/api/company-assets/" + id });
    },
  );
  router.put("/companies/current/branding", requireAdmin, async (req, res) => {
    const b = z
      .object({ slot: z.enum(["logo", "cover"]), assetId: uuid })
      .parse(req.body);
    if (
      !(
        await pool.query(
          "SELECT 1 FROM company_assets WHERE id=$1 AND company_id=$2",
          [b.assetId, req.auth!.companyId],
        )
      ).rowCount
    )
      throw new HttpError(404, "Photo not found.");
    await pool.query(
      `UPDATE companies SET ${b.slot === "logo" ? "logo_url" : "cover_url"}=$1 WHERE id=$2`,
      ["/api/company-assets/" + b.assetId, req.auth!.companyId],
    );
    res.json({ ok: true });
  });
  router.get("/company-assets/:id", async (req, res) => {
    const a = (
      await pool.query("SELECT * FROM company_assets WHERE id=$1", [
        uuid.parse(req.params.id),
      ])
    ).rows[0];
    if (!a) throw new HttpError(404, "Photo not found.");
    res.type(a.mime_type);
    await sendStored(req, res, a.storage_backend, a.storage_name);
  });
  router.get("/companies/:id/reviews", async (req, res) => {
    const id = uuid.parse(req.params.id),
      page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(req.query.page || 1);
    const { rows } = await pool.query(
      `SELECT r.*,u.name AS reviewer_name,(u.email_verified_at IS NOT NULL) AS email_verified FROM company_reviews r JOIN users u ON u.id=r.user_id WHERE r.company_id=$1 AND ${reviewVisible} ORDER BY r.created_at DESC,r.id LIMIT 20 OFFSET $2`,
      [id, (page - 1) * 20],
    );
    const mine = req.auth
      ? (
          await pool.query(
            "SELECT * FROM company_reviews WHERE company_id=$1 AND user_id=$2",
            [id, req.auth.userId],
          )
        ).rows[0] || null
      : null;
    const affiliated = !!(
      req.auth &&
      (
        await pool.query(
          "SELECT 1 FROM memberships WHERE company_id=$1 AND user_id=$2",
          [id, req.auth.userId],
        )
      ).rowCount
    );
    const { rating } = await profileExtras(id);
    res.json({
      reviews: rows,
      rating,
      mine,
      affiliated,
      page,
      nextPage: page * 20 < rating.count ? page + 1 : null,
    });
  });
  router.put(
    "/companies/:id/reviews/mine",
    requireVerified,
    async (req, res) => {
      const companyId = uuid.parse(req.params.id);
      const b = z
        .object({
          rating: z.number().int().min(1).max(5),
          title: z.string().trim().min(3).max(120),
          body: z.string().trim().min(20).max(3000),
          experienceDate: z.iso.date(),
          customerExperience: z.literal(true),
        })
        .parse(req.body);
      if (b.experienceDate > new Date().toISOString().slice(0, 10))
        throw new HttpError(400, "Choose a date that is today or earlier.");
      await tx(async (db) => {
        await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          req.auth!.userId,
        ]);
        if (
          (
            await db.query(
              "SELECT 1 FROM memberships WHERE user_id=$1 AND company_id=$2",
              [req.auth!.userId, companyId],
            )
          ).rowCount
        )
          throw new HttpError(
            403,
            "Team members cannot review their own company.",
          );
        if (
          !(await db.query("SELECT 1 FROM companies WHERE id=$1", [companyId]))
            .rowCount
        )
          throw new HttpError(404, "Company not found.");
        await db.query(
          "INSERT INTO company_reviews(company_id,user_id,rating,title,body,experience_date) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(company_id,user_id) DO UPDATE SET rating=$3,title=$4,body=$5,experience_date=$6,updated_at=now()",
          [
            companyId,
            req.auth!.userId,
            b.rating,
            b.title,
            b.body,
            b.experienceDate,
          ],
        );
      });
      res.json({ ok: true });
    },
  );
  router.delete(
    "/companies/:id/reviews/mine",
    requireVerified,
    async (req, res) => {
      await pool.query(
        "DELETE FROM company_reviews WHERE company_id=$1 AND user_id=$2",
        [uuid.parse(req.params.id), req.auth!.userId],
      );
      res.json({ ok: true });
    },
  );
  router.post("/reviews/:id/reply", requireAdmin, async (req, res) => {
    const { body } = z
      .object({ body: z.string().trim().min(1).max(2000) })
      .parse(req.body);
    const r = await pool.query(
      "UPDATE company_reviews SET reply=$1,replied_at=now() WHERE id=$2 AND company_id=$3",
      [body, uuid.parse(req.params.id), req.auth!.companyId],
    );
    if (!r.rowCount) throw new HttpError(404, "Review not found.");
    res.json({ ok: true });
  });
  router.post("/reviews/:id/report", requireVerified, async (req, res) => {
    const { reason } = z
      .object({ reason: z.string().trim().min(10).max(1000) })
      .parse(req.body);
    await pool.query(
      "INSERT INTO review_reports(review_id,user_id,reason) VALUES($1,$2,$3) ON CONFLICT(review_id,user_id) DO UPDATE SET reason=$3",
      [uuid.parse(req.params.id), req.auth!.userId, reason],
    );
    res.json({ ok: true });
  });
  router.patch("/team/:id/profile", requireVerified, async (req, res) => {
    const id = uuid.parse(req.params.id),
      { title } = z
        .object({ title: z.string().trim().max(120) })
        .parse(req.body);
    if (
      !req.auth!.companyId ||
      (id !== req.auth!.userId &&
        !["owner", "admin"].includes(req.auth!.role || ""))
    )
      throw new HttpError(
        403,
        "Only company administrators can edit other team members.",
      );
    const r = await pool.query(
      "UPDATE memberships SET title=$1 WHERE user_id=$2 AND company_id=$3",
      [title, id, req.auth!.companyId],
    );
    if (!r.rowCount) throw new HttpError(404, "Team member not found.");
    res.json({ ok: true });
  });
  return router;
}
