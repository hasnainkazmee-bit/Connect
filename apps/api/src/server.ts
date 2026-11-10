import {
  directoryRoutes,
  directorySearch,
  preventDuplicateCompany,
  requireManagedCompany,
} from "./directory.js";
import { publicPages } from "./public-pages.js";
import { credentialRoutes } from "./credentials.js";
import { googlePlacesRoutes } from "./google-places.js";
import {
  googleBusinessRoutes,
  refreshGoogleBusinessRatings,
} from "./google-business.js";
import { employeeInvitationRoutes } from "./employee-invitations.js";
import { androidRelease } from "./mobile-release.js";
import { desktopRelease } from "./desktop-release.js";
import {
  notificationRoutes,
  flushPush,
  pruneNotifications,
  closeNotificationStreams,
  recordNotificationRelease,
  pushConfiguration,
} from "./notifications.js";
import express from "express";
import { socialRoutes } from "./social.js";
import { profileRoutes, profileExtras, ensureUsername } from "./profiles.js";
import { publishingRoutes } from "./publishing.js";
import { personalMessagesRoutes } from "./personal-messages.js";
import { accountRoutes, sessionPayload as mePayload } from "./accounts.js";
import { sunhubSsoRoutes } from "./sunhub-sso.js";
import { sunhubIntegrationRoutes } from "./sunhub-integration.js";
import { flushMail } from "./mail.js";
import {
  storeBuffer,
  sendStored,
  deferDelete,
  cleanStorage,
  checkQuota,
  storageReady,
} from "./storage.js";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { fileTypeFromBuffer } from "file-type";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import type { PoolClient } from "pg";
import { pool, tx, root, HttpError, lockPair } from "./db.js";
import {
  session,
  requireAuth,
  clearSessionCookies,
  requireVerified,
  requireAdmin,
  requireCompany,
  hashToken,
} from "./auth.js";

