// Shared by API validation and the web forms. Keep this module dependency-free
// so the browser can use the same names without importing server code.
export const companyTypes = [
  {
    value: "Installer",
    label: "Installer",
    description: "Installs solar or storage systems.",
  },
  {
    value: "EPC",
    label: "EPC",
    description: "Handles engineering, procurement and construction.",
  },
  {
    value: "Contractor",
    label: "Contractor",
    description:
      "Provides crews, electrical, roofing or other contracted work.",
  },
  {
    value: "Developer",
    label: "Developer",
    description: "Develops solar or storage projects.",
  },
  {
    value: "Distributor",
    label: "Distributor",
    description: "Distributes equipment from manufacturers to businesses.",
  },
  {
    value: "Manufacturer",
    label: "Manufacturer",
    description: "Makes solar, storage or related equipment.",
  },
  {
    value: "Service provider",
    label: "Service provider",
    description: "Provides other professional or specialist services.",
  },
  {
    value: "Technology provider",
    label: "Technology provider",
    description:
      "Builds software, platforms or digital tools for the industry.",
  },
  {
    value: "Engineering & consulting",
    label: "Engineering & consulting",
    description: "Provides design, engineering or technical advice.",
  },
  {
    value: "Operations & maintenance",
    label: "Operations & maintenance",
    description: "Monitors, maintains, repairs or operates systems.",
  },
  {
    value: "Equipment supplier",
    label: "Equipment supplier",
    description: "Sells, sources or rents equipment and materials.",
  },
  {
    value: "Finance",
    label: "Finance",
    description:
      "Provides project financing, lending, investment or insurance.",
  },
  {
    value: "Logistics",
    label: "Logistics",
    description: "Provides freight, warehousing or delivery.",
  },
  {
    value: "Association & training",
    label: "Association & training",
    description:
      "Supports the industry through membership, education or training.",
  },
  {
    value: "Other",
    label: "Other",
    description:
      "Another business in the solar industry. Describe your work in your profile.",
  },
] as const;

export type CompanyType = (typeof companyTypes)[number]["value"];
export const companyTypeValues = companyTypes.map(({ value }) => value) as [
  CompanyType,
  ...CompanyType[],
];
