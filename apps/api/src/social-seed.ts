import fs from "node:fs/promises";
import path from "node:path";
import { pool, tx, root } from "./db.js";
export async function seedSocial() {
  const dir = path.resolve(root, process.env.UPLOAD_DIR || "uploads", "posts");
  await fs.mkdir(dir, { recursive: true });
  const examples = [
    {
      id: "31000000-0000-4000-8000-000000000001",
      slug: "solara-supply",
      hours: 8,
      body: "A question for the installation teams here: what’s the one thing a supplier can do to make your delivery day easier?\n\nFor us, it starts with a clear receiving plan. Site access, unloading equipment, and a named contact — agreed before the truck leaves.\n\nWould love to hear what works for your crews.",
      image: null,
    },
    {
      id: "31000000-0000-4000-8000-000000000002",
      slug: "brightfield-energy",
      hours: 4,
      body: "Good projects start with the right people around the table.\n\nWe’re getting to know commercial installation teams across Texas and Colorado. If your team works on C&I rooftops, tell us a little about the projects you love working on.\n\nAlways happy to meet another team in the industry. ☀️",
      image: null,
    },
    {
      id: "31000000-0000-4000-8000-000000000003",
      slug: "helioworks-solar",
      hours: 2,
      body: "There’s a lot of teamwork behind a rooftop like this.\n\nFrom the first site walk to the last commissioning check, the best part is seeing design, procurement, and installation come together.\n\nWhat’s your team working on this week?",
      image: "solar.jpg",
    },
  ];
  for (const item of examples) {
    if (
      (await pool.query("SELECT 1 FROM posts WHERE id=$1", [item.id])).rowCount
    )
      continue;
    const owner = (
      await pool.query(
        "SELECT c.id,m.user_id FROM companies c JOIN memberships m ON m.company_id=c.id AND m.role='owner' WHERE c.slug=$1 LIMIT 1",
        [item.slug],
      )
    ).rows[0];
    if (!owner) continue;
    const bytes = item.image
      ? await fs.readFile(path.join(root, "apps/web/public/assets", item.image))
      : null;
    const storage = "demo-" + item.id + ".jpg";
    if (bytes) await fs.writeFile(path.join(dir, storage), bytes);
    await tx(async (db) => {
      await db.query(
        "INSERT INTO posts(id,company_id,author_id,body,is_demo,created_at) VALUES($1,$2,$3,$4,true,now()-$5*interval '1 hour')",
        [item.id, owner.id, owner.user_id, item.body, item.hours],
      );
      if (bytes)
        await db.query(
          "INSERT INTO post_media(post_id,storage_name,original_name,mime_type,size,position,alt) VALUES($1,$2,'solar-rooftop.jpg','image/jpeg',$3,0,'Illustrative stock photograph of solar panels in sunlight')",
          [item.id, storage, bytes.length],
        );
    });
  }
}
