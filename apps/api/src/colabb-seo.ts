import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pool } from "./db.js";
import { selectedWebUI, webDist } from "./web-ui.js";
import { helpTopics } from "./shared/help-content.js";
import {
  escapeHTML as e,
  httpUrl,
  type PublicMetadata,
  type PublicPagePayload,
} from "./shared/public-seo.js";
import {
  discoverySnapshot,
  discoveryLinks,
  servicePage,
  companyPath,
  companyIndexable,
  publicCompanyCard,
  paginationHTML,
  breadcrumbsHTML,
  pagePath,
  pageSize,
  type PublicCompany,
} from "./public-discovery.js";

const marketing: Record<
  string,
  { file: string; title: string; description: string }
> = {
  "/": {
    file: "home",
    title: "Colabb | Solar companies, jobs and communities",
    description:
      "Find solar crews, specialists and suppliers. Post jobs, compare proposals, follow company posts and join communities on Colabb.",
  },
  "/hire": {
    file: "hire",
    title: "Hire a solar company | Colabb",
    description:
      "Post a solar job, compare company matches and proposals, then track tasks and approve the work on Colabb.",
  },
  "/find-work": {
    file: "work",
    title: "Find work for your solar company | Colabb",
    description:
      "Show your services and past projects, find solar jobs, send proposals and connect with potential clients on Colabb.",
  },
  "/how-it-works": {
    file: "how",
    title: "How Colabb works | Jobs, companies and Network",
    description:
      "See how jobs, proposals, task approvals, company messages, social posts and communities work on Colabb.",
  },
  "/our-story": {
    file: "story",
    title: "Our story | Colabb, a Sunhub company",
    description:
      "From YellowLite’s installation experience to Sunhub’s solar supply chain ecosystem and Colabb’s company network.",
  },
  "/network": {
    file: "network",
    title: "Company posts and communities | Colabb",
    description:
      "Follow solar companies, share posts and join company-hosted communities. Discuss equipment, fieldwork, compliance and more on Colabb.",
  },
};
const privateRoots = new Set([
  "account",
  "claim",
  "settings",
  "messages",
  "requests",
  "invite",
  "join",
  "inbox",
  "actions",
  "onboarding",
  "auth",
]);
const json = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
const plain = (v: string, n = 180) => v.replace(/\s+/g, " ").trim().slice(0, n);
const graph = (nodes: unknown[]) => ({
  "@context": "https://schema.org",
  "@graph": nodes,
});
const crumbs = (items: { name: string; path: string }[], origin: string) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map((b, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: b.name,
    item: origin + b.path,
  })),
});
const itemList = (items: { name: string; url: string }[], offset = 0) => ({
  "@type": "ItemList",
  numberOfItems: items.length,
  itemListElement: items.map((c, i) => ({
    "@type": "ListItem",
    position: offset + i + 1,
    name: c.name,
    url: c.url,
  })),
});
const publicRobots = "index,follow,max-image-preview:large";
type Resolved = {
  metadata: PublicMetadata;
  status: number;
  content: string;
  redirect?: string;
  discoveryHtml?: string;
};
function base(pathname: string, origin: string): Resolved {
  return {
    status: 200,
    content: "",
    metadata: {
      title: "Colabb | The working network for solar",
      description:
        "Find companies, collaborate on solar work and join industry communities on Colabb.",
      canonical: origin + pathname,
      robots: "noindex,follow",
      image: origin + "/brand/colabb-social-preview.png",
      imageAlt: "Colabb. No one builds solar alone.",
      schema: null,
    },
  };
}
function schemaPage(
  r: Resolved,
  type = "WebPage",
  extra: Record<string, unknown> = {},
) {
  return {
    "@type": type,
    "@id": r.metadata.canonical + "#page",
    url: r.metadata.canonical,
    name: r.metadata.title,
    description: r.metadata.description,
    isPartOf: { "@id": new URL("/#website", r.metadata.canonical).href },
    ...extra,
  };
}
export async function resolvePublicPage(
  input: string,
  origin: string,
): Promise<Resolved> {
  const url = new URL(input, origin),
    pathname = url.pathname,
    r = base(pathname, origin),
    parts = pathname.split("/").filter(Boolean);
  const missing = () => {
    r.status = 404;
    r.metadata.title = "Page not found | Colabb";
    r.content =
      '<section class="seo-page"><h1>We could not find that page.</h1><a href="/services">Explore companies by service →</a></section>';
    return r;
  };
  // Only known paths are resolved; query values never select private records.
  if (pathname.length > 400) return missing();
  if (pathname.length > 1 && pathname.endsWith("/"))
    return {
      ...r,
      redirect: pathname.replace(/\/+$/, "") + url.search,
      status: 301,
    };
  if (parts[0] === "directory")
    return { ...r, redirect: "/providers", status: 301 };
  if (marketing[pathname]) {
    const m = marketing[pathname];
    r.metadata.title = m.title;
    r.metadata.description = m.description;
    r.metadata.robots = publicRobots;
    r.content = await template("marketing-" + m.file + ".html");
    r.metadata.schema = graph([
      {
        "@type": "Organization",
        "@id": origin + "/#organization",
        name: "Colabb",
        url: origin + "/",
        logo: {
          "@type": "ImageObject",
          url: origin + "/brand/colabb-logo.png",
        },
        parentOrganization: {
          "@type": "Organization",
          name: "Sunhub",
          url: "https://www.sunhub.com/",
        },
      },
      {
        "@type": "WebSite",
        "@id": origin + "/#website",
        url: origin + "/",
        name: "Colabb",
        publisher: { "@id": origin + "/#organization" },
        inLanguage: "en",
      },
      schemaPage(r, pathname === "/our-story" ? "AboutPage" : "WebPage"),
    ]);
    return r;
  }
  if (parts[0] === "services") {
    if (pathname.endsWith("/page/1"))
      return { ...r, redirect: pathname.slice(0, -7), status: 301 };
    const s = await discoverySnapshot(),
      d = servicePage(s, pathname, origin);
    r.status = d.status;
    r.content = d.html;
    r.discoveryHtml = d.html;
    r.metadata.title =
      d.title + (d.page > 1 ? " — Page " + d.page : "") + " | Colabb";
    r.metadata.description = plain(d.description);
    r.metadata.canonical = origin + d.path;
    // Campaign parameters don't create pages; filters must not be indexed.
    const filtered = [...url.searchParams.keys()].some(
      (k) => !/^utm_|^(gclid|fbclid)$/.test(k),
    );
    r.metadata.robots =
      d.indexable && !filtered ? publicRobots : "noindex,follow";
    if (d.status === 200)
      r.metadata.schema = graph([
        schemaPage(r, "CollectionPage", {
          mainEntity: itemList(
            d.items.map((c) => ({
              name: c.name,
              url: origin + companyPath(c),
            })),
            (d.page - 1) * pageSize,
          ),
        }),
        crumbs(d.breadcrumbs, origin),
      ]);
    return r;
  }
  if (parts[0] === "help") {
    const key = parts[1] || "help",
      h = helpTopics[key];
    if (!h || parts.length > 2) return missing();
    if (pathname === "/help/help")
      return { ...r, redirect: "/help", status: 301 };
    r.metadata.title = h.title.replace(/\.$/, "") + " | Colabb";
    r.metadata.description = h.intro;
    r.metadata.robots = publicRobots;
    r.content = `<article class="colabb-help"><a href="/">Back to Colabb</a><p class="colabb-eyebrow">THE USEFUL DETAILS</p><h1>${e(h.title)}</h1><p class="colabb-help-intro">${e(h.intro)}</p><div class="colabb-help-layout"><nav aria-label="Help topics">${Object.keys(
      helpTopics,
    )
      .map(
        (k) =>
          `<a href="${k === "help" ? "/help" : "/help/" + k}">${e(k === "help" ? "Getting started" : k[0].toUpperCase() + k.slice(1))}</a>`,
      )
      .join(
        "",
      )}</nav><div>${h.sections.map(([title, body]) => `<section><h2>${e(title)}</h2><p>${e(body)}</p></section>`).join("")}</div></div></article>`;
    r.metadata.schema = graph([
      schemaPage(r),
      crumbs(
        [
          { name: "Colabb", path: "/" },
          { name: "Help", path: "/help" },
          ...(parts.length > 1 ? [{ name: h.title, path: pathname }] : []),
        ],
        origin,
      ),
    ]);
    return r;
  }
  if (parts[0] === "providers") {
    if (
      url.searchParams.size === 1 &&
      /^[1-9]\d{0,4}$/.test(url.searchParams.get("page") || "")
    )
      return {
        ...r,
        redirect: pagePath("/providers", Number(url.searchParams.get("page"))),
        status: 301,
      };
    if (
      parts.length !== 1 &&
      !(
        parts.length === 3 &&
        parts[1] === "page" &&
        /^[1-9]\d{0,4}$/.test(parts[2])
      )
    )
      return missing();
    const page = parts.length === 3 ? Number(parts[2]) : 1;
    if (parts.length === 3 && page === 1)
      return { ...r, redirect: "/providers", status: 301 };
    const s = await discoverySnapshot(),
      companies = s.companies,
      items = companies.slice((page - 1) * pageSize, page * pageSize);
    if (page > 1 && !items.length) return missing();
    r.metadata.title =
      "Solar companies and service providers" +
      (page > 1 ? " — Page " + page : "") +
      " | Colabb";
    r.metadata.description =
      "Explore solar installers, electrical contractors, roofing companies and suppliers. Compare services, experience and locations to find a company for your job.";
    r.metadata.robots = [...url.searchParams.keys()].some(
      (k) => !/^utm_|^(gclid|fbclid)$/.test(k),
    )
      ? "noindex,follow"
      : publicRobots;
    const b = [
      { name: "Colabb", path: "/" },
      { name: "Companies", path: "/providers" },
    ];
    r.content = `<div class="seo-page">${breadcrumbsHTML(b)}<header class="seo-intro"><p class="seo-eyebrow">COMPANIES</p><h1>Find a company for the work.</h1><p>${e(r.metadata.description)}</p><a class="seo-cta" href="/services">Browse by service and location →</a></header><div class="seo-company-grid">${items.map((c) => publicCompanyCard(c, origin)).join("")}</div>${paginationHTML("/providers", page, companies.length)}</div>`;
    if (page > 1) r.discoveryHtml = r.content;
    r.metadata.schema =
      r.metadata.robots === publicRobots
        ? graph([
            schemaPage(r, "CollectionPage", {
              mainEntity: itemList(
                items.map((c) => ({
                  name: c.name,
                  url: origin + companyPath(c),
                })),
                (page - 1) * pageSize,
              ),
            }),
            crumbs(b, origin),
          ])
        : null;
    return r;
  }
  if (
    privateRoots.has(parts[0]) ||
    parts[0] === "network" ||
    parts[0] === "posts"
  ) {
    r.metadata.title = "Your account | Colabb";
    r.content =
      '<section class="seo-page"><h1>Continue in Colabb</h1><p>Sign in to access your company and work.</p><a href="/account">Sign in</a></section>';
    return r;
  }
  if (parts[0] === "jobs" && parts[1] !== "companies") {
    if (parts.length > 1) {
      r.metadata.title = "Job workspace | Colabb";
      r.content =
        '<section class="seo-page"><h1>Job workspace</h1><p>Open Colabb to view this job and the actions available to you.</p><a href="/jobs">Find work</a></section>';
      return r;
    }
    // Business-to-business requests are not employment JobPosting rich results.
    const jobs = (
      await pool.query(
        `SELECT j.id,j.title,j.description,j.location,c.name,c.username,c.slug FROM jobs j JOIN companies c ON c.id=j.hiring_company_id WHERE j.visibility='open' AND j.status='open' AND NOT c.is_demo AND j.title !~* '^(DEMO|TEST)\\M' ORDER BY j.created_at DESC,j.id LIMIT 24`,
      )
    ).rows;
    r.metadata.title = "Find solar jobs and contract work | Colabb";
    r.metadata.description =
      "Find solar installation, electrical, roofing and other business opportunities. Read the scope, compare requirements and send a proposal on Colabb.";
    r.metadata.robots = url.search ? "noindex,follow" : publicRobots;
    r.content = `<div class="seo-page"><header class="seo-intro"><h1>Find work for your company.</h1><p>${r.metadata.description}</p></header>${jobs.length ? `<div class="seo-company-grid">${jobs.map((j) => `<article class="seo-company"><h2><a href="/jobs/${j.id}">${e(j.title)}</a></h2><p>${e(j.location)} · ${e(j.name)}</p><p>${e(plain(j.description, 360))}</p><a href="/jobs/${j.id}">View job →</a></article>`).join("")}</div>` : "<p>No public jobs are available right now. Set up your company profile to prepare for future work.</p>"}<a href="/find-work">How finding work on Colabb works →</a></div>`;
    r.metadata.schema = graph([
      schemaPage(r, "CollectionPage", {
        mainEntity: itemList(
          jobs.map((j) => ({ name: j.title, url: origin + "/jobs/" + j.id })),
        ),
      }),
    ]);
    return r;
  }
  if (
    parts.length === 1 ||
    (parts[0] === "company" && parts.length === 2) ||
    (parts[0] === "jobs" && parts[1] === "companies" && parts.length === 3)
  ) {
    let key: string;
    try {
      key = decodeURIComponent(parts.at(-1)!).toLowerCase();
    } catch {
      return missing();
    }
    const c = (
      await pool.query(
        `SELECT c.*,COALESCE(p.project_types,'{}') AS project_types FROM companies c LEFT JOIN provider_profiles p ON p.company_id=c.id WHERE c.username=$1 OR c.slug=$1 OR c.id::text=$1 OR c.id=(SELECT company_id FROM company_username_history WHERE username=$1) LIMIT 1`,
        [key],
      )
    ).rows[0] as PublicCompany | undefined;
    if (!c) return missing();
    const canonical = companyPath(c);
    if (pathname !== canonical)
      return { ...r, redirect: canonical, status: 301 };
    r.metadata.title =
      c.name + (c.location ? " — " + c.location : "") + " | Colabb";
    r.metadata.description = plain(
      c.description ||
        c.tagline ||
        `${c.name}: explore services and company information on Colabb.`,
    );
    r.metadata.robots = companyIndexable(c) ? publicRobots : "noindex,follow";
    const [projects, credentials, offers, reviews] = await Promise.all([
      pool.query(
        "SELECT name,description,location FROM projects WHERE company_id=$1 ORDER BY id LIMIT 12",
        [c.id],
      ),
      pool.query(
        "SELECT category,title,organization,scope_detail,source_url FROM company_credentials WHERE company_id=$1 ORDER BY category,title LIMIT 30",
        [c.id],
      ),
      pool.query(
        "SELECT o.title,o.detail,o.category_id,o.sectors FROM provider_current_candidates o WHERE o.company_id=$1 AND o.kind='service' ORDER BY o.title",
        [c.id],
      ),
      pool.query(
        "SELECT r.rating,r.body,u.name FROM company_reviews r JOIN users u ON u.id=r.user_id WHERE r.company_id=$1 AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=r.company_id AND m.user_id=r.user_id) ORDER BY r.created_at DESC LIMIT 10",
        [c.id],
      ),
    ]);
    const website = httpUrl(c.website, origin),
      logo = httpUrl(c.logo_url, origin),
      b = [
        { name: "Companies", path: "/providers" },
        { name: c.name, path: canonical },
      ];
    r.content = `<article class="seo-page seo-profile">${breadcrumbsHTML(b)}<header class="seo-profile-head">${logo ? `<img src="${e(logo)}" alt="" width="120" height="80"/>` : ""}<div><p class="seo-eyebrow">${e(c.type)}</p><h1>${e(c.name)}</h1><p>${e(c.tagline)}</p>${c.location ? `<p>Based in ${e(c.location)}</p>` : ""}</div></header><section class="seo-section"><h2>Overview</h2><p class="seo-preserve">${e(c.description)}</p></section><section class="seo-section" id="services"><h2>Services</h2>${offers.rows.length ? offers.rows.map((o) => `<article><h3>${e(o.title)}</h3><p>${e(o.detail)}</p>${o.sectors.length ? `<p>Project types: ${e(o.sectors.join(" · "))}</p>` : ""}<a href="/services/${e(o.category_id)}">Explore ${e(o.title.toLowerCase())} companies →</a></article>`).join("") : `<ul>${c.services.map((v) => `<li>${e(v)}</li>`).join("")}</ul>`}</section>${c.service_areas.length ? `<section class="seo-section"><h2>Service areas</h2><p>${e(c.service_areas.join(" · "))}</p></section>` : ""}${c.project_types.length ? `<section class="seo-section"><h2>Project types</h2><p>${e(c.project_types.join(" · "))}</p></section>` : ""}${credentials.rows.length ? `<section class="seo-section"><h2>Credentials and listings</h2>${credentials.rows.map((v) => `<article><h3>${e(v.title)}</h3><p>${e(v.category)} · ${e(v.organization)}</p>${v.scope_detail ? `<p>${e(v.scope_detail)}</p>` : ""}${httpUrl(v.source_url, origin) ? `<a href="${e(httpUrl(v.source_url, origin))}" rel="nofollow noopener">View source</a>` : ""}</article>`).join("")}</section>` : ""}${projects.rows.length ? `<section class="seo-section"><h2>Projects</h2>${projects.rows.map((v) => `<article><h3>${e(v.name)}</h3><p>${e(v.location)}</p><p>${e(v.description)}</p></article>`).join("")}</section>` : ""}${reviews.rows.length ? `<section class="seo-section"><h2>Customer reviews</h2>${reviews.rows.map((v) => `<article><h3>${e(v.name)} · ${v.rating}/5</h3><p>${e(v.body)}</p></article>`).join("")}</section>` : ""}${website ? `<section class="seo-section"><h2>Company website</h2><a href="${e(website)}" rel="noopener">${e(website)}</a></section>` : ""}</article>`;
    r.metadata.schema = graph([
      schemaPage(r, "ProfilePage", {
        mainEntity: { "@id": origin + canonical + "#company" },
      }),
      {
        "@type": "Organization",
        "@id": origin + canonical + "#company",
        name: c.name,
        url: origin + canonical,
        description: r.metadata.description,
        logo,
        sameAs: website ? [website] : undefined,
        areaServed: c.service_areas,
        hasOfferCatalog: offers.rows.length
          ? {
              "@type": "OfferCatalog",
              name: "Services",
              itemListElement: offers.rows.map((o) => ({
                "@type": "Offer",
                itemOffered: {
                  "@type": "Service",
                  name: o.title,
                  description: o.detail,
                  provider: { "@id": origin + canonical + "#company" },
                },
              })),
            }
          : undefined,
      },
      crumbs(b, origin),
    ]);
    return r;
  }
  return missing();
}
const files = new Map<string, string>();
async function template(name: string) {
  if (process.env.NODE_ENV === "production" && files.has(name))
    return files.get(name)!;
  const content = await fs.readFile(path.join(webDist("colabb"), name), "utf8");
  files.set(name, content);
  return content;
}
function metadataHTML(m: PublicMetadata, nonce: string) {
  const meta = (key: string, value: string, property = false) =>
    `<meta data-colabb-seo ${property ? "property" : "name"}="${key}" content="${e(value)}"/>`;
  return (
    `<title>${e(m.title)}</title><link data-colabb-seo rel="canonical" href="${e(m.canonical)}"/>` +
    meta("description", m.description) +
    meta("robots", m.robots) +
    meta("og:title", m.title, true) +
    meta("og:description", m.description, true) +
    meta("og:url", m.canonical, true) +
    meta("og:type", "website", true) +
    meta("og:site_name", "Colabb", true) +
    meta("og:locale", "en_US", true) +
    meta("og:image", m.image, true) +
    meta("og:image:width", "1200", true) +
    meta("og:image:height", "630", true) +
    meta("og:image:alt", m.imageAlt, true) +
    meta("twitter:card", "summary_large_image") +
    meta("twitter:title", m.title) +
    meta("twitter:description", m.description) +
    meta("twitter:image", m.image) +
    meta("twitter:image:alt", m.imageAlt) +
    (m.schema
      ? `<script data-colabb-seo type="application/ld+json" nonce="${nonce}">${json(m.schema)}</script>`
      : "")
  );
}
const shell = (content: string) =>
  `<header class="mk-header"><div class="mk-header-inner"><a class="mk-brand" href="/" aria-label="Colabb home"><img src="/brand/marks/lockup-nav.svg" alt="Colabb" width="349" height="52"/></a><nav class="mk-nav" aria-label="Main navigation"><a href="/hire">Hire a company</a><a href="/find-work">Find work</a><a href="/providers">Companies</a><a href="/network">Network</a></nav><div class="mk-header-actions"><a class="mk-link" href="/account">Sign in</a><a class="mk-btn mk-primary" href="/jobs/new">Post a job</a></div></div></header><main class="app-main">${content}</main><footer class="seo-footer"><a href="/services">Browse services and locations</a><a href="/help">Help</a><a href="/help/privacy">Privacy</a><a href="/our-story">A Sunhub company</a></footer>`;
