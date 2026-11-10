import { pool, tx } from "./db.js";
import { hashPassword } from "./auth.js";

if (
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_DEMO_SEED !== "true"
)
  throw new Error(
    "Set ALLOW_DEMO_SEED=true explicitly for production sample data.",
  );
const secret = process.env.DEMO_PASSWORD;
if (!secret || secret.length < 16)
  throw new Error("Set DEMO_PASSWORD to at least 16 characters.");
const password = await hashPassword(secret);
const entries = [
  [
    "Mesa Peak Solar",
    "Installer",
    "Phoenix, AZ",
    "Arizona",
    "Installation, Energy storage",
    "Residential rooftops and home batteries",
    "Rooftop installations and battery work across the Valley, with dedicated crews for residential projects.",
    "Residential solar, Home batteries",
    "Two installation crews",
    "Accepting projects this month",
  ],
  [
    "Blue Ridge PV Works",
    "Installer",
    "Asheville, NC",
    "North Carolina",
    "Installation, Roofing",
    "Residential and light commercial solar",
    "Solar and roofing teams serving western North Carolina, from site preparation through commissioning.",
    "Residential solar, Commercial rooftop",
    "Three field crews",
    "Booking starts in three weeks",
  ],
  [
    "Westline Electrical Solar",
    "Contractor",
    "San Diego, CA",
    "California",
    "Electrical, Service",
    "Electrical crews for solar projects",
    "Licensed electrical contracting for solar interconnection, panel upgrades and field service.",
    "Commercial solar, Panel upgrades",
    "Four electrical crews",
    "Available for new projects",
  ],
  [
    "Canyon Array Partners",
    "EPC",
    "Denver, CO",
    "Colorado",
    "Design, Installation",
    "Commercial solar from design to delivery",
    "Engineering, procurement and construction services for commercial rooftops and ground arrays.",
    "Commercial rooftop, Ground mount",
    "Two EPC teams",
    "Planning next quarter",
  ],
  [
    "Ironwood Solar Roofing",
    "Contractor",
    "Tucson, AZ",
    "Arizona",
    "Roofing, Installation",
    "Roofing and solar under one roof",
    "Roof preparation, structural repairs and solar mounting for residential and commercial projects.",
    "Roof replacement, Residential solar",
    "Three roofing crews",
    "Available this month",
  ],
  [
    "Tidewater Energy Services",
    "Service provider",
    "Norfolk, VA",
    "Virginia",
    "Service, Electrical",
    "Keeping solar systems working",
    "Operations, maintenance and troubleshooting for commercial PV portfolios across coastal Virginia.",
    "Operations and maintenance, Commercial solar",
    "Five service technicians",
    "Taking service calls",
  ],
  [
    "Copper State Installers",
    "Installer",
    "Scottsdale, AZ",
    "Arizona",
    "Installation, Electrical",
    "Field crews built for fast rollouts",
    "Installation crews for EPC partners delivering repeatable residential and commercial solar work.",
    "Residential solar, Commercial rooftop",
    "Four installation crews",
    "Booking starts in two weeks",
  ],
  [
    "North Fork Renewables",
    "EPC",
    "Boise, ID",
    "Idaho",
    "Design, Installation",
    "Solar work with local knowledge",
    "Local design and build teams for commercial solar and storage projects throughout southern Idaho.",
    "Commercial rooftop, Energy storage",
    "Two project teams",
    "Open for estimates",
  ],
  [
    "Clearspan Solar Service",
    "Service provider",
    "Sacramento, CA",
    "California",
    "Service, Electrical",
    "Service that keeps projects online",
    "Inspection, preventative maintenance and inverter replacement for operating solar assets.",
    "Service and maintenance, Asset inspection",
    "Six field technicians",
    "Available this week",
  ],
  [
    "Prairie Light Contracting",
    "Installer",
    "Des Moines, IA",
    "Iowa",
    "Installation, Roofing",
    "Reliable crews across the Midwest",
    "Solar installation and roof preparation for homes, farms and small commercial properties.",
    "Agricultural solar, Residential solar",
    "Two installation crews",
    "Accepting spring projects",
  ],
  [
    "Summit Grid Electric",
    "Contractor",
    "Salt Lake City, UT",
    "Utah",
    "Electrical, Design",
    "Electrical expertise for clean energy",
    "Interconnection design, switchgear and electrical construction for solar and storage jobs.",
    "Commercial solar, Battery storage",
    "Three electrical crews",
    "Open for bids",
  ],
  [
    "Bayshore PV Builders",
    "Installer",
    "Tampa, FL",
    "Florida",
    "Installation, Service",
    "Built for Florida rooftops",
    "Residential rooftop PV installation, maintenance and battery integration across Tampa Bay.",
    "Residential solar, Home batteries",
    "Four installation crews",
    "Booking next month",
  ],
  [
    "Red Clay Solar Works",
    "Installer",
    "Atlanta, GA",
    "Georgia",
    "Installation, Electrical",
    "Solar projects finished properly",
    "Installation and electrical field services for homes and light commercial sites in metro Atlanta.",
    "Residential solar, Commercial rooftop",
    "Three installation crews",
    "Available for new work",
  ],
  [
    "High Desert EPC",
    "EPC",
    "Albuquerque, NM",
    "New Mexico",
    "Design, Installation",
    "From plans to powered systems",
    "Commercial and community solar engineering and construction with regional field teams.",
    "Community solar, Ground mount",
    "Two EPC teams",
    "Planning next quarter",
  ],
  [
    "Lakefront Solar Mechanics",
    "Service provider",
    "Cleveland, OH",
    "Ohio",
    "Service, Electrical",
    "The team after commissioning",
    "Performance checks, diagnostics and repair for commercial rooftop solar systems.",
    "Operations and maintenance, Commercial rooftop",
    "Five field technicians",
    "Taking service calls",
  ],
  [
    "Evergreen Roof & Solar",
    "Contractor",
    "Portland, OR",
    "Oregon",
    "Roofing, Installation",
    "Roof-ready solar installation",
    "Coordinated roof preparation and solar mounting for homes and commercial buildings.",
    "Residential solar, Commercial rooftop",
    "Three field crews",
    "Booking this month",
  ],
  [
    "Suntrail Project Services",
    "EPC",
    "Austin, TX",
    "Texas",
    "Design, Installation",
    "Commercial solar delivered with clarity",
    "Design-build project support for multi-site commercial solar work throughout central Texas.",
    "Commercial rooftop, Multi-site rollout",
    "Two EPC teams",
    "Open for estimates",
  ],
  [
    "Palmetto Solar Electric",
    "Contractor",
    "Charleston, SC",
    "South Carolina",
    "Electrical, Installation",
    "Electrical and solar fieldwork",
    "Electrical contracting and PV installation for commercial buildings and residential developments.",
    "Commercial solar, Residential solar",
    "Four electrical crews",
    "Available in two weeks",
  ],
  [
    "Riverbend Renewables Crew",
    "Installer",
    "Nashville, TN",
    "Tennessee",
    "Installation, Roofing",
    "Crews for every stage of the roof",
    "Solar installation, racking and roof coordination for homes and small businesses.",
    "Residential solar, Small commercial",
    "Three installation crews",
    "Accepting new projects",
  ],
  [
    "Cascade Solar Engineering",
    "Service provider",
    "Seattle, WA",
    "Washington",
    "Design, Service",
    "Practical design and field support",
    "System design, commissioning and technical service for commercial solar and storage teams.",
    "Commercial solar, Energy storage",
    "Six engineers and technicians",
    "Open for consultations",
  ],
] as const;
const photo = ["/assets/solar.jpg", "/assets/office.jpg"];
await tx(async (db) => {
  for (let i = 0; i < entries.length; i++) {
    const [
      name,
      type,
      location,
      area,
      services,
      tagline,
      description,
      projects,
      crew,
      availability,
    ] = entries[i];
    const slug =
      "demo-" +
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-$/, "");
    const email = `demo${String(i + 1).padStart(2, "0")}@connect.example`;
    const c = (
      await db.query(
        `INSERT INTO companies(slug,username,name,type,location,service_areas,services,tagline,description,website,cover_url,logo_url,employee_count,established,listing_status,is_demo)
    VALUES($1,$1,$2,$3,$4,$5,$6,$7,$8,'',$9,$10,'11–50',2018,'managed',true)
    ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,location=EXCLUDED.location,
      service_areas=EXCLUDED.service_areas,services=EXCLUDED.services,tagline=EXCLUDED.tagline,
      description=EXCLUDED.description,logo_url=EXCLUDED.logo_url,is_demo=true RETURNING id`,
        [
          slug,
          name,
          type,
          location,
          [area],
          services.split(", "),
          tagline,
          description,
          photo[i % 2],
          `/assets/demo-logos/${slug}.svg`,
        ],
      )
    ).rows[0];
    const u = (
      await db.query(
        `INSERT INTO users(name,email,password_hash,email_verified_at,onboarding_completed_at,account_type)
    VALUES($1,$2,$3,now(),now(),'company') ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,
    email_verified_at=now(),onboarding_completed_at=now() RETURNING id`,
        [`Demo ${String(i + 1).padStart(2, "0")} Owner`, email, password],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO memberships(user_id,company_id,role,title) VALUES($1,$2,'owner','Owner') ON CONFLICT DO NOTHING",
      [u.id, c.id],
    );
    await db.query(
      `INSERT INTO provider_profiles(company_id,trades,project_types,availability,crew_size,capacity,license_details,insurance_details)
    VALUES($1,$2,$3,$4,$5,$6,'','') ON CONFLICT(company_id) DO UPDATE SET trades=EXCLUDED.trades,
    project_types=EXCLUDED.project_types,availability=EXCLUDED.availability,crew_size=EXCLUDED.crew_size,
    capacity=EXCLUDED.capacity`,
      [
        c.id,
        services.split(", "),
        projects.split(", "),
        availability,
        crew,
        `Up to ${2 + (i % 5)} active projects`,
      ],
    );
    if (
      !(await db.query("SELECT 1 FROM projects WHERE company_id=$1", [c.id]))
        .rowCount
    ) {
      await db.query(
        "INSERT INTO projects(company_id,name,description,location,size,image_url) VALUES($1,$2,$3,$4,$5,$6)",
        [
          c.id,
          `${projects.split(", ")[0]} project in ${location.split(",")[0]}`,
          `Illustrative ${projects.split(", ")[0].toLowerCase()} project for this demo profile.`,
          location,
          `${120 + i * 15} kW`,
          photo[i % 2],
        ],
      );
      await db.query(
        "INSERT INTO projects(company_id,name,description,location,size,image_url) VALUES($1,$2,$3,$4,$5,$6)",
        [
          c.id,
          `${services.split(", ")[0]} team rollout`,
          `Illustrative project showing the type of work this demo company takes on.`,
          location,
          `${80 + i * 12} kW`,
          photo[(i + 1) % 2],
        ],
      );
    }
    if (
      !(
        await db.query("SELECT 1 FROM posts WHERE company_id=$1 AND is_demo", [
          c.id,
        ])
      ).rowCount
    )
      await db.query(
        `INSERT INTO posts(company_id,author_id,body,is_demo,kind,title,status,published_at)
    VALUES($1,$2,$3,true,'post',$4,'published',now())`,
        [
          c.id,
          u.id,
          `Our ${services.split(", ")[0].toLowerCase()} crews are ${availability.toLowerCase()}. We focus on ${projects.split(", ")[0].toLowerCase()} work in ${area}. This is a sample update for the Connect demo.`,
          `A quick update from ${name}`,
        ],
      );
  }
  for (let i = 0; i < 10; i++) {
    const h = entries[i],
      slug =
        "demo-" +
        h[0]
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/-$/, "");
    const hirer = (
      await db.query(
        "SELECT c.id,m.user_id FROM companies c JOIN memberships m ON m.company_id=c.id WHERE c.slug=$1 AND m.role='owner' LIMIT 1",
        [slug],
      )
    ).rows[0];
    const title =
      [
        "Install rooftop PV at three commercial sites",
        "Electrical scope for a 900 kW rooftop",
        "Roof preparation for solar rollout",
        "Service and inspect operating arrays",
        "Design support for storage integration",
      ][i % 5] + ` — ${h[3]}`;
    let job = (
      await db.query(
        "SELECT id FROM jobs WHERE hiring_company_id=$1 AND title=$2",
        [hirer.id, title],
      )
    ).rows[0];
    if (!job)
      job = (
        await db.query(
          `INSERT INTO jobs(hiring_company_id,author_id,title,description,trade,location,start_window,budget_cents,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'open') RETURNING id`,
          [
            hirer.id,
            hirer.user_id,
            title,
            `Demo project: ${title}. We need a qualified company to review site conditions, outline the scope, schedule its crew and send an itemized quote. This job is sample content for testing the hiring flow.`,
            ["installation", "electrical", "roofing", "service", "design"][
              i % 5
            ],
            h[2],
            "Next 4–6 weeks",
            (18000 + i * 4100) * 100,
          ],
        )
      ).rows[0];
    for (let j = 1; j <= 2; j++) {
      const providerIndex = 10 + ((i + j - 1) % 10),
        pc = entries[providerIndex],
        ps =
          "demo-" +
          pc[0]
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/-$/, "");
      const provider = (
        await db.query(
          "SELECT c.id,m.user_id FROM companies c JOIN memberships m ON m.company_id=c.id WHERE c.slug=$1 AND m.role='owner' LIMIT 1",
          [ps],
        )
      ).rows[0];
      await db.query(
        `INSERT INTO job_quotes(job_id,provider_company_id,author_id,amount_cents,start_window,duration,note,included,excluded,payment_terms)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(job_id,provider_company_id) DO NOTHING`,
        [
          job.id,
          provider.id,
          provider.user_id,
          (16500 + i * 4000 + j * 1700) * 100,
          "Within 3 weeks",
          "4–6 weeks",
          `We can provide a dedicated crew and a clear installation schedule for this demo project. Our quote includes site coordination and weekly progress updates.`,
          "Labor, site coordination, commissioning support",
          "Permits and equipment supply",
          "30% deposit, balance on milestones",
        ],
      );
    }
  }
});
console.log(
  `Seeded ${entries.length} demo providers, 10 sample jobs and 20 sample quotes. Accounts: demo01@connect.example through demo20@connect.example`,
);
await pool.end();
