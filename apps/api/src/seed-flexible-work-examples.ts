import { pool, tx } from "./db.js";

if (process.env.ALLOW_DEMO_SEED !== "true")
  throw new Error("Enable fictional demo seeding explicitly.");
const examples = [
  {
    email: "demo03@connect.example",
    title: "Need a 4-person installation crew for two weeks",
    trade: "crew",
    location: "Dallas, TX",
    start: "Within 2 weeks",
    duration: "2 weeks",
    people: 4,
    arrangement: "onsite",
    budget: 1800000,
    description:
      "We need an experienced crew to support our team with racking and module installation on a commercial rooftop. Our site supervisor will coordinate the work and our electricians will handle the connections.\n\nPlan for weekdays, 7 am–3 pm. We will provide modules, racking, and site access. Please include labor, travel, standard tools, and fall-protection equipment in your total quote.\n\nTell us your crew size, earliest availability, and recent commercial rooftop experience.",
    requirements:
      "Commercial rooftop experience, current liability insurance, and documented working-at-height training.",
  },
  {
    email: "demo05@connect.example",
    title: "Electrician needed to diagnose an inverter fault",
    trade: "electrical",
    location: "Phoenix, AZ",
    start: "This week",
    duration: "1–2 days",
    people: null,
    arrangement: "onsite",
    budget: null,
    description:
      "One inverter at an operating commercial site is repeatedly disconnecting. We need a licensed electrician to inspect the AC connections, review fault history, and identify the cause.\n\nInclude a site visit, testing, and a short findings report. Any repair or replacement parts will be agreed separately after diagnosis. Monitoring logs and equipment details will be shared before the visit.",
    requirements:
      "Applicable electrical license, experience with commercial PV troubleshooting, and appropriate test equipment.",
  },
  {
    email: "demo07@connect.example",
    title: "Remote design support for a residential permit package",
    trade: "design",
    location: "Remote",
    start: "Within 1 week",
    duration: "3–5 working days",
    people: null,
    arrangement: "remote",
    budget: 85000,
    description:
      "Our installation team needs help preparing a permit drawing package for a residential rooftop system in Colorado. We have a site survey, roof measurements, equipment specifications, and an initial layout ready to share.\n\nPlease include the roof layout, single-line diagram, equipment schedule, and one consolidated revision. Identify whether engineering stamps are included or quoted separately. All coordination can happen remotely.",
    requirements:
      "Experience with residential solar permit drawings and local submission requirements. Share a redacted example of a similar drawing package.",
  },
];
let added = 0;
await tx(async (db) => {
  await db.query("SELECT pg_advisory_xact_lock(22112026)");
  for (const x of examples) {
    const {
      rows: [owner],
    } = await db.query(
      "SELECT u.id AS user_id,c.id AS company_id FROM users u JOIN memberships m ON m.user_id=u.id JOIN companies c ON c.id=m.company_id WHERE u.email=$1 AND c.is_demo AND c.slug LIKE 'demo-%' AND m.role='owner' LIMIT 1",
      [x.email],
    );
    if (!owner) continue;
    const result = await db.query(
      `INSERT INTO jobs(hiring_company_id,author_id,title,trade,description,requirements,location,start_window,expected_duration,people_needed,work_arrangement,budget_cents,status)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open'
      WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE hiring_company_id=$1 AND title=$3)`,
      [
        owner.company_id,
        owner.user_id,
        x.title,
        x.trade,
        x.description,
        x.requirements,
        x.location,
        x.start,
        x.duration,
        x.people,
        x.arrangement,
        x.budget,
      ],
    );
    added += result.rowCount || 0;
  }
});
console.log(
  `Added ${added} fictional crew and specialist requests. Existing records were preserved.`,
);
await pool.end();
