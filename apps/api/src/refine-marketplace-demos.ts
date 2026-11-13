import { pool, tx } from "./db.js";

// These one-off legacy imports bypass the immutable quote workflow.
if (
  (await pool.query(
    "SELECT to_regclass('public.job_quote_versions') IS NOT NULL AS active",
  )).rows[0].active
) {
  await pool.end();
  throw new Error(
    "Project quote history is enabled. Create or revise demo quotes through the jobs API instead of this legacy import.",
  );
}
if (process.env.ALLOW_DEMO_SEED !== "true")
  throw new Error(
    "Set ALLOW_DEMO_SEED=true for fictional marketplace examples.",
  );
// Only replace untouched generated example content. Real work and edited demos are excluded.
const examples: Record<
  string,
  {
    scope: string;
    requirements: string;
    size: number | null;
    sites: number;
    supplies: string;
    approach: string;
    included: string;
    excluded: string;
    duration: string;
  }
> = {
  installation: {
    scope:
      "Install and commission rooftop PV across three occupied commercial buildings. Approved layouts and structural reports will be provided before mobilization.\n\nScope of work\n• Install roof attachments, racking, and modules to the issued drawings.\n• Route DC cabling, label equipment, and complete installation checks.\n• Coordinate electrical tie-in with our electrical contractor.\n• Provide test records, as-built markups, and a photo handover for each site.\n\nSite coordination\nWork is planned for weekdays, 7 am–4 pm. Maintain clear tenant access and leave each roof clean at the end of the shift. Include mobilization and fall-protection arrangements in your quote.",
    requirements:
      "Commercial rooftop experience; applicable contractor licenses; current liability and workers’ compensation coverage. Share proposed crew size and a site-specific safety plan before mobilization.",
    size: 180,
    sites: 3,
    supplies: "hiring_company",
    approach:
      "We propose a dedicated four-person crew, starting with a site walk and material check. We will complete one rooftop at a time, issue weekly photo updates, and hand over test records at each site.",
    included:
      "Installation labor, standard tools, mobilization, fall protection, labeling, and as-built markups.",
    excluded:
      "PV modules, racking, inverters, permits, utility fees, and the main electrical tie-in.",
    duration: "3–4 weeks",
  },
  electrical: {
    scope:
      "Complete the electrical installation and commissioning support for a 900 kW commercial rooftop array. Mechanical installation is being managed by a separate contractor.\n\nScope of work\n• Review the single-line diagram and confirm conduit routes on site.\n• Install AC feeders, disconnects, grounding, and specified protection.\n• Terminate inverter circuits and coordinate the interconnection inspection.\n• Perform required electrical testing and provide commissioning records.\n\nShutdown planning\nThe facility remains operational. State your proposed shutdown window and any assumptions about utility scheduling in the quote.",
    requirements:
      "Electrical contractor license valid for the project location; commercial PV interconnection experience; proof of insurance. Include testing and inspection coordination in the proposal.",
    size: 900,
    sites: 1,
    supplies: "provider",
    approach:
      "Our electrical lead will verify the single-line diagram and agree on a shutdown plan before work starts. The team will install and test each feeder, then coordinate final commissioning with the project manager.",
    included:
      "Electrical labor, specified conduit and cable, terminations, testing, and inspection coordination.",
    excluded:
      "Inverters, utility charges, unplanned switchgear replacement, and work outside the approved drawings.",
    duration: "4–5 weeks",
  },
  roofing: {
    scope:
      "Prepare two commercial roofs ahead of a solar installation. The buildings are occupied and the solar contractor will follow after the roof work is accepted.\n\nScope of work\n• Inspect the designated installation areas and document existing conditions.\n• Repair identified membrane defects and flashing around planned penetrations.\n• Coordinate mounting locations with the solar installer.\n• Carry out a final water-tightness inspection and provide before-and-after photos.\n\nPlease separate known repairs from any provisional work discovered during the site visit. No full roof replacement is included in the base scope.",
    requirements:
      "Experience with commercial membrane roofing and solar coordination. Share insurance details, proposed repair materials, and workmanship warranty terms.",
    size: null,
    sites: 2,
    supplies: "provider",
    approach:
      "We will inspect both roofs, confirm the repair schedule with the solar team, and complete the work in sections to minimize disruption. Any additional defects will be documented and agreed before repair.",
    included:
      "Roof inspection, specified patch materials, flashing repairs, labor, waste removal, and final photo report.",
    excluded:
      "Full roof replacement, structural repairs, hazardous material removal, and defects outside the agreed areas.",
    duration: "7–10 working days",
  },
  service: {
    scope:
      "Inspect and service four operating commercial PV sites. We need a clear picture of system condition and a prioritized list of corrective actions.\n\nScope of work\n• Review monitoring alerts and maintenance history provided by our team.\n• Inspect modules, racking, cabling, and accessible electrical connections.\n• Test suspect strings and investigate underperforming areas.\n• Complete minor corrective work within the agreed allowance.\n• Deliver a site-by-site report with photos, test results, and recommended repairs.\n\nCoordinate access before each visit. Any outage or component replacement needs written approval.",
    requirements:
      "PV service experience, appropriate electrical credentials, and current insurance. Provide a sample inspection report and describe your test equipment.",
    size: 420,
    sites: 4,
    supplies: "to_agree",
    approach:
      "Our service technicians will review the monitoring data first, then visit each site with a consistent inspection checklist. Reports will separate urgent safety items from performance improvements and routine maintenance.",
    included:
      "Four site visits, visual inspection, diagnostic testing, monitoring review, and written condition reports.",
    excluded:
      "Replacement inverters or modules, major repairs, cleaning, and any work requiring a separate outage plan.",
    duration: "2–3 weeks",
  },
  design: {
    scope:
      "Develop an electrical design package for adding battery storage to an existing commercial solar installation. Existing site drawings and load information will be supplied.\n\nScope of work\n• Review the existing PV system and available load data.\n• Confirm storage integration requirements and proposed equipment location.\n• Produce an updated single-line diagram, equipment schedule, and electrical layout.\n• Identify protection, metering, and utility coordination requirements.\n• Include two consolidated design review rounds and issue a final drawing package.\n\nState any assumptions about the battery specification, engineering stamp, and utility studies separately.",
    requirements:
      "Commercial solar-plus-storage design experience. Identify the responsible engineer and applicable licensing. Include a deliverables list and file formats with the quote.",
    size: 250,
    sites: 1,
    supplies: "to_agree",
    approach:
      "We will begin with a design workshop and document review, develop the proposed integration, and issue a coordinated drawing package through two review rounds. Open questions will be tracked with the project team.",
    included:
      "Document review, electrical design, single-line and layout drawings, equipment schedule, and two review rounds.",
    excluded:
      "Site surveying, structural design, utility studies, permit fees, and additional review rounds.",
    duration: "3 weeks",
  },
};
let count = 0;
await tx(async (db) => {
  const { rows } = await db.query(
    "SELECT j.id,j.trade FROM jobs j JOIN companies c ON c.id=j.hiring_company_id WHERE c.is_demo AND c.slug LIKE 'demo-%' AND j.description LIKE 'Demo project:%' AND j.status='open' FOR UPDATE OF j",
  );
  for (const job of rows) {
    const x = examples[job.trade];
    if (!x) continue;
    await db.query(
      "UPDATE jobs SET description=$2,project_type='commercial',system_size_kw=$3,site_count=$4,materials_by=$5,requirements=$6 WHERE id=$1",
      [job.id, x.scope, x.size, x.sites, x.supplies, x.requirements],
    );
    const quotes = await db.query(
      "SELECT id,amount_cents FROM job_quotes WHERE job_id=$1 AND note LIKE 'We can provide a dedicated crew%' AND status='submitted'",
      [job.id],
    );
    for (const q of quotes.rows) {
      const total = Number(q.amount_cents);
      const labor = Math.round(total * 0.8);
      await db.query(
        "UPDATE job_quotes SET note=$2,included=$3,excluded=$4,duration=$5,price_breakdown=$6::jsonb WHERE id=$1",
        [
          q.id,
          x.approach,
          x.included,
          x.excluded,
          x.duration,
          JSON.stringify([
            {
              label:
                job.trade === "design"
                  ? "Design and documentation"
                  : "Labor and delivery",
              amountCents: labor,
            },
            {
              label:
                job.trade === "design"
                  ? "Review and coordination"
                  : "Mobilization, materials, and coordination",
              amountCents: total - labor,
            },
          ]),
        ],
      );
    }
    count++;
  }
});
console.log(
  `Refined ${count} untouched fictional job briefs and their example quotes.`,
);
await pool.end();