export function publicSEOApi() {
  const router = Router();
  router.get("/public-page", async (req, res) => {
    const input = typeof req.query.path === "string" ? req.query.path : "/";
    if (
      !input.startsWith("/") ||
      input.startsWith("//") ||
      input.includes("\\") ||
      input.length > 1200
    )
      return res.status(400).json({ error: "Invalid public page path." });
    const origin = (process.env.APP_ORIGIN || "http://localhost:5173").replace(
      /\/$/,
      "",
    );
    const r = await resolvePublicPage(input, origin);
    const payload: PublicPagePayload = {
      metadata: r.metadata,
      status: r.status,
      redirect: r.redirect,
      discoveryHtml: r.discoveryHtml,
    };
    res
      .set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" })
      .json(payload);
  });
  return router;
}
export function colabbSEO() {
  const router = Router(),
    origin = (process.env.APP_ORIGIN || "http://localhost:5173").replace(
      /\/$/,
      "",
    );
  router.use((req, res, next) =>
    selectedWebUI(req) === "colabb" ? next() : next("router"),
  );
  router.get("/robots.txt", (_req, res) => {
    // Rendering needs these public reads. Authorization, not robots.txt, protects
    // company workspaces. JSON responses carry X-Robots-Tag: noindex.
    res.vary("Cookie");
    res.vary("User-Agent");
    res
      .type("text/plain")
      .send(
        [
          "User-agent: *",
          "Allow: /",
          "Disallow: /api/",
          "Allow: /api/company-assets/",
          "Allow: /api/public-page?",
          "Allow: /api/session$",
          "Allow: /api/companies/",
          "Allow: /api/jobs/providers",
          "Allow: /api/jobs/provider-taxonomy",
          "Allow: /api/jobs/companies/",
          "Allow: /api/jobs$",
          "Allow: /api/jobs?",
          "Disallow: /account",
          "Disallow: /claim",
          "Disallow: /settings",
          "Disallow: /messages",
          "Disallow: /inbox",
          "Disallow: /actions",
          "Allow: /network$",
          "Disallow: /network/",
          "Disallow: /invite",
          "Disallow: /join",
          "Disallow: /_interface/",
          "Sitemap: " + origin + "/sitemap.xml",
          "",
        ].join("\n"),
      );
  });
  router.get("/sitemap.xml", async (_req, res) => {
    const s = await discoverySnapshot();
    const urls = [
      ...Object.keys(marketing),
      "/providers",
      "/jobs",
      "/services",
      "/help",
      ...Object.keys(helpTopics)
        .filter((k) => k !== "help")
        .map((k) => "/help/" + k),
      ...s.companies.filter(companyIndexable).map(companyPath),
      ...discoveryLinks(s).map((l) => l.path),
    ];
    res.vary("Cookie");
    res.vary("User-Agent");
    res
      .set("Cache-Control", "public, max-age=60")
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...new Set(urls)].map((url) => `<url><loc>${e(origin + url)}</loc></url>`).join("")}</urlset>`,
      );
  });
  router.get("/{*path}", async (req, res, next) => {
    if (
      req.path === "/robots.txt" ||
      req.path.startsWith("/api/") ||
      req.path.startsWith("/assets/") ||
      /\.[a-z0-9]+$/i.test(req.path)
    )
      return next();
    const r = await resolvePublicPage(req.originalUrl, origin);
    if (r.redirect) return res.redirect(301, r.redirect);
    const nonce = randomBytes(16).toString("base64");
    const payload: PublicPagePayload = {
      metadata: r.metadata,
      status: r.status,
      discoveryHtml: r.discoveryHtml,
    };
    const body = marketing[req.path] ? r.content : shell(r.content);
    const html = (await template("index.html"))
      .replaceAll("__COLABB_BOOT_NONCE__", nonce)
      .replace(/<title>.*?<\/title>/s, "")
      .replace(/<meta\s+name="description"[^>]*>/s, "")
      .replace("</head>", metadataHTML(r.metadata, nonce) + "</head>")
      .replace(
        '<div id="root"></div>',
        `<div id="root">${body}</div><script id="colabb-public-page" type="application/json" nonce="${nonce}" data-path="${e(req.originalUrl)}">${json(payload)}</script>`,
      );
    const csp = String(res.getHeader("Content-Security-Policy") || "");
    res.set(
      "Content-Security-Policy",
      csp.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`),
    );
    res.vary("Cookie");
    res.vary("User-Agent");
    res
      .set({ "Cache-Control": "no-store", "X-Robots-Tag": r.metadata.robots })
      .status(r.status)
      .type("html")
      .send(html);
  });
  return router;
}
