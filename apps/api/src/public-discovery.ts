import { pool } from "./db.js";
import {
  escapeHTML as e,
  headquarters,
  httpUrl,
  serviceGuidance,
  serviceNames,
  slugify,
  usStates,
} from "./shared/public-seo.js";

export type PublicCompany = {
  id: string;
  username: string;
  slug: string;
  name: string;
  type: string;
  tagline: string;
  description: string;
  location: string;
  logo_url: string;
  website: string;
  services: string[];
  service_areas: string[];
  on_colabb: boolean;
  is_demo: boolean;
  project_types: string[];
};
type Coverage = {
  kind: string;
  label: string;
  country: string;
  state: string;
  city: string;
  states: string[];
};
export type Offering = {
  company_id: string;
  id: string;
  category_id: string;
  title: string;
  detail: string;
  sectors: string[];
  coverage: Coverage[];
};
type Snapshot = {
  companies: PublicCompany[];
  offerings: Offering[];
  taxonomy: { id: string; label: string }[];
};
let cached: { until: number; value: Snapshot } | undefined;
let loading: Promise<Snapshot> | undefined;
export async function discoverySnapshot(): Promise<Snapshot> {
  if (cached && cached.until > Date.now()) return cached.value;
  if (loading) return loading;
  loading = (async () => {
    const [companies, offerings, taxonomy] = await Promise.all([
      pool.query(`SELECT c.id,c.username,c.slug,c.name,c.type,c.tagline,c.description,c.location,c.logo_url,c.website,c.services,c.service_areas,c.is_demo,
       (c.listing_status='managed' AND EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=c.id)) AS on_colabb,
       COALESCE(p.project_types,'{}') AS project_types
       FROM companies c LEFT JOIN provider_profiles p ON p.company_id=c.id
       LEFT JOIN provider_directory_pins pin ON pin.company_id=c.id
       LEFT JOIN provider_directory_completeness quality ON quality.company_id=c.id
       WHERE NOT c.is_demo AND COALESCE(c.username,c.slug) IS NOT NULL
       ORDER BY pin.position ASC NULLS LAST, (c.listing_status='managed' AND EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=c.id)) DESC,quality.score DESC NULLS LAST,c.name,c.id`),
      pool.query(`SELECT o.company_id,o.id,o.category_id,o.title,o.detail,o.sectors,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',a.kind,'label',a.label,'country',a.country_code,'state',a.state_code,'city',a.city_key,'states',a.included_state_codes))
       FROM provider_coverage_offerings co JOIN provider_coverage_areas a ON a.company_id=co.company_id AND a.id=co.area_id
       WHERE co.company_id=o.company_id AND co.offering_id=o.id),'[]'::jsonb) AS coverage
       FROM provider_current_candidates o WHERE o.kind='service' ORDER BY o.company_id,o.id`),
      pool.query(
        "SELECT id,label FROM provider_taxonomy WHERE kind='service' ORDER BY label",
      ),
    ]);
    const value = {
      companies: companies.rows,
      offerings: offerings.rows,
      taxonomy: taxonomy.rows,
    };
    cached = {
      value,
      until: Date.now() + (process.env.NODE_ENV === "production" ? 60000 : 0),
    };
    return value;
  })();
  try {
    return await loading;
  } finally {
    loading = undefined;
  }
}
export const companyPath = (c: Pick<PublicCompany, "username" | "slug">) =>
  "/" + encodeURIComponent(c.username || c.slug);
export const companyIndexable = (c: PublicCompany) =>
  !c.is_demo &&
  c.description.trim().length >= 80 &&
  (!!c.location || !!c.services.length);
