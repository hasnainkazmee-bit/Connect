import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pool, root } from "./db.js";
import { directoryPlaces, directorySearch } from "./directory.js";

const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const publicUrl = (username: string) => "/" + encodeURIComponent(username);
const noIndexPaths = new Set([
  "claim",
  "account",
  "settings",
  "messages",
  "network",
  "requests",
  "invite",
  "join",
]);
let template: string;

export function publicPages() {
  const router = Router();
  const origin = (process.env.APP_ORIGIN || "http://localhost:5173").replace(
    /\/$/,
    "",
  );
  router.get("/robots.txt", (_req, res) =>
    res
      .type("text/plain")
      .send(
        `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /claim\nDisallow: /account\nDisallow: /settings\nDisallow: /messages\nDisallow: /network\nDisallow: /invite\nDisallow: /join\nSitemap: ${origin}/sitemap.xml\n`,
      ),
  );
  router.get("/sitemap.xml", async (_req, res) => {
    const companies = (
      await pool.query(
        "SELECT username FROM companies WHERE NOT is_demo AND username IS NOT NULL ORDER BY username LIMIT 45000",
      )
    ).rows;
    const places = [];
    for (const place of directoryPlaces)
      if (
        (await directorySearch({ type: "Installer", area: place.slug })).total
      )
        places.push("/directory/installers/" + place.slug);
    const posts = (
      await pool.query(
        "SELECT p.id FROM posts p JOIN companies c ON c.id=p.company_id WHERE p.status='published' AND NOT p.is_demo AND NOT c.is_demo ORDER BY p.published_at DESC LIMIT 4000",
      )
    ).rows;
    const urls = [
      "/",
      "/directory",
      ...places,
      ...companies.map((c) => publicUrl(c.username)),
      ...posts.map((p) => "/posts/" + p.id),
    ];
    res
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${escape(origin + url)}</loc></url>`).join("")}</urlset>`,
      );
  });
  router.get("/{*path}", async (req, res, next) => {
    // Asset requests must return real 404s, never the application shell.
    if (req.path.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(req.path))
      return res.sendStatus(404);
    if (!template)
      template = await fs.readFile(
        path.join(root, "apps/web/dist/index.html"),
        "utf8",
      );
    let title = "Connect. Talk. Celebrate.",
      description =
        "Find solar companies, explore their work and connect with the industry.",
      canonical = req.path,
      content = "",
      status = 200,
      indexable = true,
      structured: unknown = null;
    const segments = req.path.split("/").filter(Boolean);
    if (
      req.path === "/" ||
      req.path === "/directory" ||
      segments[0] === "directory"
    ) {
      const place =
        segments.length === 3 && segments[1] === "installers"
          ? directoryPlaces.find((p) => p.slug === segments[2])
          : null;
      if (segments.length > 1 && !place) {
        status = 404;
        indexable = false;
        content =
          "<h1>That location page isn’t here.</h1><a href='/directory'>Explore companies</a>";
      } else {
        const query = place
          ? { ...req.query, type: "Installer", area: place.slug }
          : req.query;
        const data = await directorySearch(query);
        title = place
          ? `Solar installers serving ${place.name} | Connect`
          : "Find solar companies | Connect";
        description = place
          ? `Explore solar installers serving ${place.name}. Compare services, read company profiles and contact a business.`
          : "Find solar installers, manufacturers and EPC partners by service and location. Explore public company profiles on Connect.";
        if (Object.keys(req.query).length || (place && !data.total))
          indexable = false;
        content = `<div class="discovery"><section class="discovery-intro"><div><span class="discovery-eyebrow">THE SOLAR DIRECTORY</span><h1>${escape(place ? `Solar installers serving ${place.name}.` : "Find the right company. Bring your next project to life.")}</h1><p>${escape(description)}</p></div></section>
          <form action="/directory" class="discovery-search"><label>Company or service<input name="q" value="${escape(req.query.q)}"/></label><label>City or state<input name="area" value="${escape(place?.name || req.query.area)}"/></label><button class="button primary">Find companies</button></form>
          <p class="discovery-results-heading">${data.total} companies</p><section class="discovery-grid">${data.companies.map((c: any) => `<article class="discovery-card"><a class="discovery-card-link" href="${publicUrl(c.username || c.slug)}"><div class="discovery-card-top">${c.logo_url ? `<img width="110" height="48" style="object-fit:contain" src="${escape(c.logo_url)}" alt="${escape(c.name)} logo"/>` : ""}<span class="discovery-type">${escape(c.type)}</span></div><h2>${escape(c.name)}</h2><p class="discovery-tagline">${escape(c.tagline)}</p><p>${escape(c.location)}</p><p class="discovery-tagline">Serves ${escape(c.service_areas.join(", "))}</p><div class="discovery-card-footer">View company →</div></a></article>`).join("")}</section><p class="discovery-source-note">Public listings include information from official company websites. Listing a business is not an endorsement.</p><a href="/claim">Own a business? Claim your profile</a></div>`;
        structured = {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: data.companies.map((c: any, i: number) => ({
            "@type": "ListItem",
            position: (data.page - 1) * data.pageSize + i + 1,
            url: origin + publicUrl(c.username || c.slug),
            name: c.name,
          })),
        };
      }
    } else if (segments[0] === "posts" && segments.length === 2) {
      const p = (
        await pool.query(
          "SELECT p.*,c.name AS company_name,c.username,c.slug,c.is_demo AS company_demo FROM posts p JOIN companies c ON c.id=p.company_id WHERE p.id::text=$1 AND p.status='published'",
          [segments[1]],
        )
      ).rows[0];
      if (!p) {
        status = 404;
        indexable = false;
        content =
          "<h1>This publication isn’t available.</h1><a href='/directory'>Explore companies</a>";
      } else {
        title = `${p.title || p.company_name + " update"} | Connect`;
        description = (p.subtitle || p.body).slice(0, 300);
        indexable = !p.is_demo && !p.company_demo;
        content = `<article class="profile-card"><a href="${publicUrl(p.username || p.slug)}">${escape(p.company_name)}</a><h1>${escape(p.title || "Company update")}</h1>${p.subtitle ? `<p>${escape(p.subtitle)}</p>` : ""}<div class="profile-about-full">${escape(p.body)}</div></article>`;
        structured = {
          "@context": "https://schema.org",
          "@type": p.kind === "post" ? "SocialMediaPosting" : "Article",
          headline: p.title || p.company_name + " update",
          description,
          articleBody: p.body,
          datePublished: p.published_at,
          dateModified: p.updated_at,
          author: {
            "@type": "Organization",
            name: p.company_name,
            url: origin + publicUrl(p.username || p.slug),
          },
          mainEntityOfPage: origin + canonical,
        };
      }
    } else if (
      (segments.length === 1 && !noIndexPaths.has(segments[0])) ||
      (segments[0] === "company" && segments.length === 2)
    ) {
      const key = decodeURIComponent(segments.at(-1)!).toLowerCase();
      const c = (
        await pool.query(
          "SELECT * FROM companies WHERE username=$1 OR slug=$1 OR id::text=$1 OR id=(SELECT company_id FROM company_username_history WHERE username=$1) LIMIT 1",
          [key],
        )
      ).rows[0];
      if (!c) {
        status = 404;
        indexable = false;
        content =
          "<h1>Company not found.</h1><a href='/directory'>Explore companies</a>";
      } else {
        canonical = publicUrl(c.username || c.slug);
        if (req.path !== canonical)
          return res.redirect(
            301,
            canonical +
              (req.url.includes("?") ? "?" + req.url.split("?")[1] : ""),
          );
        indexable = !c.is_demo;
        title = `${c.name} | Connect`;
        description = (
          c.description ||
          c.tagline ||
          `${c.name} on Connect`
        ).slice(0, 300);
        const [projects, reviews, posts, achievements] = await Promise.all([
          pool.query(
            "SELECT name,description,location FROM projects WHERE company_id=$1 ORDER BY id LIMIT 12",
            [c.id],
          ),
          pool.query(
            "SELECT r.rating,r.body,u.name FROM company_reviews r JOIN users u ON u.id=r.user_id WHERE r.company_id=$1 AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.company_id=r.company_id AND m.user_id=r.user_id) ORDER BY r.created_at DESC LIMIT 10",
            [c.id],
          ),
          pool.query(
            "SELECT id,title,body FROM posts WHERE company_id=$1 AND status='published' ORDER BY created_at DESC LIMIT 10",
            [c.id],
          ),
          pool.query(
            "SELECT title,description FROM company_achievements WHERE company_id=$1 ORDER BY created_at DESC LIMIT 10",
            [c.id],
          ),
        ]);
        content = `<div class="company-home"><a class="claim-back" href="/directory">← Directory</a><section class="profile-card">${c.logo_url ? `<img width="160" height="70" style="object-fit:contain" src="${escape(c.logo_url)}" alt="${escape(c.name)} logo"/>` : ""}<h1>${escape(c.name)}</h1><p>${escape(c.tagline)}</p><p>${escape(c.type)} · Based in ${escape(c.location)}</p>${c.website ? `<a class="button primary" href="${escape(c.website)}">Visit website</a>` : ""}${c.phone ? ` <a class="button" href="tel:${escape(c.phone.replace(/[^+\d]/g, ""))}">Call ${escape(c.phone)}</a>` : ""}</section>${c.listing_status === "unclaimed" ? `<aside class="listing-notice"><div><strong>Own this business?</strong><p>This listing was added from the company’s official website. Its team hasn’t claimed it yet.</p></div><a class="button" href="/claim/${escape(c.username || c.slug)}">Claim this profile</a></aside>` : ""}
          <section class="profile-card"><h2>About ${escape(c.name)}</h2><p class="profile-about-full">${escape(c.description)}</p><h3>What we do</h3><p>${escape(c.services.join(" · "))}</p><h3>Where we work</h3><p>${escape(c.service_areas.join(" · "))}</p>${c.source_url ? `<p class="listing-sources">Listing source: <a href="${escape(c.source_url)}">Company’s official website</a>. Confirm coverage and availability with the company.</p>` : ""}</section>
          ${projects.rows.length ? `<section class="profile-card"><h2>Portfolio</h2>${projects.rows.map((p) => `<h3>${escape(p.name)}</h3><p>${escape(p.location)}</p><p>${escape(p.description)}</p>`).join("")}</section>` : ""}
          ${achievements.rows.length ? `<section class="profile-card"><h2>Achievements</h2>${achievements.rows.map((p) => `<h3>${escape(p.title)}</h3><p>${escape(p.description)}</p>`).join("")}</section>` : ""}
          ${posts.rows.length ? `<section class="profile-card"><h2>Company updates</h2>${posts.rows.map((p) => `<article><a href="/posts/${p.id}"><h3>${escape(p.title || "Company update")}</h3><p>${escape(p.body.slice(0, 600))}</p></a></article>`).join("")}</section>` : ""}
          <section class="profile-card"><h2>Customer reviews</h2>${reviews.rows.length ? reviews.rows.map((r) => `<article><strong>${escape(r.name)} · ${r.rating}/5</strong><p>${escape(r.body)}</p></article>`).join("") : "<p>No Connect reviews yet.</p>"}</section></div>`;
        // Organization is accurate without inventing a complete street address for LocalBusiness.
        structured = {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: c.name,
          url: origin + canonical,
          description,
          logo: c.logo_url ? origin + c.logo_url : undefined,
          sameAs: c.website ? [c.website] : undefined,
          areaServed: c.service_areas,
          telephone: c.phone || undefined,
        };
      }
    } else {
      indexable = false;
      content = "<p class='manage-loading'>Opening Connect…</p>";
    }
    const nonce = randomBytes(16).toString("base64");
    const meta = `<title>${escape(title)}</title><meta name="description" content="${escape(description)}"/><link rel="canonical" href="${escape(origin + canonical)}"/><meta property="og:title" content="${escape(title)}"/><meta property="og:description" content="${escape(description)}"/><meta property="og:url" content="${escape(origin + canonical)}"/><meta property="og:type" content="website"/>${indexable ? "" : "<meta name='robots' content='noindex,follow'/>"}${structured ? `<script type="application/ld+json" nonce="${nonce}">${JSON.stringify(structured).replace(/</g, "\\u003c")}</script>` : ""}`;
    const html = template
      .replace(/<title>.*?<\/title>/s, "")
      .replace(/<meta\s+name="description"[^>]*>/s, "")
      .replace("</head>", meta + "</head>")
      .replace(
        '<div id="root"></div>',
        `<div id="root"><header class="site-header"><div class="header-inner"><a class="brand" href="/"><img src="/assets/connect-logo.png" alt="Connect"/></a><nav class="primary-nav"><a href="/directory">Directory</a><a href="/claim">Claim your company</a></nav></div></header><main class="app-main">${content}</main></div>`,
      );
    const csp = String(res.getHeader("Content-Security-Policy") || "");
    res.set(
      "Content-Security-Policy",
      csp.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`),
    );
    res.set("Cache-Control", "no-store").status(status).type("html").send(html);
  });
  return router;
}
