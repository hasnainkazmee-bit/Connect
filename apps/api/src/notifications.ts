import { Router } from "express";
import { z } from "zod";
import { randomUUID, ECDH } from "node:crypto";
import fs from "node:fs/promises";
import webpush from "web-push";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { pool, tx, HttpError } from "./db.js";
import { requireAuth, requireVerified, hashToken } from "./auth.js";
import { subscribeNotificationChanges } from "./notification-stream.js";

const defaults = {
  messages: true,
  social: true,
  requests: true,
  team: true,
  updates: true,
  previews: false,
};
const categories = Object.keys(defaults) as (keyof typeof defaults)[];
const preferenceInput = z
  .object({
    messages: z.boolean().optional(),
    social: z.boolean().optional(),
    requests: z.boolean().optional(),
    team: z.boolean().optional(),
    updates: z.boolean().optional(),
    previews: z.boolean().optional(),
  })
  .strict();
const uuid = z.string().uuid();
const publicFields =
  "n.id,n.sequence::text,n.type,n.category,n.title,n.text,n.url,n.company_id,n.actor_company_id,n.created_at,n.read_at";
// Every read and delivery rechecks current authorization, rather than trusting a
// recipient snapshot made before membership, block or invitation changes.
export const visibleNotification = `n.expires_at>now()
 AND (n.company_id IS NULL OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=n.user_id AND m.company_id=n.company_id
 AND (n.category NOT IN ('requests','team') OR m.role IN ('owner','admin'))))
 AND (n.actor_company_id IS NULL OR n.company_id IS NULL OR NOT EXISTS(SELECT 1 FROM blocks b WHERE
 (b.blocker_id=n.actor_company_id AND b.blocked_id=n.company_id) OR (b.blocker_id=n.company_id AND b.blocked_id=n.actor_company_id)))
 AND CASE n.source_kind
 WHEN 'invite' THEN EXISTS(SELECT 1 FROM team_invites i JOIN users u ON u.id=n.user_id WHERE i.id=n.source_id AND i.email=u.email AND u.email_verified_at IS NOT NULL AND u.account_type='company' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now())
 WHEN 'connection' THEN EXISTS(SELECT 1 FROM connections c WHERE c.id=n.source_id AND c.status='connected' AND n.company_id IN(c.company_a,c.company_b))
 WHEN 'request' THEN EXISTS(SELECT 1 FROM connection_requests r WHERE r.id=n.source_id AND r.status IN('pending','accepted') AND n.company_id IN(r.from_id,r.to_id))
 WHEN 'personal' THEN EXISTS(SELECT 1 FROM personal_threads t WHERE t.id=n.source_id AND t.status<>'declined' AND (t.user_id=n.user_id OR t.company_id=n.company_id))
 WHEN 'post' THEN EXISTS(SELECT 1 FROM posts p WHERE p.id=n.source_id AND p.status='published')
 WHEN 'comment' THEN EXISTS(SELECT 1 FROM post_comments c JOIN posts p ON p.id=c.post_id WHERE c.id=n.source_id AND c.deleted_at IS NULL AND p.status='published')
 ELSE true END`;

