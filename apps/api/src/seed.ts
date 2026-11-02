import { seedSocial } from "./social-seed.js";
import { pool, tx } from "./db.js";
import { hashPassword } from "./auth.js";
if (
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_DEMO_SEED !== "true"
)
  throw new Error(
    "Demo seed is disabled in production. Set ALLOW_DEMO_SEED=true only for a local demo.",
  );
const companies = [
  {
    slug: "helioworks-solar",
    name: "HelioWorks Solar",
    type: "EPC",
    location: "Austin, TX",
    areas: ["Texas", "California", "Colorado", "Arizona"],
    services: ["Design", "Installation", "O&M", "Energy storage"],
    tagline: "Design. Build. Power a brighter tomorrow.",
    description:
      "HelioWorks Solar is a full-service solar EPC specializing in commercial and industrial projects. We design, install, and maintain solar systems that help businesses build dependable energy for the long term.",
    style: "sun",
    person: "Maya Chen",
    email: "maya@helioworks.test",
    title: "Business development",
  },
  {
    slug: "brightfield-energy",
    name: "Brightfield Energy",
    type: "Developer",
    location: "Denver, CO",
    areas: ["Colorado", "Texas", "Arizona"],
    services: ["Development", "EPC", "Energy storage"],
    tagline: "Commercial solar made simple.",
    description:
      "We develop and deliver commercial solar projects across the Southwest. Our team brings together engineering, procurement and the right local installation partners.",
    style: "leaf",
    person: "Amina Khan",
    email: "amina@brightfield.test",
    title: "Partnerships",
  },
  {
    slug: "solara-supply",
    name: "Solara Supply Co.",
    type: "Distributor",
    location: "Phoenix, AZ",
    areas: ["United States"],
    services: ["Equipment supply", "Logistics"],
    tagline: "Solar equipment you can count on.",
    description:
      "Modules, inverters and storage for installers and developers. We help projects move forward with reliable sourcing and delivery.",
    style: "panel",
    person: "Sam Patel",
    email: "sam@solara.test",
    title: "Sales",
  },
  {
    slug: "greenridge-power",
    name: "Greenridge Power",
    type: "Developer",
    location: "San Diego, CA",
    areas: ["California", "Arizona"],
    services: ["Development", "EPC", "O&M"],
    tagline: "Clean energy for a brighter tomorrow.",
    description:
      "A commercial energy developer focused on lasting partnerships, thoughtful design and reliable project delivery.",
    style: "building",
    person: "Alex Rivera",
    email: "alex@greenridge.test",
    title: "Company owner",
  },
  {
    slug: "cedar-roof-solar",
    name: "Cedar Roof Solar",
    type: "Installer",
    location: "Boulder, CO",
    areas: ["Colorado"],
    services: ["Installation", "Residential solar", "Energy storage"],
    tagline: "A brighter future, one rooftop at a time.",
    description:
      "Residential installations, battery storage and ongoing care throughout the Colorado Front Range.",
    style: "leaf",
    person: "Jordan Lee",
    email: "jordan@cedar.test",
    title: "Operations",
  },
  {
    slug: "suncraft-installations",
    name: "Suncraft Installations",
    type: "Installer",
    location: "Austin, TX",
    areas: ["Texas"],
    services: ["Installation", "O&M"],
    tagline: "Experienced crews. Exceptional installations.",
    description:
      "Commercial installation teams for EPCs and project developers throughout Texas.",
    style: "sun",
    person: "Taylor Morgan",
    email: "taylor@suncraft.test",
    title: "Partnerships",
  },
];
const password = await hashPassword("SunhubDemo123!");
await tx(async (db) => {
  for (const c of companies) {
    const company = (
      await db.query(
        `INSERT INTO companies(slug,name,type,location,service_areas,services,tagline,description,logo_style,website,established,cover_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,2016,$11) ON CONFLICT(slug) DO NOTHING RETURNING id`,
        [
          c.slug,
          c.name,
          c.type,
          c.location,
          c.areas,
          c.services,
          c.tagline,
          c.description,
          c.style,
          "",
          c.style === "building" ? "/assets/office.jpg" : "/assets/solar.jpg",
        ],
      )
    ).rows[0];
    if (!company) continue;
    await db.query("UPDATE companies SET is_demo=true WHERE id=$1", [
      company.id,
    ]);
    const user = (
      await db.query(
        "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name RETURNING id",
        [c.person, c.email, password],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO memberships(user_id,company_id,role,title) VALUES($1,$2,'owner',$3) ON CONFLICT DO NOTHING",
      [user.id, company.id, c.title],
    );
    await db.query(
      "INSERT INTO projects(company_id,name,description,location,size,image_url) VALUES($1,$2,$3,$4,$5,$6)",
      [
        company.id,
        c.type === "Distributor"
          ? "Commercial equipment supply"
          : "Westlake commercial rooftop",
        "Sample project for exploring the application. Stock photography is illustrative.",
        c.location,
        "420 kW",
        "/assets/solar.jpg",
      ],
    );
  }
});
console.log(
  "Sample companies created. Local demo accounts: amina@brightfield.test and maya@helioworks.test. Password: SunhubDemo123!",
);
await seedSocial();
await pool.end();