const app = express();
const origin = process.env.APP_ORIGIN || "http://localhost:5173";
const uploadDir = path.resolve(root, process.env.UPLOAD_DIR || "uploads");
await fs.mkdir(uploadDir, { recursive: true });
app.disable("x-powered-by");
if (process.env.TRUST_PROXY_HOPS === "1") app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  next();
});
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    req.headers.origin !== origin
  )
    return next(new HttpError(403, "Request origin is not allowed."));
  next();
});
// Stream job requests before JSON parsing so attachments stay binary. The Rust
// service checks the same signed session cookie against the shared database.
app.use("/api/jobs", (req, res) => {
  const target = new URL(
    process.env.JOBS_SERVICE_URL || "http://127.0.0.1:4201",
  );
  const request = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: req.originalUrl.slice(4),
      headers: {
        cookie: req.headers.cookie || "",
        "content-type": req.headers["content-type"] || "application/json",
        ...(req.headers["content-length"]
          ? { "content-length": req.headers["content-length"] }
          : {}),
      },
      timeout: 30000,
    },
    (response) => {
      res.status(response.statusCode || 502);
      if (response.headers["content-type"])
        res.setHeader("Content-Type", response.headers["content-type"]);
      if (response.headers["content-disposition"])
        res.setHeader(
          "Content-Disposition",
          response.headers["content-disposition"],
        );
      response.pipe(res);
    },
  );
  request.on("timeout", () => request.destroy());
  request.on("error", () => {
    if (!res.headersSent)
      res
        .status(502)
        .json({ error: "Jobs are temporarily unavailable. Please try again." });
    else res.end();
  });
  req.pipe(request);
});
app.use(express.json({ limit: "1mb" }));
app.use("/api", session);
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});
const writeLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please slow down and try again." },
});
app.use("/api", (req, res, next) =>
  ["GET", "HEAD"].includes(req.method) ? next() : writeLimit(req, res, next),
);
const idSchema = z.string().uuid();
const str = (v: unknown) => String(v || "");
const pair = (a: string, b: string) => [a, b].sort();
const listeners = new Map<string, Set<express.Response>>();
function broadcast(...ids: string[]) {
  for (const id of ids)
    for (const res of listeners.get(id) || [])
      res.write("event: changed\ndata: {}\n\n");
}
async function notify(
  db: PoolClient,
  company: string,
  type: string,
  text: string,
  related: string,
) {
  await db.query(
    "INSERT INTO notifications(company_id,type,text,related_company_id) VALUES($1,$2,$3,$4)",
    [company, type, text, related],
  );
}
async function noBlock(db: PoolClient, a: string, b: string) {
  if (
    (
      await db.query(
        "SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)",
        [a, b],
      )
    ).rowCount
  )
    throw new HttpError(403, "This company connection is unavailable.");
}
async function companyExists(db: PoolClient, id: string) {
  const { rows } = await db.query("SELECT * FROM companies WHERE id=$1", [id]);
  if (!rows[0]) throw new HttpError(404, "Company not found.");
  return rows[0];
}
async function conversation(db: PoolClient, id: string, actor: string) {
  const { rows } = await db.query(
    "SELECT * FROM connections WHERE id=$1 AND (company_a=$2 OR company_b=$2)",
    [id, actor],
  );
  if (!rows[0]) throw new HttpError(404, "Conversation not found.");
  return rows[0];
}
app.get("/api/mobile/releases/android", (_req, res) =>
  res.json(androidRelease),
);
app.get("/api/mobile/releases/desktop", (_req, res) =>
  res.json(desktopRelease),
);
app.get("/api/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({
    release: process.env.CONNECT_RELEASE || "development",
    status: "ok",
  });
});
app.get("/api/ready", async (_req, res) => {
  await pool.query("SELECT 1");
  await storageReady();
  res.json({ status: "ok" });
});
app.get("/api/session", async (req, res) => {
  res.json(
    req.auth
      ? await mePayload(req.auth.userId, req.auth.companyId)
      : { user: null, companies: [], activeCompanyId: null },
  );
});
app.use(
  "/api/auth/sunhub",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => req.path === "/config",
    message: { error: "Too many sign-in attempts. Please try again later." },
  }),
);
app.use("/api/auth", (req, res, next) =>
  req.path.startsWith("/sunhub/") ? next() : authLimit(req, res, next),
);
app.use("/api", accountRoutes());
app.use("/api", sunhubSsoRoutes());
app.use("/api", sunhubIntegrationRoutes());
app.use("/api", profileRoutes());
app.use("/api", credentialRoutes());
app.use("/api", googlePlacesRoutes());
app.use("/api", googleBusinessRoutes());
app.use("/api", directoryRoutes());
app.use("/api", personalMessagesRoutes());
app.post("/api/auth/logout", async (req, res) => {
  if (req.auth)
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      req.auth.tokenHash,
    ]);
  clearSessionCookies(res);
  res.json({ ok: true });
});
app.post("/api/session/company", requireAuth, async (req, res) => {
  const { companyId } = z.object({ companyId: idSchema }).parse(req.body);
  if (
    !(
      await pool.query(
        "SELECT 1 FROM memberships WHERE user_id=$1 AND company_id=$2",
        [req.auth!.userId, companyId],
      )
    ).rowCount
  )
    throw new HttpError(403, "You do not represent that company.");
  await pool.query("UPDATE sessions SET company_id=$1 WHERE token_hash=$2", [
    companyId,
    req.auth!.tokenHash,
  ]);
  res.json(await mePayload(req.auth!.userId, companyId));
});
app.get("/api/companies", async (req, res) => {
  res.json(await directorySearch(req.query));
});
app.get("/api/companies/:id", async (req, res) => {
  const company = (
    await pool.query(
      "SELECT * FROM companies WHERE id::text=$1 OR slug=$1 OR username=$1 OR id=(SELECT company_id FROM company_username_history WHERE username=$1) ORDER BY (username=$1) DESC NULLS LAST LIMIT 1",
      [req.params.id.toLowerCase()],
    )
  ).rows[0];
  if (!company) throw new HttpError(404, "Company not found.");
  const [projects, team] = await Promise.all([
    pool.query("SELECT * FROM projects WHERE company_id=$1", [company.id]),
    pool.query(
      "SELECT u.id,u.name,m.title FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 ORDER BY u.name",
      [company.id],
    ),
  ]);
  let relationship: any = { status: "none" };
  if (req.auth?.companyId) {
    const actor = req.auth.companyId;
    if (actor === company.id) relationship = { status: "self" };
    else {
      const [a, b] = pair(actor, company.id);
      const blocked = (
        await pool.query(
          "SELECT blocker_id FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)",
          [actor, company.id],
        )
      ).rows;
      const connection = (
        await pool.query(
          "SELECT * FROM connections WHERE company_a=$1 AND company_b=$2",
          [a, b],
        )
      ).rows[0];
      const request = (
        await pool.query(
          "SELECT * FROM connection_requests WHERE status='pending' AND ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1))",
          [actor, company.id],
        )
      ).rows[0];
      relationship = {
        status: blocked.length
          ? "blocked"
          : connection?.status === "connected"
            ? "connected"
            : request
              ? request.from_id === actor
                ? "sent"
                : "incoming"
              : connection
                ? "disconnected"
                : "none",
        connectionId: connection?.id,
        requestId: request?.id,
        blockedByMe: blocked.some((r) => r.blocker_id === actor),
      };
    }
  }
  res.json({
    company,
    projects: projects.rows,
    team: team.rows,
    relationship,
    ...(await profileExtras(company.id)),
  });
});
app.patch("/api/companies/current", requireAdmin, async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2).max(120),
      tagline: z.string().max(200),
      description: z.string().max(3000),
      type: z.enum([
        "Installer",
        "EPC",
        "Contractor",
        "Developer",
        "Distributor",
        "Manufacturer",
        "Service provider",
      ]),
      location: z.string().max(160),
      service_areas: z.array(z.string().min(1).max(60)).max(30),
      services: z.array(z.string().min(1).max(80)).max(30),
      website: z.union([
        z.literal(""),
        z
          .url()
          .refine(
            (v) => /^https?:\/\//.test(v),
            "Use an http or https website.",
          ),
      ]),
    })
    .parse(req.body);
  const { rows } = await tx(async (db) => {
    await preventDuplicateCompany(db, body.name, req.auth!.companyId!);
    return db.query(
      "UPDATE companies SET name=$1,tagline=$2,description=$3,type=$4,location=$5,service_areas=$6,services=$7,website=$8 WHERE id=$9 RETURNING *",
      [
        body.name,
        body.tagline,
        body.description,
        body.type,
        body.location,
        body.service_areas,
        body.services,
        body.website,
        req.auth!.companyId,
      ],
    );
  });
  res.json(rows[0]);
});
app.post("/api/companies", requireVerified, async (req, res) => {
  if (req.auth!.accountType === "individual")
    throw new HttpError(
      403,
      "Individual accounts cannot manage company profiles.",
    );
  const { name } = z
    .object({ name: z.string().trim().min(2).max(120) })
    .parse(req.body);
  const company = await tx(async (db) => {
    await preventDuplicateCompany(db, name);
    const slug =
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
      "-" +
      randomBytes(3).toString("hex");
    const c = (
      await db.query(
        "INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING *",
        [name, slug],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,'owner')",
      [req.auth!.userId, c.id],
    );
    await db.query("UPDATE sessions SET company_id=$1 WHERE token_hash=$2", [
      c.id,
      req.auth!.tokenHash,
    ]);
    c.username = await ensureUsername(db, c.id, name);
    return c;
  });
  res.status(201).json(company);
});
app.post("/api/companies/current/projects", requireAdmin, async (req, res) => {
  const b = z
    .object({
      name: z.string().trim().min(2).max(150),
      description: z.string().max(2000),
      location: z.string().max(150),
      size: z.string().max(60),
    })
    .parse(req.body);
  res
    .status(201)
    .json(
      (
        await pool.query(
          "INSERT INTO projects(company_id,name,description,location,size) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [req.auth!.companyId, b.name, b.description, b.location, b.size],
        )
      ).rows[0],
    );
});

