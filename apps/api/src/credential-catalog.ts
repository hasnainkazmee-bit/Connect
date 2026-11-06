// Public-source research checked 2026-11-06. No inferred certifications or reviews.
// Sources describe evidence, not an endorsement or a blanket current-validity claim.
export type CatalogCredential = {
  company: string;
  key: string;
  category:
    "certification" | "qualification" | "ranking" | "directory" | "membership";
  title: string;
  organization: string;
  scope: "company" | "product" | "personnel";
  scopeDetail: string;
  description: string;
  sourceUrl: string;
  evidenceBasis: "issuer" | "company" | "directory";
  period?: string;
};
export const credentialCatalog: CatalogCredential[] = [
  {
    company: "all-energy-solar",
    key: "energysage",
    category: "directory",
    title: "EnergySage profile",
    organization: "EnergySage",
    scope: "company",
    scopeDetail: "All Energy Solar supplier profile.",
    description:
      "EnergySage displays Approved Installer status on the source profile. Status belongs to that directory and can change.",
    sourceUrl: "https://www.energysage.com/supplier/20385/all-energy-solar/",
    evidenceBasis: "directory",
  },
  {
    company: "all-energy-solar",
    key: "nabcep-personnel",
    category: "qualification",
    title: "NABCEP-certified professionals",
    organization: "NABCEP",
    scope: "personnel",
    scopeDetail:
      "Professionals listed with All Energy Solar in NABCEP's professional directory.",
    description:
      "Individual professional credentials; this is not a company accreditation. Check each person's designation and expiry in the directory.",
    sourceUrl: "https://directories.nabcep.org/?_certtypes=professional",
    evidenceBasis: "issuer",
  },
  {
    company: "namaste-solar",
    key: "b-corp",
    category: "certification",
    title: "Certified B Corporation",
    organization: "B Lab",
    scope: "company",
    scopeDetail: "Namaste Solar business certification.",
    description:
      "B Lab lists certification since January 2011. This addresses business impact and accountability, rather than electrical installation or product safety.",
    sourceUrl:
      "https://www.bcorporation.net/en-us/find-a-b-corp/company/namaste-solar/",
    evidenceBasis: "issuer",
  },
  {
    company: "namaste-solar",
    key: "energysage",
    category: "directory",
    title: "EnergySage profile",
    organization: "EnergySage",
    scope: "company",
    scopeDetail: "Namasté Solar supplier profile.",
    description:
      "The profile explicitly says Not in the EnergySage network and not screened or verified by EnergySage. Listing presence does not imply approval.",
    sourceUrl: "https://www.energysage.com/supplier/23117/namaste-solar/",
    evidenceBasis: "directory",
  },
  {
    company: "namaste-solar",
    key: "nabcep-personnel",
    category: "qualification",
    title: "NABCEP PV Installation Professionals",
    organization: "NABCEP",
    scope: "personnel",
    scopeDetail:
      "Operations and maintenance technicians described in Namaste Solar's FAQ.",
    description:
      "The company reports that its O&M technicians hold PV Installation Professional credentials. Individual certificate numbers and expiry dates are not supplied on this page.",
    sourceUrl: "https://www.namastesolar.com/faqs/",
    evidenceBasis: "company",
  },
  {
    company: "revision-energy",
    key: "b-corp",
    category: "certification",
    title: "Certified B Corporation",
    organization: "B Lab",
    scope: "company",
    scopeDetail: "ReVision Energy Inc business certification.",
    description:
      "B Lab lists certification since July 2015. This is a business impact certification, separate from installation licensing.",
    sourceUrl:
      "https://www.bcorporation.net/en-us/find-a-b-corp/company/revision-energy-llc/",
    evidenceBasis: "issuer",
  },
  {
    company: "revision-energy",
    key: "masscec-directory",
    category: "directory",
    title: "MassCEC installer directory",
    organization: "Massachusetts Clean Energy Center",
    scope: "company",
    scopeDetail: "ReVision Energy installer directory entry.",
    description:
      "A public directory entry; no additional accreditation is inferred from the listing.",
    sourceUrl:
      "https://goclean.masscec.com/installers-directory/revision-energy/",
    evidenceBasis: "directory",
  },
  {
    company: "solar-energy-world",
    key: "energysage",
    category: "directory",
    title: "EnergySage profile",
    organization: "EnergySage",
    scope: "company",
    scopeDetail: "Solar Energy World supplier profile.",
    description:
      "Public business profile and customer reviews. Ratings and review counts are not copied into Connect's own review score.",
    sourceUrl: "https://www.energysage.com/supplier/20021/solar-energy-world/",
    evidenceBasis: "directory",
  },
  {
    company: "silfab-solar",
    key: "energysage",
    category: "directory",
    title: "EnergySage profile",
    organization: "EnergySage",
    scope: "company",
    scopeDetail: "Silfab Solar manufacturer supplier profile.",
    description:
      "The profile states Not in the EnergySage network. A manufacturer listing is not an installer screening or product certification.",
    sourceUrl: "https://www.energysage.com/supplier/20956/silfab-solar/",
    evidenceBasis: "directory",
  },
  {
    company: "silfab-solar",
    key: "ul-61730-sil370bk",
    category: "certification",
    title: "UL 61730 product certification",
    organization: "UL 61730 standard",
    scope: "product",
    scopeDetail: "SIL-370 BK module family in the referenced Silfab datasheet.",
    description:
      "The manufacturer lists UL 61730-1/-2 among the model's certifications. Coverage is limited to the referenced product documentation; confirm the exact model and certificate before purchase.",
    sourceUrl:
      "https://silfabsolar.com/wp-content/uploads/2024/09/Silfab-SIL-370-BK-Data-Generic-20240829-Final.pdf",
    evidenceBasis: "company",
    period: "Datasheet revision August 2024",
  },
  {
    company: "silfab-solar",
    key: "cec-equipment",
    category: "directory",
    title: "California solar equipment list",
    organization: "California Energy Commission",
    scope: "product",
    scopeDetail:
      "Silfab Solar Inc. photovoltaic module entries in the CEC equipment database.",
    description:
      "Check the exact model's record for safety certification and electrical characteristics. Equipment-list inclusion is separate from a blanket company certification.",
    sourceUrl:
      "https://solarequipment.energy.ca.gov/Home/PVModuleList?ManufacturerID=Silfab+Solar+Inc.&sort=PTC&sortdir=ASC",
    evidenceBasis: "directory",
  },
  {
    company: "rec-group",
    key: "ul-61730",
    category: "certification",
    title: "UL 61730 certificate documentation",
    organization: "UL 61730 standard",
    scope: "product",
    scopeDetail:
      "REC panel models covered by the certificate linked from REC's product downloads.",
    description:
      "REC publishes certificate-of-compliance documentation for this module safety standard. Consult the linked certificate for the covered models and conditions.",
    sourceUrl:
      "https://www.recgroup.com/en/downloads/product-downloads/ul-61730",
    evidenceBasis: "company",
  },
  {
    company: "first-solar",
    key: "series6-cure-ul-iec",
    category: "certification",
    title: "UL 61730 / IEC 61215 / IEC 61730",
    organization: "UL and IEC standards",
    scope: "product",
    scopeDetail:
      "First Solar Series 6 CuRe modules under the referenced user guide.",
    description:
      "The guide describes NRTL listing to UL 61730 for North America and certification to IEC 61215 and IEC 61730. Listing conditions depend on installation and the applicable model.",
    sourceUrl:
      "https://www.firstsolar.com/-/media/First-Solar/Technical-Documents/Series-6-CuRe/Series-6-CuRe-User-Guide.pdf",
    evidenceBasis: "company",
    period: "User guide revision 1.0",
  },
  {
    company: "canadian-solar",
    key: "bnef-company-claim",
    category: "ranking",
    title: "BloombergNEF Tier 1 — company-reported",
    organization: "BloombergNEF",
    scope: "company",
    scopeDetail:
      "Canadian Solar's module business, as described on its corporate website.",
    description:
      "The company reports Tier 1 status but the page does not identify a quarter. This is not confirmation of the latest BNEF list. BNEF tiering is not a product-quality or safety certificate.",
    sourceUrl: "https://www.canadiansolar.com/",
    evidenceBasis: "company",
    period: "Quarter not stated by source",
  },
  ...[
    ["canadian-solar", "Canadian Solar Inc."],
    ["first-solar", "First Solar Inc."],
    ["jinkosolar", "Jinko Solar Co. Ltd."],
    ["qcells", "Hanwha Solutions Corp. (Qcells parent)"],
  ].map(([company, entity]): CatalogCredential => ({
    company,
    key: "spglobal-tier1-2026",
    category: "ranking",
    title: "S&P Global Tier 1 PV module supplier",
    organization: "S&P Global Energy",
    scope: "company",
    scopeDetail: `${entity}, named in the 2026 PV module supplier list.`,
    description:
      "Industry supplier classification. This is S&P Global's list, separate from BloombergNEF Tier 1 and from product safety certification.",
    sourceUrl:
      "https://www.spglobal.com/energy/en/news-research/blog/energy-transition/070726-tier-1-cleantech-companies-pv-wind-turbine-battery-cells-storage-systems",
    evidenceBasis: "issuer",
    period: "2026",
  })),
];
export const credentialCheckedAt = "2026-11-06T00:00:00Z";
