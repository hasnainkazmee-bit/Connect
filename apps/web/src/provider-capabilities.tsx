import { ArrowUpRight, ChevronDown } from "lucide-react";
import "./provider-capabilities.css";

type Offering = {
  id: string;
  title: string;
  detail: string;
  sourceIds: string[];
};
export type ProviderCapabilities = {
  checkedAt: string;
  services: (Offering & {
    sectors: string[];
    delivery: string;
    systems: string[];
  })[];
  products: (Offering & {
    role: "manufactures" | "distributes" | "supplies-and-installs";
    brands: string[];
  })[];
  coverage: {
    label: string;
    serviceIds: string[];
    productIds: string[];
    sourceIds: string[];
  }[];
  sources: { id: string; title: string; url: string }[];
};
const roles = {
  manufactures: "Manufactures",
  distributes: "Distributes",
  "supplies-and-installs": "Supplies & installs",
};
const sectors: Record<string, string> = {
  residential: "Homes",
  commercial: "Businesses",
  industrial: "Industrial",
  agricultural: "Farms",
  municipal: "Public facilities",
  nonprofit: "Nonprofits",
  utility: "Utility-scale",
};

function EvidenceLink({
  item,
  data,
}: {
  item: Offering;
  data: ProviderCapabilities;
}) {
  const source = data.sources.find((s) => item.sourceIds.includes(s.id));
  return source ? (
    <a
      className="provider-offering-source"
      href={source.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Source for ${item.title}`}
      title={`View ${source.title} on the company website`}
    >
      <ArrowUpRight size={16} />
    </a>
  ) : null;
}

export function ProviderServices({ data }: { data: ProviderCapabilities }) {
  return (
    <div className="provider-offerings" aria-label="Services">
      {data.services.map((service) => (
        <article key={service.id} className="provider-offering">
          <div className="provider-offering-heading">
            <h3>{service.title}</h3>
            <EvidenceLink item={service} data={data} />
          </div>
          <p>{service.detail}</p>
          {service.sectors.length > 0 && (
            <small>
              {service.sectors.map((s) => sectors[s] || s).join(" · ")}
            </small>
          )}
        </article>
      ))}
    </div>
  );
}

export function ProviderProducts({ data }: { data: ProviderCapabilities }) {
  if (!data.products.length) return null;
  return (
    <section
      className="profile-editorial-section"
      id="products"
      data-profile-section
    >
      <h2>Products & equipment</h2>
      <div className="provider-offerings">
        {data.products.map((product) => (
          <article className="provider-offering" key={product.id}>
            <span className="provider-supply-role">{roles[product.role]}</span>
            <div className="provider-offering-heading">
              <h3>{product.title}</h3>
              <EvidenceLink item={product} data={data} />
            </div>
            <p>{product.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ProviderCoverage({ data }: { data: ProviderCapabilities }) {
  // Keep geography attached to the work/product it actually covers.
  const groups = new Map<string, { areas: string[]; offerings: string[] }>();
  for (const area of data.coverage) {
    const ids = [...area.serviceIds, ...area.productIds];
    const key = [...ids].sort().join("|");
    const group = groups.get(key) || {
      areas: [],
      offerings: [...data.services, ...data.products]
        .filter((s) => ids.includes(s.id))
        .map((s) => s.title),
    };
    group.areas.push(area.label);
    groups.set(key, group);
  }
  return (
    <div className="provider-coverage-groups">
      {[...groups.entries()].map(([key, group]) => (
        <details key={key}>
          <summary>
            <span>{[...new Set(group.areas)].join(" · ")}</span>
            <ChevronDown size={15} />
          </summary>
          <p>{group.offerings.join(" · ")}</p>
        </details>
      ))}
    </div>
  );
}

export function ProviderSources({ data }: { data: ProviderCapabilities }) {
  return (
    <details className="provider-research-sources">
      <summary>
        <span>
          Company website sources{" "}
          <small>
            Checked{" "}
            {new Date(data.checkedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            })}
          </small>
        </span>
        <ChevronDown size={16} />
      </summary>
      <ul>
        {data.sources.map((source) => (
          <li key={source.id}>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.title}
              <ArrowUpRight size={14} />
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