type ProviderConfiguration = {
  webPush: { enabled: boolean; publicKey: string | null };
  fcm: { enabled: boolean };
};
let providerCache: {
  signature: string;
  checkedAt: number;
  value: ProviderConfiguration;
} | null = null;
export async function pushConfiguration(): Promise<ProviderConfiguration> {
  const signature = hashToken(
    [
      process.env.WEB_PUSH_PUBLIC_KEY,
      process.env.WEB_PUSH_PRIVATE_KEY,
      process.env.WEB_PUSH_SUBJECT,
      process.env.FIREBASE_SERVICE_ACCOUNT_FILE,
    ].join("\n"),
  );
  if (
    providerCache?.signature === signature &&
    Date.now() - providerCache.checkedAt < 30000
  )
    return providerCache.value;
  const value: ProviderConfiguration = {
    webPush: { enabled: false, publicKey: null },
    fcm: { enabled: false },
  };
  if (
    process.env.WEB_PUSH_PUBLIC_KEY &&
    process.env.WEB_PUSH_PRIVATE_KEY &&
    process.env.WEB_PUSH_SUBJECT
  ) {
    try {
      webpush.setVapidDetails(
        process.env.WEB_PUSH_SUBJECT,
        process.env.WEB_PUSH_PUBLIC_KEY,
        process.env.WEB_PUSH_PRIVATE_KEY,
      );
      value.webPush = {
        enabled: true,
        publicKey: process.env.WEB_PUSH_PUBLIC_KEY,
      };
    } catch {
      /* Invalid optional provider configuration does not disable the inbox. */
    }
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) {
    try {
      await initializeFirebase();
      value.fcm.enabled = true;
    } catch {
      /* Readiness remains false; retry after the cache window. */
    }
  }
  providerCache = { signature, checkedAt: Date.now(), value };
  return value;
}
export function validatePushEndpoint(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "Invalid push subscription.");
  }
  const host = url.hostname.toLowerCase();
  // Exact provider domains only. Arbitrary URLs must never turn this into an SSRF proxy.
  const allowed =
    host === "fcm.googleapis.com" ||
    host === "android.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    host === "web.push.apple.com" ||
    host.endsWith(".push.apple.com") ||
    host.endsWith(".notify.windows.com");
  if (
    !allowed ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hash
  )
    throw new HttpError(400, "This push service is not supported.");
  return url.href;
}
const baseDevice = {
  installationId: uuid,
  bindingId: uuid,
  appVersionCode: z.number().int().min(1).max(2147483647).optional(),
  appVersionName: z.string().max(80).optional(),
};
const deviceInput = z.discriminatedUnion("platform", [
  z.object({
    ...baseDevice,
    platform: z.literal("web"),
    subscription: z.object({
      endpoint: z.string().max(2048),
      keys: z.object({
        p256dh: z
          .string()
          .regex(/^[A-Za-z0-9_-]+={0,2}$/)
          .min(86)
          .max(90),
        auth: z
          .string()
          .regex(/^[A-Za-z0-9_-]+={0,2}$/)
          .min(22)
          .max(26),
      }),
    }),
  }),
  z.object({
    ...baseDevice,
    platform: z.literal("android"),
    token: z
      .string()
      .min(32)
      .max(4096)
      .regex(/^[A-Za-z0-9_:\-\.]+$/),
  }),
]);
const streams = new Set<() => void>();
export function closeNotificationStreams() {
  for (const close of streams) close();
}
export function notificationRoutes() {
  const router = Router();
  router.get("/notifications/config", async (_req, res) =>
    res.json(await pushConfiguration()),
  );
  router.use("/notifications", requireAuth);
  router.get("/notifications/preferences", async (req, res) => {
    const row = (
      await pool.query(
        "SELECT messages,social,requests,team,updates,previews FROM notification_preferences WHERE user_id=$1",
        [req.auth!.userId],
      )
    ).rows[0];
    res.json(row || defaults);
  });
  router.patch("/notifications/preferences", async (req, res) => {
    const input = preferenceInput.parse(req.body);
    const row = await tx(async (db) => {
      await db.query(
        "INSERT INTO notification_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING",
        [req.auth!.userId],
      );
      for (const key of categories)
        if (input[key] !== undefined)
          await db.query(
            `UPDATE notification_preferences SET ${key}=$2 WHERE user_id=$1`,
            [req.auth!.userId, input[key]],
          );
      return (
        await db.query(
          "SELECT messages,social,requests,team,updates,previews FROM notification_preferences WHERE user_id=$1",
          [req.auth!.userId],
        )
      ).rows[0];
    });
    res.json(row);
  });
  router.post("/notifications/devices", requireVerified, async (req, res) => {
    const input = deviceInput.parse(req.body),
      auth = req.auth!;
    const address =
      input.platform === "web"
        ? validatePushEndpoint(input.subscription.endpoint)
        : input.token;
    if (
      input.platform === "web" &&
      (Buffer.from(input.subscription.keys.p256dh, "base64url").length !== 65 ||
        Buffer.from(input.subscription.keys.auth, "base64url").length !== 16)
    )
      throw new HttpError(400, "Invalid push encryption keys.");
    if (input.platform === "web") {
      try {
        ECDH.convertKey(
          Buffer.from(input.subscription.keys.p256dh, "base64url"),
          "prime256v1",
        );
      } catch {
        throw new HttpError(400, "Invalid push encryption keys.");
      }
    }
    const addressHash = hashToken(address);
    const device = await tx(async (db) => {
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        auth.userId,
      ]);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "push:" + addressHash,
      ]);
      const session = (
        await db.query(
          "SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() FOR SHARE",
          [auth.tokenHash, auth.userId],
        )
      ).rowCount;
      if (!session) throw new HttpError(401, "Please sign in again.");
      const previous = (
        await db.query(
          "SELECT * FROM push_devices WHERE installation_id=$1 OR address_hash=$2 FOR UPDATE",
          [input.installationId, addressHash],
        )
      ).rows;
      if (
        previous.some(
          (d) =>
            d.installation_id === input.installationId &&
            d.user_id !== auth.userId &&
            d.address_hash !== addressHash,
        )
      )
        throw new HttpError(
          409,
          "This installation belongs to a different device.",
        );
      const same = previous.find(
        (d) =>
          d.user_id === auth.userId &&
          d.session_hash === auth.tokenHash &&
          d.installation_id === input.installationId &&
          d.binding_id === input.bindingId &&
          d.address_hash === addressHash,
      );
      if (same) {
        await db.query(
          "UPDATE push_devices SET updated_at=now(),app_version_code=$2,app_version_name=$3 WHERE id=$1",
          [same.id, input.appVersionCode || null, input.appVersionName || null],
        );
        return same;
      }
      await db.query(
        "DELETE FROM push_devices WHERE installation_id=$1 OR address_hash=$2",
        [input.installationId, addressHash],
      );
      if (
        Number(
          (
            await db.query(
              "SELECT count(*) FROM push_devices WHERE user_id=$1",
              [auth.userId],
            )
          ).rows[0].count,
        ) >= 12
      )
        throw new HttpError(
          409,
          "You have notifications enabled on too many devices.",
        );
      return (
        await db.query(
          `INSERT INTO push_devices(user_id,session_hash,installation_id,binding_id,platform,address_hash,address,p256dh,auth,app_version_code,app_version_name)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [
            auth.userId,
            auth.tokenHash,
            input.installationId,
            input.bindingId,
            input.platform,
            addressHash,
            address,
            input.platform === "web" ? input.subscription.keys.p256dh : null,
            input.platform === "web" ? input.subscription.keys.auth : null,
            input.appVersionCode || null,
            input.appVersionName || null,
          ],
        )
      ).rows[0];
    });
    res.status(201).json({ id: device.id });
  });
  router.delete("/notifications/devices/:id", async (req, res) => {
    await pool.query("DELETE FROM push_devices WHERE id=$1 AND user_id=$2", [
      uuid.parse(req.params.id),
      req.auth!.userId,
    ]);
    res.json({ ok: true });
  });
  router.get("/notifications/devices/:id", async (req, res) => {
    const active = !!(
      await pool.query(
        "SELECT 1 FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash WHERE d.id=$1 AND d.user_id=$2 AND d.session_hash=$3 AND s.expires_at>now()",
        [uuid.parse(req.params.id), req.auth!.userId, req.auth!.tokenHash],
      )
    ).rowCount;
    res.json({ active });
  });
  router.get("/notifications", async (req, res) => {
    const before = req.query.before
      ? z
          .string()
          .regex(/^[1-9][0-9]{0,18}$/)
          .parse(req.query.before)
      : null;
    const [page, count] = await Promise.all([
      pool.query(
        `SELECT ${publicFields} FROM user_notifications n WHERE n.user_id=$1 AND ${visibleNotification} AND($2::bigint IS NULL OR n.sequence<$2) ORDER BY n.sequence DESC LIMIT 31`,
        [req.auth!.userId, before],
      ),
      pool.query(
        `SELECT count(*)::int AS unread FROM user_notifications n WHERE n.user_id=$1 AND n.read_at IS NULL AND ${visibleNotification}`,
        [req.auth!.userId],
      ),
    ]);
    const notifications = page.rows.slice(0, 30);
    res.json({
      notifications,
      unread: count.rows[0].unread,
      nextCursor: page.rows.length > 30 ? notifications.at(-1)?.sequence : null,
    });
  });
  router.post("/notifications/read", async (req, res) => {
    const { ids } = z
      .object({ ids: z.array(uuid).max(100).optional() })
      .parse(req.body || {});
    const result = await pool.query(
      "UPDATE user_notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND($2::uuid[] IS NULL OR id=ANY($2)) RETURNING id",
      [req.auth!.userId, ids || null],
    );
    // Old clients still read the company-scoped legacy inbox through /network.
    if (!ids && req.auth!.companyId)
      await pool.query(
        "UPDATE notifications SET read_at=now() WHERE company_id=$1 AND read_at IS NULL",
        [req.auth!.companyId],
      );
    res.json({ ok: true, ids: result.rows.map(row => row.id) });
  });
  router.post("/notifications/read-context", async (req, res) => {
    const { kind, id } = z.object({
      kind: z.enum(["company_conversation", "personal_conversation", "post"]),
      id: uuid,
    }).strict().parse(req.body);
    const auth = req.auth!;
    const accessible = kind === "company_conversation"
      ? await pool.query(`SELECT 1 FROM connections c JOIN memberships m ON m.company_id=$2 AND m.user_id=$3
          WHERE c.id=$1 AND $2 IN(c.company_a,c.company_b)`, [id, auth.companyId, auth.userId])
      : kind === "personal_conversation"
        ? await pool.query(`SELECT 1 FROM personal_threads t WHERE t.id=$1 AND (t.user_id=$2 OR
            (t.company_id=$3 AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=$2 AND m.company_id=t.company_id)))`,
          [id, auth.userId, auth.companyId])
        : await pool.query("SELECT 1 FROM posts WHERE id=$1 AND status='published'", [id]);
    if (!accessible.rowCount) throw new HttpError(404, "This conversation or post is unavailable.");
    // Only the current reader's notifications for the opened object are cleared.
    // Other company workspaces and unrelated/offscreen inbox rows stay unread.
    const match = kind === "company_conversation"
      ? "n.source_kind='connection' AND n.source_id=$2 AND n.company_id=$3"
      : kind === "personal_conversation"
        ? "n.source_kind='personal' AND n.source_id=$2"
        : "((n.source_kind='post' AND n.source_id=$2) OR (n.source_kind='comment' AND EXISTS(SELECT 1 FROM post_comments c WHERE c.id=n.source_id AND c.post_id=$2)))";
    const result = await pool.query(`UPDATE user_notifications n SET read_at=now() WHERE n.user_id=$1
      AND n.read_at IS NULL AND (n.company_id IS NULL OR n.company_id=$3) AND ${visibleNotification}
      AND (${match}) RETURNING n.id`, [auth.userId, id, auth.companyId]);
    res.json({ ok: true, read: result.rowCount || 0, ids: result.rows.map(row => row.id) });
  });
  router.get("/notifications/events", async (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write(": connected\n\n");
    let previous = "",
      checking = false,
      queued = false,
      closed = false;
    let unsubscribe = () => {};
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      unsubscribe();
      streams.delete(close);
      res.end();
    };
    const tick = async () => {
      if (closed) return;
      if (checking) {
        queued = true;
        return;
      }
      checking = true;
      try {
        if (
          !(
            await pool.query(
              "SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now()",
              [req.auth!.tokenHash],
            )
          ).rowCount
        ) {
          close();
          return;
        }
        const r = (
          await pool.query(
            `SELECT COALESCE(max(sequence),0)::text AS latest,count(*) FILTER(WHERE read_at IS NULL)::int AS unread FROM user_notifications n WHERE user_id=$1 AND ${visibleNotification}`,
            [req.auth!.userId],
          )
        ).rows[0];
        const signature = JSON.stringify(r);
        if (previous !== signature) {
          previous = signature;
          res.write("event: changed\ndata: {}\n\n");
        } else res.write(": heartbeat\n\n");
      } catch {
        close();
      } finally {
        checking = false;
        if (queued && !closed) {
          queued = false;
          void tick();
        }
      }
    };
    const timer = setInterval(() => void tick(), 5000);
    timer.unref();
    unsubscribe = subscribeNotificationChanges(
      req.auth!.userId,
      () => void tick(),
    );
    streams.add(close);
    req.on("close", close);
    void tick();
  });
  return router;
}

export type PushPayload = {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  companyId: string;
  recipientUserId: string;
  bindingId: string;
  createdAt: string;
};
export type PushSender = (device: any, payload: PushPayload) => Promise<void>;
let firebaseInit: Promise<void> | null = null;
async function initializeFirebase() {
  if (!firebaseInit)
    firebaseInit = (async () => {
      if (!getApps().some((a) => a.name === "connect-push"))
        initializeApp(
          {
            credential: cert(
              JSON.parse(
                await fs.readFile(
                  process.env.FIREBASE_SERVICE_ACCOUNT_FILE!,
                  "utf8",
                ),
              ),
            ),
          },
          "connect-push",
        );
    })().catch((error) => {
      firebaseInit = null;
      throw error;
    });
  await firebaseInit;
}
async function sendPush(device: any, payload: PushPayload) {
  if (device.platform === "web") {
    await webpush.sendNotification(
      {
        endpoint: device.address,
        keys: { p256dh: device.p256dh, auth: device.auth },
      },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: process.env.WEB_PUSH_SUBJECT!,
          publicKey: process.env.WEB_PUSH_PUBLIC_KEY!,
          privateKey: process.env.WEB_PUSH_PRIVATE_KEY!,
        },
        TTL: 86400,
        urgency: payload.type === "message" ? "high" : "normal",
        timeout: 10000,
      },
    );
    return;
  }
  await initializeFirebase();
  await getMessaging(getApps().find((a) => a.name === "connect-push")!).send({
    token: device.address,
    data: payload,
    android: { priority: "high", ttl: 86400000 },
  });
}
function invalidRegistration(error: any) {
  return (
    error?.statusCode === 404 ||
    error?.statusCode === 410 ||
    [
      "messaging/registration-token-not-registered",
      "messaging/invalid-registration-token",
    ].includes(error?.code)
  );
}
export async function flushPush(sender: PushSender = sendPush) {
  if (sender !== sendPush && process.env.NODE_ENV !== "test")
    throw new Error("Custom push senders are test-only.");
  const lease = randomUUID();
  const claimed = await tx(
    async (db) =>
      (
        await db.query(
          `WITH due AS(SELECT id FROM push_deliveries WHERE delivered_at IS NULL AND expires_at>now() AND next_attempt_at<=now() AND(lease_until IS NULL OR lease_until<now()) ORDER BY id LIMIT 25 FOR UPDATE SKIP LOCKED)
 UPDATE push_deliveries d SET lease_until=now()+interval '10 minutes',lease_token=$1 FROM due WHERE d.id=due.id RETURNING d.id,d.notification_id,d.device_id`,
          [lease],
        )
      ).rows,
  );
  const configuration = sender === sendPush ? await pushConfiguration() : null;
  const deliver = async (item: any) => {
    const row = (
      await pool.query(
        `SELECT d.*,n.id AS notification_id,n.type,n.category,n.title,n.text,n.url,n.company_id,n.created_at AS notification_created_at,
   COALESCE((to_jsonb(p)->>n.category)::boolean,true) AS category_enabled,COALESCE(p.previews,false) AS previews
   FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash AND s.user_id=d.user_id AND s.expires_at>now()
   JOIN user_notifications n ON n.id=$2 AND n.user_id=d.user_id LEFT JOIN notification_preferences p ON p.user_id=d.user_id
   WHERE d.id=$1 AND n.read_at IS NULL AND ${visibleNotification}
   AND (n.source_kind<>'release' OR EXISTS(SELECT 1 FROM notification_releases r WHERE r.id=n.source_id AND r.platform=d.platform
   AND (r.platform<>'android' OR d.app_version_code IS NULL OR (r.version ~ '^[0-9]+$' AND d.app_version_code<r.version::bigint))))`,
        [item.device_id, item.notification_id],
      )
    ).rows[0];
    if (!row || !row.category_enabled) {
      await pool.query(
        "DELETE FROM push_deliveries WHERE id=$1 AND lease_token=$2",
        [item.id, lease],
      );
      return;
    }
    const enabled =
      row.platform === "web"
        ? configuration?.webPush.enabled
        : configuration?.fcm.enabled;
    if (!enabled && sender === sendPush) {
      await pool.query(
        "UPDATE push_deliveries SET lease_until=NULL,lease_token=NULL,next_attempt_at=now()+interval '15 minutes',last_error='provider_not_configured' WHERE id=$1 AND lease_token=$2",
        [item.id, lease],
      );
      return;
    }
    const payload: PushPayload = {
      id: row.notification_id,
      type: row.type,
      title: row.previews ? row.title : "Connect",
      body: row.previews
        ? row.text
        : row.category === "messages"
          ? "You have a new message."
          : row.category === "updates"
            ? "A Connect update is available."
            : "You have a new notification.",
      url: row.url,
      companyId: row.company_id || "",
      recipientUserId: row.user_id,
      bindingId: row.binding_id,
      createdAt: new Date(row.notification_created_at).toISOString(),
    };
    try {
      await sender(row, payload);
      await pool.query(
        "UPDATE push_deliveries SET delivered_at=now(),attempts=attempts+1,lease_until=NULL,lease_token=NULL,last_error=NULL WHERE id=$1 AND lease_token=$2",
        [item.id, lease],
      );
    } catch (error: any) {
      if (invalidRegistration(error)) {
        await pool.query(
          "DELETE FROM push_devices WHERE id=$1 AND binding_id=$2",
          [row.id, row.binding_id],
        );
        return;
      }
      // Do not persist provider response bodies: they may contain tokens/endpoints.
      await pool.query(
        `UPDATE push_deliveries SET attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>LEAST(21600,60*power(2,LEAST(attempts,8)))::int),lease_until=NULL,lease_token=NULL,last_error='provider_delivery_failed',expires_at=CASE WHEN attempts>=9 THEN now() ELSE expires_at END WHERE id=$1 AND lease_token=$2`,
        [item.id, lease],
      );
    }
  };
  for (let offset = 0; offset < claimed.length; offset += 5) {
    const outcomes = await Promise.allSettled(
      claimed.slice(offset, offset + 5).map(deliver),
    );
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}
export async function pruneNotifications() {
  await pool.query(
    "DELETE FROM push_devices WHERE updated_at<now()-interval '90 days'; DELETE FROM push_deliveries WHERE expires_at<now() OR delivered_at<now()-interval '7 days'; DELETE FROM user_notifications WHERE expires_at<now()",
  );
}
export async function recordNotificationRelease(
  platform: "android" | "web",
  version: string,
  title: string,
  body: string,
) {
  await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "push-release:" + platform,
    ]);
    const baseline = !!(
      await db.query(
        "SELECT 1 FROM notification_releases WHERE platform=$1 LIMIT 1",
        [platform],
      )
    ).rowCount;
    // First deployment records a baseline without advertising a historical release.
    await db.query(
      "INSERT INTO notification_releases(platform,version,title,body,announce) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [platform, version, title, body, baseline],
    );
  });
}
