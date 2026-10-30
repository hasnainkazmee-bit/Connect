import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import type { PoolClient } from "pg";
import { pool, HttpError, tx } from "./db.js";

function secret() {
  const value = process.env.AUTH_TOKEN_SECRET || "";
  if (value.length < 32) throw new HttpError(503, "Account email is not configured yet. Please try again later.");
  return createHash("sha256").update(value).digest();
}
export const codeHash = (id: string, code: string) => createHmac("sha256", secret()).update(`${id}:${code}`).digest("hex");
function seal(text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
function open(value: string) {
  const data = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", secret(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8");
}
export async function queueCode(db: PoolClient, email: string, code: string, purpose: "verify" | "reset") {
  const subject = purpose === "verify" ? "Verify your Connect email" : "Reset your Connect password";
  const text = `${purpose === "verify" ? "Welcome to Connect. Your verification code is" : "Your Connect password reset code is"}: ${code}\n\nEnter this code in Connect. It expires in 10 minutes and can be used once. If you didn't request it, you can ignore this email.`;
  await db.query("INSERT INTO email_outbox(recipient,subject,payload_encrypted,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')", [email, subject, seal(text)]);
}
let flushing = false;
export async function flushMail() {
  if (flushing || !process.env.SMTP_HOST) return;
  flushing = true;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    requireTLS: process.env.SMTP_REQUIRE_TLS !== "false",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 5000, socketTimeout: 10000,
  });
  try {
    // Short row locks prevent two API workers from delivering the same queued message.
    await tx(async db => {
      const { rows } = await db.query("SELECT * FROM email_outbox WHERE sent_at IS NULL AND payload_encrypted IS NOT NULL AND expires_at>now() AND available_at<=now() AND attempts<6 ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED");
      for (const row of rows) {
        try {
          await transport.sendMail({ from: process.env.MAIL_FROM || "Connect <hello@connect.local>", to: row.recipient, subject: row.subject, text: open(row.payload_encrypted) });
          await db.query("UPDATE email_outbox SET sent_at=now(),payload_encrypted=NULL WHERE id=$1", [row.id]);
        } catch {
          await db.query("UPDATE email_outbox SET attempts=attempts+1,available_at=now()+interval '30 seconds'*power(2,attempts) WHERE id=$1", [row.id]);
        }
      }
    });
    await pool.query("UPDATE email_outbox SET payload_encrypted=NULL WHERE expires_at<=now() AND payload_encrypted IS NOT NULL");
  } finally { transport.close(); flushing = false; }
}