export const pageSize = 24;
export function pagePath(path: string, page: number): string {
  return path + (page > 1 ? "/page/" + page : "");
}
export type DiscoveryLink = { path: string; name: string; count: number };
export type DiscoveryResult = {
  title: string;
  description: string;
  html: string;
  path: string;
  indexable: boolean;
  status: number;
  items: PublicCompany[];
  total: number;
  page: number;
  breadcrumbs: { name: string; path: string }[];
};
function selection(
  s: Snapshot,
  service: string,
  state?: string,
  city?: string,
) {
  const offers = new Map<string, Offering[]>();
  for (const offer of s.offerings)
    if (offer.category_id === service)
      offers.set(offer.company_id, [
        ...(offers.get(offer.company_id) || []),
        offer,
      ]);
  return s.companies.flatMap((c) => {
    const items = offers.get(c.id);
    if (!items?.length || !companyIndexable(c)) return [];
    const base = headquarters(c.location);
    const based =
      !!state && base?.state === state && (!city || base.cityKey === city);
    const covers = items
      .flatMap((o) => o.coverage)
      .filter(
        (a) =>
          a.country === "US" &&
          (city
            ? a.kind === "city" &&
              a.state === state &&
              slugify(a.city || "") === city
            : a.state === state || a.states.includes(state || "")),
      );
    if (state && !based && !covers.length) return [];
    return [
      {
        company: c,
        offers: items,
        reason: based
          ? "Based in " + c.location
          : state
            ? "Recorded service area: " +
              [...new Set(covers.map((a) => a.label))].slice(0, 3).join(" · ")
            : "Based in " + c.location,
      },
    ];
  });
}
function availablePlaces(
  s: Snapshot,
  service: string,
  state?: string,
): DiscoveryLink[] {
  const places = new Map<
    string,
    { state: string; city?: string; name: string }
  >();
  const companies = new Map(s.companies.map((c) => [c.id, c]));
  for (const o of s.offerings.filter((o) => o.category_id === service)) {
    const c = companies.get(o.company_id);
    if (!c || !companyIndexable(c)) continue;
    const h = headquarters(c.location);
    if (h && (!state || h.state === state))
      places.set(state ? h.cityKey : h.state, {
        state: h.state,
        city: state ? h.cityKey : undefined,
        name: state ? h.city : usStates[h.state],
      });
    for (const a of o.coverage) {
      if (a.country !== "US") continue;
      for (const code of [a.state, ...a.states].filter(
        (v) => v && usStates[v],
      )) {
        if (!state) places.set(code, { state: code, name: usStates[code] });
        else if (code === state && a.kind === "city" && a.city)
          places.set(slugify(a.city), {
            state,
            city: slugify(a.city),
            name: a.label.split(",")[0],
          });
      }
    }
  }
  return [...places.values()]
    .map((p) => ({
      path:
        "/services/" +
        service +
        "/" +
        slugify(usStates[p.state]) +
        (p.city ? "/" + p.city : ""),
      name: p.name,
      count: selection(s, service, p.state, p.city).length,
    }))
    .filter((p) => p.count >= 3)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
export function discoveryLinks(s: Snapshot): DiscoveryLink[] {
  return s.taxonomy.flatMap((t) => {
    const total = selection(s, t.id).length;
    if (total < 3) return [];
    const path = "/services/" + t.id;
    return [
      {
        path,
        name: serviceNames[t.id] || t.label + " companies",
        count: total,
      },
      ...availablePlaces(s, t.id).flatMap((state) => [
        state,
        ...availablePlaces(
          s,
          t.id,
          Object.keys(usStates).find(
            (k) => slugify(usStates[k]) === state.path.split("/")[3],
          ),
        ),
      ]),
    ];
  });
}
const linksHTML = (links: DiscoveryLink[]) =>
  `<ul class="seo-links">${links.map((l) => `<li><a href="${e(l.path)}"><span>${e(l.name)}</span><small>${l.count} ${l.count === 1 ? "company" : "companies"}</small><span aria-hidden="true">↗</span></a></li>`).join("")}</ul>`;
export const breadcrumbsHTML = (items: { name: string; path: string }[]) =>
  `<nav class="seo-breadcrumbs" aria-label="Breadcrumb">${items.map((b, i) => (i === items.length - 1 ? `<span aria-current="page">${e(b.name)}</span>` : `<a href="${e(b.path)}">${e(b.name)}</a><span aria-hidden="true">/</span>`)).join("")}</nav>`;
export function publicCompanyCard(
  c: PublicCompany,
  origin: string,
  detail?: { offers: Offering[]; reason: string },
): string {
  const href = companyPath(c),
    logo = httpUrl(c.logo_url, origin);
  return `<article class="seo-company"><header><a class="seo-logo" href="${href}" aria-label="${e(c.name)} profile">${logo ? `<img src="${e(logo)}" alt="" width="72" height="56" loading="lazy"/>` : ""}</a><div><h2><a href="${href}">${e(c.name)}</a></h2><p>${e(c.location)}</p></div><span class="seo-presence">${c.on_colabb ? "On Colabb" : "Public listing"}</span></header><p class="seo-company-intro">${e(c.tagline || c.description.slice(0, 240))}</p>${
    detail
      ? `<div class="seo-offer"><h3>${e(detail.offers[0].title)}</h3><p>${e(detail.offers[0].detail)}</p></div><p class="seo-location">${e(detail.reason)}</p>`
      : `<ul class="seo-chips">${c.services
          .slice(0, 4)
          .map((v) => `<li>${e(v)}</li>`)
          .join("")}</ul>`
  }${c.project_types.length ? `<p class="seo-facts">Project types: ${e(c.project_types.join(" · "))}</p>` : ""}<footer><a href="${href}">View company <span aria-hidden="true">→</span></a><span>${c.on_colabb ? "Contact this company on Colabb" : "Explore services and experience"}</span></footer></article>`;
}
export function paginationHTML(
  path: string,
  page: number,
  total: number,
): string {
  const pages = Math.ceil(total / pageSize);
  if (pages < 2) return "";
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b);
  return `<nav class="seo-pagination" aria-label="Results pages">${page > 1 ? `<a rel="prev" href="${e(pagePath(path, page - 1))}">← Previous</a>` : ""}${numbers.map((n) => `<a href="${e(pagePath(path, n))}" ${n === page ? 'aria-current="page"' : ""}>${n}</a>`).join("")}${page < pages ? `<a rel="next" href="${e(pagePath(path, page + 1))}">Next →</a>` : ""}</nav>`;
}
export function servicePage(
  s: Snapshot,
  path: string,
  origin: string,
): DiscoveryResult {
  const suffix = path.match(/\/page\/([1-9]\d{0,4})$/);
  const basePath = suffix ? path.slice(0, -suffix[0].length) : path;
  const segments = basePath.split("/").filter(Boolean),
    service = segments[1],
    stateSlug = segments[2],
    city = segments[3],
    page = suffix ? Number(suffix[1]) : 1;
  path = basePath;
  const breadcrumbs = [
    { name: "Companies", path: "/providers" },
    { name: "Services", path: "/services" },
  ];
  const notFound = (): DiscoveryResult => ({
    title: "Page not found",
    description: "Browse solar services and companies by location.",
    html: `<section class="seo-page"><h1>That service page is not available.</h1><p>Explore the services and locations with companies to compare.</p><a href="/services">Browse services →</a></section>`,
    path,
    indexable: false,
    status: 404,
    items: [],
    total: 0,
    page: 1,
    breadcrumbs,
  });
  if (!page || segments.length > 4) return notFound();
  if (!service) {
    if (page !== 1) return notFound();
    const links = s.taxonomy
      .map((t) => ({
        path: "/services/" + t.id,
        name: serviceNames[t.id] || t.label + " companies",
        count: selection(s, t.id).length,
      }))
      .filter((l) => l.count >= 3)
      .sort((a, b) => b.count - a.count);
    const title = "Find solar companies by service and location";
    const description =
      "Compare solar installers, electricians, roofing companies and other specialists. Explore their services, project experience and recorded locations on Colabb.";
    return {
      title,
      description,
      path,
      indexable: true,
      status: 200,
      items: [],
      total: links.length,
      page,
      breadcrumbs,
      html: `<div class="seo-page">${breadcrumbsHTML(breadcrumbs)}<header class="seo-intro"><p class="seo-eyebrow">FIND THE RIGHT COMPANY</p><h1>${title}</h1><p>${description}</p></header>${linksHTML(links)}<section class="seo-guide"><h2>Start with the work you need.</h2><p>Choose a service, then a state or city. Each result links to a company profile with the recorded work it offers. Post a job when you are ready to compare proposals.</p><a class="seo-cta" href="/jobs/new">Post a job →</a></section></div>`,
    };
  }
  const t = s.taxonomy.find((t) => t.id === service);
  if (!t) return notFound();
  const state = stateSlug
    ? Object.keys(usStates).find((k) => slugify(usStates[k]) === stateSlug)
    : undefined;
  if (stateSlug && !state) return notFound();
  const selected = selection(s, service, state, city);
  if (!selected.length || (page - 1) * pageSize >= selected.length)
    return notFound();
  const cityName = city
    ? selected
        .map((v) => headquarters(v.company.location))
        .find((h) => h?.state === state && h?.cityKey === city)?.city ||
      selected
        .flatMap((v) => v.offers.flatMap((o) => o.coverage))
        .find((a) => slugify(a.city || "") === city)
        ?.label.split(",")[0]
    : undefined;
  const location = cityName
    ? cityName + ", " + state
    : state
      ? usStates[state]
      : undefined;
  const title =
    (serviceNames[service] || t.label + " companies") +
    (location ? " in " + location : "");
  const description = `Compare ${selected.length} ${t.label.toLowerCase()} ${selected.length === 1 ? "company" : "companies"}${location ? " based in or with recorded service areas in " + location : ""}. Explore services, project types and company profiles on Colabb.`;
  breadcrumbs.push({ name: t.label, path: "/services/" + service });
  if (state)
    breadcrumbs.push({
      name: usStates[state],
      path: "/services/" + service + "/" + stateSlug,
    });
  if (cityName) breadcrumbs.push({ name: cityName, path });
  const shown = selected.slice((page - 1) * pageSize, page * pageSize);
  const nearby = city
    ? availablePlaces(s, service, state).filter((l) => l.path !== path)
    : availablePlaces(s, service, state);
  const [guideTitle, guideBody] = serviceGuidance[service] || [
    "Give companies a clear starting point",
    "Describe the work, site, timing and required deliverables. Share relevant documents and ask about similar projects, qualifications, exclusions and availability before agreeing a proposal.",
  ];
  const related = s.taxonomy
    .filter((x) => x.id !== service)
    .map((x) => ({
      path:
        "/services/" +
        x.id +
        (state ? "/" + stateSlug : "") +
        (city ? "/" + city : ""),
      name: x.label,
      count: selection(s, x.id, state, city).length,
    }))
    .filter((x) => x.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const html = `<div class="seo-page">${breadcrumbsHTML(breadcrumbs)}<header class="seo-intro"><p class="seo-eyebrow">COMPANIES / ${e(t.label)}</p><h1>${e(title)}</h1><p>${e(description)}</p><a class="seo-cta" href="/jobs/new">Post a job →</a></header><div class="seo-results-heading"><h2>${selected.length} ${selected.length === 1 ? "company" : "companies"} to explore</h2><span>Page ${page} of ${Math.ceil(selected.length / pageSize)}</span></div><div class="seo-company-grid">${shown.map((v) => publicCompanyCard(v.company, origin, v)).join("")}</div>${paginationHTML(path, page, selected.length)}<section class="seo-guide"><div><h2>${e(guideTitle)}</h2><p>${e(guideBody)}</p></div><div><h2>How are these companies selected?</h2><p>Results use recorded services from company profiles and current source research. ${state ? "A company is included when its listed base or a recorded service area matches this location. A city address does not establish a company’s full service area." : "Company names alone do not determine the services shown."}</p><p>The On Colabb mark identifies a managed account. Confirm qualifications, coverage and availability directly before choosing a company.</p></div></section>${nearby.length ? `<section class="seo-section"><h2>${state ? "Explore other cities in " + e(usStates[state]) : "Explore by state"}</h2>${linksHTML(nearby)}</section>` : ""}${related.length ? `<section class="seo-section"><h2>Other services${location ? " in " + e(location) : ""}</h2>${linksHTML(related)}</section>` : ""}</div>`;
  return {
    title,
    description,
    html,
    path: pagePath(path, page),
    indexable: selected.length >= 3,
    status: 200,
    items: shown.map((v) => v.company),
    total: selected.length,
    page,
    breadcrumbs,
  };
}
