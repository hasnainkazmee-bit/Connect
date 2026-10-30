import { Router } from "express";
import { z } from "zod";
import { pool, tx, HttpError } from "./db.js";
import { requireVerified } from "./auth.js";
import { sessionPayload } from "./accounts.js";

const handle = z.string().trim().toLowerCase().min(1).max(100);
const companyLookup = `SELECT id,name,username,slug,logo_url,logo_style,tagline,location FROM companies
  WHERE username=$1 OR slug=$1 OR id=(SELECT company_id FROM company_username_history WHERE username=$1)
  ORDER BY (username=$1) DESC NULLS LAST LIMIT 1`;

// A company welcome link is public. Access is granted by a verified email
// matching a live invitation, never by possession of the URL.
export function employeeInvitationRoutes() {
  const router = Router();
  router.get("/join/:username", async (req, res) => {
    const company = (
      await pool.query(companyLookup, [handle.parse(req.params.username)])
    ).rows[0];
    if (!company)
      throw new HttpError(
        404,
        "We couldn’t find this company. Check the invitation link.",
      );
    const invitation =
      req.auth?.accountType === "company"
        ? (
            await pool.query(
              `SELECT role,expires_at FROM team_invites WHERE company_id=$1 AND email=$2
          AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1`,
              [company.id, req.auth.email],
            )
          ).rows[0] || null
        : null;
    const member = req.auth
      ? !!(
          await pool.query(
            "SELECT 1 FROM memberships WHERE company_id=$1 AND user_id=$2",
            [company.id, req.auth.userId],
          )
        ).rowCount
      : false;
    res.json({ company, invitation, member });
  });
  router.post("/join/:username/accept", requireVerified, async (req, res) => {
    if (req.auth!.accountType === "individual")
      throw new HttpError(
        403,
        "Employee access requires a company account. Individual accounts cannot join company teams.",
      );
    const companyId = await tx(async (db) => {
      const company = (
        await db.query(companyLookup, [handle.parse(req.params.username)])
      ).rows[0];
      if (!company) throw new HttpError(404, "Company not found.");
      // Serialize acceptance with replacement invitations for this company.
      await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        company.id,
      ]);
      const invite = (
        await db.query(
          `SELECT id,role FROM team_invites WHERE company_id=$1 AND email=$2
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [company.id, req.auth!.email],
        )
      ).rows[0];
      if (!invite)
        throw new HttpError(
          404,
          "There’s no active invitation for this email. Sign in with your invited work email or ask your company for a new invitation.",
        );
      await db.query(
        "INSERT INTO memberships(user_id,company_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [req.auth!.userId, company.id, invite.role],
      );
      await db.query("UPDATE team_invites SET accepted_at=now() WHERE id=$1", [
        invite.id,
      ]);
      await db.query("UPDATE sessions SET company_id=$1 WHERE token_hash=$2", [
        company.id,
        req.auth!.tokenHash,
      ]);
      await db.query(
        "UPDATE users SET onboarding_completed_at=COALESCE(onboarding_completed_at,now()) WHERE id=$1",
        [req.auth!.userId],
      );
      return company.id;
    });
    res.json(await sessionPayload(req.auth!.userId, companyId));
  });
  return router;
}