app.post("/api/requests", requireAdmin, async (req, res) => {
  const { companyId, note, kind } = z
      .object({
        companyId: idSchema,
        kind: z.enum(["connection", "message"]).default("connection"),
        note: z.string().trim().max(2000).default(""),
      })
      .refine(
        (r) => r.kind !== "message" || r.note.length > 0,
        "Write a message to send a request.",
      )
      .refine(
        (r) => r.kind !== "connection" || r.note.length <= 500,
        "Connection notes can be up to 500 characters.",
      )
      .parse(req.body),
    actor = req.auth!.companyId!;
  if (actor === companyId)
    throw new HttpError(400, "You cannot connect with your own company.");
  const request = await tx(async (db) => {
    await lockPair(db, actor, companyId);
    await companyExists(db, companyId);
    await requireManagedCompany(db, companyId);
    await noBlock(db, actor, companyId);
    const [a, b] = pair(actor, companyId);
    if (
      (
        await db.query(
          "SELECT 1 FROM connections WHERE company_a=$1 AND company_b=$2 AND status='connected'",
          [a, b],
        )
      ).rowCount
    )
      throw new HttpError(409, "Your companies are already connected.");
    if (
      (
        await db.query(
          "SELECT 1 FROM connection_requests WHERE status='pending' AND LEAST(from_id,to_id)=$1 AND GREATEST(from_id,to_id)=$2",
          [a, b],
        )
      ).rowCount
    )
      throw new HttpError(409, "A connection request already exists.");
    const r = (
      await db.query(
        "INSERT INTO connection_requests(from_id,to_id,author_id,note,kind) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [actor, companyId, req.auth!.userId, note, kind],
      )
    ).rows[0];
    const me = await companyExists(db, actor);
    await notify(
      db,
      companyId,
      kind === "message" ? "message_request" : "request",
      kind === "message"
        ? `${me.name} sent you a message request.`
        : `${me.name} would like to connect.`,
      actor,
    );
    return r;
  });
  broadcast(actor, companyId);
  res.status(201).json(request);
});
app.post("/api/requests/:id/respond", requireAdmin, async (req, res) => {
  const requestId = idSchema.parse(req.params.id),
    { action } = z
      .object({ action: z.enum(["accept", "decline", "withdraw"]) })
      .parse(req.body),
    actor = req.auth!.companyId!;
  const result = await tx(async (db) => {
    const r = (
      await db.query("SELECT * FROM connection_requests WHERE id=$1", [
        requestId,
      ])
    ).rows[0];
    if (
      !r ||
      !(action === "withdraw" ? r.from_id === actor : r.to_id === actor)
    )
      throw new HttpError(404, "Request not found.");
    await lockPair(db, r.from_id, r.to_id);
    const current = (
      await db.query(
        "SELECT status FROM connection_requests WHERE id=$1 FOR UPDATE",
        [r.id],
      )
    ).rows[0];
    if (current.status !== "pending")
      throw new HttpError(409, "This request has already been handled.");
    await noBlock(db, r.from_id, r.to_id);
    await db.query(
      "UPDATE connection_requests SET status=$1,responded_at=now() WHERE id=$2",
      [
        action === "accept"
          ? "accepted"
          : action === "decline"
            ? "declined"
            : "withdrawn",
        r.id,
      ],
    );
    let connectionId = null;
    if (action === "accept") {
      const [a, b] = pair(r.from_id, r.to_id);
      connectionId = (
        await db.query(
          "INSERT INTO connections(company_a,company_b) VALUES($1,$2) ON CONFLICT(company_a,company_b) DO UPDATE SET status='connected',updated_at=now() RETURNING id",
          [a, b],
        )
      ).rows[0].id;
      if (r.kind === "message") {
        await db.query(
          "INSERT INTO messages(connection_id,sender_company_id,author_id,body,created_at,source_request_id) VALUES($1,$2,$3,$4,$5,$6)",
          [connectionId, r.from_id, r.author_id, r.note, r.created_at, r.id],
        );
      }
      const me = await companyExists(db, actor);
      await notify(
        db,
        r.from_id,
        "accepted",
        `${me.name} accepted your ${r.kind === "message" ? "message" : "connection"} request.`,
        actor,
      );
    }
    return { ...r, connectionId };
  });
  broadcast(result.from_id, result.to_id);
  res.json(result);
});
app.post("/api/relationships/:companyId", requireAdmin, async (req, res) => {
  const other = idSchema.parse(req.params.companyId),
    actor = req.auth!.companyId!,
    { action } = z
      .object({ action: z.enum(["disconnect", "block", "unblock"]) })
      .parse(req.body);
  if (actor === other) throw new HttpError(400, "Invalid company.");
  await tx(async (db) => {
    await lockPair(db, actor, other);
    await companyExists(db, other);
    if (action === "unblock") {
      await db.query(
        "DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2",
        [actor, other],
      );
      return;
    }
    const [a, b] = pair(actor, other);
    await db.query(
      "UPDATE connections SET status='disconnected',updated_at=now() WHERE company_a=$1 AND company_b=$2",
      [a, b],
    );
    if (action === "block") {
      await db.query(
        "DELETE FROM company_follows WHERE (follower_id=$1 AND followed_id=$2) OR (follower_id=$2 AND followed_id=$1)",
        [actor, other],
      );
      await db.query(
        "INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [actor, other],
      );
      await db.query(
        "UPDATE connection_requests SET status='withdrawn',responded_at=now() WHERE status='pending' AND LEAST(from_id,to_id)=$1 AND GREATEST(from_id,to_id)=$2",
        [a, b],
      );
    }
  });
  broadcast(actor, other);
  res.json({ ok: true });
});
app.get("/api/network", requireCompany, async (req, res) => {
  const actor = req.auth!.companyId!;
  const [requests, connections, blocked, notifications] = await Promise.all([
    pool.query(
      `SELECT r.*,row_to_json(c) AS company,u.name AS author_name FROM connection_requests r JOIN companies c ON c.id=CASE WHEN r.from_id=$1 THEN r.to_id ELSE r.from_id END JOIN users u ON u.id=r.author_id WHERE (r.from_id=$1 OR r.to_id=$1) AND r.status='pending' ORDER BY r.created_at DESC`,
      [actor],
    ),
    pool.query(
      `SELECT n.*,row_to_json(c) AS company,(SELECT body FROM messages WHERE connection_id=n.id ORDER BY sequence DESC LIMIT 1) AS last_message,(SELECT max(created_at) FROM messages WHERE connection_id=n.id) AS last_message_at,(SELECT count(*)::int FROM messages m WHERE m.connection_id=n.id AND m.sender_company_id<>$1 AND m.sequence>COALESCE(rd.read_sequence,0)) AS unread,EXISTS(SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=c.id) OR (blocker_id=c.id AND blocked_id=$1)) AS blocked FROM connections n JOIN companies c ON c.id=CASE WHEN n.company_a=$1 THEN n.company_b ELSE n.company_a END LEFT JOIN conversation_reads rd ON rd.connection_id=n.id AND rd.company_id=$1 WHERE n.company_a=$1 OR n.company_b=$1 ORDER BY COALESCE((SELECT max(created_at) FROM messages WHERE connection_id=n.id),n.updated_at) DESC`,
      [actor],
    ),
    pool.query(
      "SELECT b.*,row_to_json(c) AS company FROM blocks b JOIN companies c ON c.id=b.blocked_id WHERE blocker_id=$1",
      [actor],
    ),
    pool.query(
      "SELECT * FROM notifications WHERE company_id=$1 ORDER BY created_at DESC LIMIT 30",
      [actor],
    ),
  ]);
  res.json({
    incoming: requests.rows.filter((r) => r.to_id === actor),
    sent: requests.rows.filter((r) => r.from_id === actor),
    connections: connections.rows,
    blocked: blocked.rows,
    notifications: notifications.rows,
  });
});
app.get("/api/messaging/companies", requireCompany, async (req, res) => {
  const actor = req.auth!.companyId!;
  const query = z
    .string()
    .trim()
    .max(100)
    .parse(req.query.q || "");
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .parse(req.query.page || 1);
  const { rows } = await pool.query(
    `WITH filtered AS (
      SELECT c.*, GREATEST(n.updated_at,r.created_at,m.last_message_at) AS activity_at
      FROM companies c
      LEFT JOIN connections n ON n.company_a=LEAST(c.id,$1::uuid) AND n.company_b=GREATEST(c.id,$1::uuid)
      LEFT JOIN connection_requests r ON r.status='pending' AND LEAST(r.from_id,r.to_id)=LEAST(c.id,$1::uuid) AND GREATEST(r.from_id,r.to_id)=GREATEST(c.id,$1::uuid)
      LEFT JOIN LATERAL (SELECT max(created_at) AS last_message_at FROM messages WHERE connection_id=n.id) m ON true
      WHERE c.id<>$1 AND ($2='' OR concat_ws(' ',c.name,c.type,c.location) ILIKE '%'||$2||'%')
    ), paged AS (SELECT * FROM filtered ORDER BY activity_at DESC NULLS LAST,name,id LIMIT 24 OFFSET $3)
    SELECT COALESCE((SELECT json_agg(paged ORDER BY activity_at DESC NULLS LAST,name,id) FROM paged),'[]') AS companies,
      (SELECT count(*)::int FROM filtered) AS total`,
    [actor, query, (page - 1) * 24],
  );
  res.json({ ...rows[0], page, pageSize: 24 });
});
app.use("/api", notificationRoutes());
app.get("/api/conversations/:id/messages", requireCompany, async (req, res) => {
  const id = idSchema.parse(req.params.id),
    actor = req.auth!.companyId!,
    before = req.query.before
      ? z
          .string()
          .regex(/^[1-9][0-9]{0,18}$/)
          .parse(req.query.before)
      : null;
  const result = await tx(async (db) => {
    const c = await conversation(db, id, actor);
    const { rows } = await db.query(
      `SELECT m.*,u.name AS author_name,co.name AS sender_company_name,COALESCE((SELECT json_agg(json_build_object('id',a.id,'name',a.original_name,'mime',a.mime_type,'size',a.size)) FROM attachments a WHERE a.message_id=m.id),'[]') AS attachments FROM messages m JOIN users u ON u.id=m.author_id JOIN companies co ON co.id=m.sender_company_id WHERE m.connection_id=$1 AND ($2::bigint IS NULL OR m.sequence<$2) ORDER BY m.sequence DESC LIMIT 101`,
      [id, before],
    );
    const cutoff = rows[0]?.sequence;
    let readChanged = false;
    if (!before && cutoff) {
      const receipt = await db.query(
        "INSERT INTO conversation_reads(connection_id,company_id,read_sequence) VALUES($1,$2,$3) ON CONFLICT(connection_id,company_id) DO UPDATE SET read_at=now(),read_sequence=$3 WHERE conversation_reads.read_sequence<$3 RETURNING read_sequence",
        [id, actor, cutoff],
      );
      readChanged = !!receipt.rowCount;
    }
    const other = c.company_a === actor ? c.company_b : c.company_a;
    const read = (
      await db.query(
        "SELECT read_sequence FROM conversation_reads WHERE connection_id=$1 AND company_id=$2",
        [id, other],
      )
    ).rows[0];
    return {
      connection: c,
      peerReadSequence: read?.read_sequence || "0",
      messages: rows.slice(0, 100).reverse(),
      hasMore: rows.length > 100,
      readChanged,
    };
  });
  const { readChanged, ...payload } = result;
  if (readChanged)
    broadcast(payload.connection.company_a, payload.connection.company_b);
  res.json(payload);
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 3, fields: 2 },
});
app.post(
  "/api/conversations/:id/messages",
  requireCompany,
  upload.array("files", 3),
  async (req, res) => {
    const id = idSchema.parse(req.params.id),
      actor = req.auth!.companyId!,
      body = z
        .string()
        .trim()
        .max(10000)
        .parse(req.body.body || ""),
      files = (req.files || []) as Express.Multer.File[];
    if (!body && !files.length)
      throw new HttpError(400, "Write a message or attach a file.");
    const prepared: {
      file: Express.Multer.File;
      type: { mime: string; ext: string };
      name: string;
    }[] = [];
    for (const file of files) {
      const type = await fileTypeFromBuffer(file.buffer);
      if (
        !type ||
        !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
          type.mime,
        )
      )
        throw new HttpError(
          400,
          "Attachments must be JPG, PNG, WebP or PDF files.",
        );
      prepared.push({ file, type, name: randomUUID() + "." + type.ext });
    }
    const clientId =
      req.body.clientId || req.query.clientId
        ? idSchema.parse(req.body.clientId || req.query.clientId)
        : null;
    const contentHash = createHash("sha256")
      .update(
        JSON.stringify({
          body,
          files: prepared.map((p) => [
            p.file.originalname,
            p.type.mime,
            createHash("sha256").update(p.file.buffer).digest("hex"),
          ]),
        }),
      )
      .digest("hex");
    const written: { name: string; backend: string }[] = [];
    let saved: any;
    let duplicate = false;
    try {
      saved = await tx(async (db) => {
        const c = await conversation(db, id, actor);
        await lockPair(db, c.company_a, c.company_b);
        const fresh = await conversation(db, id, actor);
        if (fresh.status !== "connected")
          throw new HttpError(
            403,
            "Reconnect with this company to send new messages.",
          );
        await noBlock(db, c.company_a, c.company_b);
        if (clientId) {
          const previous = (
            await db.query(
              "SELECT * FROM messages WHERE connection_id=$1 AND sender_company_id=$2 AND client_id=$3",
              [id, actor, clientId],
            )
          ).rows[0];
          if (previous) {
            if (previous.content_hash !== contentHash)
              throw new HttpError(
                409,
                "That send was already used for a different message.",
              );
            duplicate = true;
            return previous;
          }
        }
        await checkQuota(
          db,
          actor,
          prepared.reduce((sum, p) => sum + p.file.size, 0),
        );
        const message = (
          await db.query(
            "INSERT INTO messages(connection_id,sender_company_id,author_id,body,client_id,content_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [id, actor, req.auth!.userId, body, clientId, contentHash],
          )
        ).rows[0];
        for (const p of prepared) {
          written.push({
            name: p.name,
            backend: process.env.STORAGE_BACKEND === "s3" ? "s3" : "local",
          });
          const stored = await storeBuffer(p.name, p.file.buffer, p.type.mime);
          await db.query(
            "INSERT INTO attachments(message_id,original_name,storage_name,mime_type,size,storage_backend,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              message.id,
              p.file.originalname.slice(0, 200),
              p.name,
              p.type.mime,
              p.file.size,
              stored.storage_backend,
              stored.sha256,
            ],
          );
        }
        const other = c.company_a === actor ? c.company_b : c.company_a;
        const me = await companyExists(db, actor);
        await notify(db, other, "message", `${me.name} sent a message.`, actor);
        return message;
      });
    } catch (error) {
      await Promise.all(written.map((f) => deferDelete(f.backend, f.name)));
      throw error;
    }
    const c = (
      await pool.query(
        "SELECT company_a,company_b FROM connections WHERE id=$1",
        [id],
      )
    ).rows[0];
    broadcast(c.company_a, c.company_b);
    res.status(duplicate ? 200 : 201).json({
      ok: true,
      id: saved.id,
      sequence: saved.sequence,
      clientId,
      duplicate,
    });
  },
);
app.get("/api/attachments/:id", requireCompany, async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const a = (
    await pool.query(
      `SELECT a.* FROM attachments a JOIN messages m ON m.id=a.message_id JOIN connections c ON c.id=m.connection_id WHERE a.id=$1 AND (c.company_a=$2 OR c.company_b=$2)`,
      [id, req.auth!.companyId],
    )
  ).rows[0];
  if (!a) throw new HttpError(404, "Attachment not found.");
  res.type(a.mime_type);
  if (req.query.inline === "1" && a.mime_type.startsWith("image/"))
    res.set("Content-Disposition", "inline");
  else res.attachment(a.original_name);
  await sendStored(req, res, a.storage_backend, a.storage_name);
});
app.get("/api/events", requireCompany, (req, res) => {
  const company = req.auth!.companyId!;
  res.set({
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(": connected\n\n");
  if (!listeners.has(company)) listeners.set(company, new Set());
  listeners.get(company)!.add(res);
  const timer = setInterval(() => res.write(": heartbeat\n\n"), 25000);
  req.on("close", () => {
    clearInterval(timer);
    listeners.get(company)?.delete(res);
    if (!listeners.get(company)?.size) listeners.delete(company);
  });
});
app.use("/api", employeeInvitationRoutes());
app.get("/api/team", requireCompany, async (req, res) => {
  res.json(
    (
      await pool.query(
        "SELECT u.id,u.name,u.email,m.role,m.title FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 ORDER BY u.name",
        [req.auth!.companyId],
      )
    ).rows,
  );
});
app.get("/api/team/invites", requireAdmin, async (req, res) => {
  res.json(
    (
      await pool.query(
        "SELECT id,email,role,expires_at,created_at FROM team_invites WHERE company_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC",
        [req.auth!.companyId],
      )
    ).rows,
  );
});
app.delete("/api/team/invites/:id", requireAdmin, async (req, res) => {
  const r = await pool.query(
    "UPDATE team_invites SET revoked_at=now() WHERE id=$1 AND company_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id",
    [idSchema.parse(req.params.id), req.auth!.companyId],
  );
  if (!r.rowCount) throw new HttpError(404, "Invitation no longer active.");
  res.json({ ok: true });
});
app.get("/api/team/invites/preview/:token", async (req, res) => {
  const token = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(req.params.token);
  const invite = (
    await pool.query(
      "SELECT c.name,c.logo_url,c.logo_style,i.role,i.email FROM team_invites i JOIN companies c ON c.id=i.company_id WHERE token_hash=$1 AND expires_at>now() AND accepted_at IS NULL AND revoked_at IS NULL",
      [hashToken(token)],
    )
  ).rows[0];
  if (!invite)
    throw new HttpError(
      404,
      "This invitation has expired or was already used. Ask your company for a new link.",
    );
  const { email, ...info } = invite;
  res.json({
    ...info,
    emailHint: email.slice(0, 1) + "•••@" + email.split("@")[1],
    emailMatches: req.auth ? req.auth.email === email : null,
  });
});
app.patch("/api/team/:userId/role", requireAdmin, async (req, res) => {
  if (req.auth!.role !== "owner")
    throw new HttpError(403, "Only the owner can change team permissions.");
  const id = idSchema.parse(req.params.userId),
    { role } = z.object({ role: z.enum(["admin", "member"]) }).parse(req.body);
  const r = await pool.query(
    "UPDATE memberships SET role=$1 WHERE user_id=$2 AND company_id=$3 AND role<>'owner' RETURNING user_id",
    [role, id, req.auth!.companyId],
  );
  if (!r.rowCount)
    throw new HttpError(404, "Team member not found or is the company owner.");
  res.json({ ok: true });
});
app.post("/api/team/invites", requireAdmin, async (req, res) => {
  const { email, role } = z
    .object({
      email: z.email().toLowerCase(),
      role: z.enum(["admin", "member"]).default("member"),
    })
    .parse(req.body);
  const token = randomBytes(32).toString("hex");
  const company = await tx(async (db) => {
    const company = (
      await db.query(
        "SELECT id,name,username,slug FROM companies WHERE id=$1 FOR UPDATE",
        [req.auth!.companyId],
      )
    ).rows[0];
    const user = (
      await db.query(
        "SELECT u.id,u.account_type,EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.company_id=$2) AS member FROM users u WHERE email=$1",
        [email, req.auth!.companyId],
      )
    ).rows[0];
    if (user?.member)
      throw new HttpError(
        409,
        "This employee already has access to your company.",
      );
    if (user?.account_type === "individual")
      throw new HttpError(
        400,
        "This email belongs to an individual account. Ask your employee to use a company account with their work email.",
      );
    await db.query(
      "UPDATE team_invites SET revoked_at=now() WHERE company_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL",
      [req.auth!.companyId, email],
    );
    await db.query(
      "INSERT INTO team_invites(token_hash,company_id,email,role,expires_at) VALUES($1,$2,$3,$4,now()+interval '3 days')",
      [hashToken(token), req.auth!.companyId, email, role],
    );
    company.username = await ensureUsername(db, company.id, company.name);
    return company;
  });
  res.status(201).json({
    url: `${origin}/join/${company.username || company.slug}`,
    expiresIn: "3 days",
  });
});
app.post(
  "/api/team/invites/:token/accept",
  requireVerified,
  async (req, res) => {
    if (req.auth!.accountType === "individual")
      throw new HttpError(
        403,
        "This invitation is for a company account. Individual accounts cannot join company teams.",
      );
    const token = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.params.token);
    const company = await tx(async (db) => {
      const invite = (
        await db.query(
          "SELECT * FROM team_invites WHERE token_hash=$1 AND expires_at>now() AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE",
          [hashToken(token)],
        )
      ).rows[0];
      if (!invite)
        throw new HttpError(404, "Invitation is expired or already used.");
      if (invite.email !== req.auth!.email)
        throw new HttpError(
          403,
          "Sign in with the email address this invitation was sent to.",
        );
      await db.query(
        "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [req.auth!.userId, invite.company_id, invite.role],
      );
      await db.query(
        "UPDATE team_invites SET accepted_at=now() WHERE token_hash=$1",
        [hashToken(token)],
      );
      await db.query("UPDATE sessions SET company_id=$1 WHERE token_hash=$2", [
        invite.company_id,
        req.auth!.tokenHash,
      ]);
      await db.query(
        "UPDATE users SET onboarding_completed_at=COALESCE(onboarding_completed_at,now()) WHERE id=$1",
        [req.auth!.userId],
      );
      return invite.company_id;
    });
    res.json(await mePayload(req.auth!.userId, company));
  },
);
app.delete("/api/team/:userId", requireAdmin, async (req, res) => {
  const userId = idSchema.parse(req.params.userId);
  if (userId === req.auth!.userId)
    throw new HttpError(400, "You cannot remove yourself.");
  await tx(async (db) => {
    const member = (
      await db.query(
        "SELECT role FROM memberships WHERE company_id=$1 AND user_id=$2 FOR UPDATE",
        [req.auth!.companyId, userId],
      )
    ).rows[0];
    if (!member) throw new HttpError(404, "Team member not found.");
    if (member.role === "owner")
      throw new HttpError(403, "The company owner cannot be removed.");
    if (member.role === "admin" && req.auth!.role !== "owner")
      throw new HttpError(403, "Only the owner can remove an administrator.");
    await db.query(
      "DELETE FROM memberships WHERE company_id=$1 AND user_id=$2",
      [req.auth!.companyId, userId],
    );
    await db.query(
      "UPDATE sessions SET company_id=NULL WHERE user_id=$1 AND company_id=$2",
      [userId, req.auth!.companyId],
    );
  });
  res.json({ ok: true });
});
app.use("/api", await socialRoutes(uploadDir));
app.use("/api", publishingRoutes(uploadDir));
app.use("/api", (_req, _res, next) =>
  next(new HttpError(404, "API endpoint not found.")),
);
// Worker updates must not inherit a CDN/browser minimum TTL for static JS.
app.get("/push-sw.js", (_req, res, next) => {
  res.set({
    "Cache-Control": "no-store, max-age=0",
    "CDN-Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store",
    "Service-Worker-Allowed": "/",
  });
  res.sendFile(
    path.join(root, "apps/web/dist/push-sw.js"),
    { cacheControl: false, lastModified: false },
    (error) => {
      if (error) next(error);
    },
  );
});
app.use(express.static(path.join(root, "apps/web/dist"), { index: false }));
app.use(publicPages());
app.use(
  (
    error: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) return res.end();
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: error.issues[0]?.message || "Invalid input." });
    if (error instanceof multer.MulterError)
      return res.status(400).json({
        error:
          _req.path === "/api/posts"
            ? "Add up to 4 photos (10 MB each), one video (100 MB), or one PDF (20 MB)."
            : "Up to 3 attachments, 10 MB each, are supported.",
      });
    if (error instanceof HttpError)
      return res.status(error.status).json({ error: error.message });
    if (error.code === "23505")
      return res
        .status(409)
        .json({ error: "This account or record already exists." });
    if (error.code === "22P02")
      return res.status(400).json({ error: "Invalid identifier." });
    console.error(error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  },
);
const server = app.listen(Number(process.env.PORT || 4100), "0.0.0.0", () =>
  console.log(`Sunhub API: http://localhost:${process.env.PORT || 4100}`),
);
const mailTimer = setInterval(() => {
  void flushMail().catch(() => {});
  void cleanStorage().catch(() => {});
}, 5000);
mailTimer.unref();
let deliveringPush = false;
const pushTimer = setInterval(() => {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.PUSH_WORKER_DISABLED === "true"
  )
    return;
  if (deliveringPush) return;
  deliveringPush = true;
  void flushPush()
    .catch(() => console.error("Push delivery cycle failed."))
    .finally(() => {
      deliveringPush = false;
    });
}, 5000);
pushTimer.unref();
void pushConfiguration().catch(() =>
  console.error("Unable to check push provider configuration."),
);
void recordNotificationRelease(
  "android",
  String(androidRelease.versionCode),
  "Connect " + androidRelease.versionName + " is available",
  "Install the latest Connect update from app settings.",
).catch(() => console.error("Unable to record the app release."));
const googleRatingTimer = setInterval(
  () => {
    void refreshGoogleBusinessRatings().catch(() =>
      console.error("Unable to refresh Google Business Profile ratings."),
    );
  },
  6 * 60 * 60 * 1000,
);
googleRatingTimer.unref();
setTimeout(
  () => void refreshGoogleBusinessRatings().catch(() => {}),
  30000,
).unref();
const cleanupTimer = setInterval(() => {
  void pruneNotifications().catch(() => {});
  void pool
    .query(
      "DELETE FROM sessions WHERE expires_at<now(); DELETE FROM auth_limits WHERE expires_at<now(); DELETE FROM auth_challenges WHERE expires_at<now()-interval '1 day'; DELETE FROM email_outbox WHERE expires_at<now()-interval '7 days'; DELETE FROM auth_events WHERE created_at<now()-interval '90 days'; DELETE FROM oidc_flows WHERE expires_at<now(); DELETE FROM mobile_auth_handoffs WHERE expires_at<now(); DELETE FROM google_business_oauth_states WHERE expires_at<now()",
    )
    .catch(() => {});
}, 3600000);
cleanupTimer.unref();
const stop = () => {
  clearInterval(mailTimer);
  clearInterval(pushTimer);
  clearInterval(googleRatingTimer);
  clearInterval(cleanupTimer);
  closeNotificationStreams();
  for (const responses of listeners.values())
    for (const res of responses) res.end();
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
