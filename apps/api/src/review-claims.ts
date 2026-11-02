import { pool, tx } from "./db.js";
import { approveClaim } from "./directory.js";
import { z } from "zod";

// Operator-only command: database access is required. There is no public admin API.
const [action = "list", id, reviewer, ...reason] = process.argv.slice(2);
try {
  if (action === "list") {
    const { rows } = await pool.query(
      "SELECT cl.id,c.name,u.email,cl.role_description,cl.evidence,cl.created_at FROM company_claims cl JOIN companies c ON c.id=cl.company_id JOIN users u ON u.id=cl.user_id WHERE cl.status='pending' ORDER BY cl.created_at",
    );
    console.log(JSON.stringify(rows, null, 2));
  } else {
    z.string().uuid().parse(id);
    const who = z.string().min(3).max(120).parse(reviewer);
    const note = z.string().min(20).max(2000).parse(reason.join(" "));
    if (!["approve", "reject"].includes(action))
      throw new Error("Use list, approve, or reject.");
    await tx(async (db) => {
      if (action === "approve") await approveClaim(db, id, who, note);
      else {
        const result = await db.query(
          "UPDATE company_claims SET status='rejected',reviewed_by=$2,review_note=$3,reviewed_at=now() WHERE id=$1 AND status='pending' RETURNING id",
          [id, who, note],
        );
        if (!result.rowCount) throw new Error("Pending claim not found.");
      }
    });
    console.log(`Claim ${id}: ${action} completed.`);
  }
} finally {
  await pool.end();
}
