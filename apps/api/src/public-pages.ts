import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pool, root } from "./db.js";

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
    const urls = [
      "/",
      "/providers",
      "/jobs",
      ...companies.map((c) => publicUrl(c.username)),
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
    let title = "Connect by Sunhub | Solar work, crews and specialists",
      description =
        "Find crews, electricians, specialists, and solar business support. Post what you need and compare quotes on Connect by Sunhub.",
      canonical = req.path,
      content = "",
      status = 200,
      indexable = true,
      structured: unknown = null;
    const segments = req.path.split("/").filter(Boolean);
    if (req.path === "/directory" || segments[0] === "directory")
      return res.redirect(301, "/providers");
    if (segments[0] === "posts" && segments.length === 2) {
      const row = (
        await pool.query(
          "SELECT c.username,c.slug FROM posts p JOIN companies c ON c.id=p.company_id WHERE p.id::text=$1 AND p.status='published' LIMIT 1",
          [segments[1]],
        )
      ).rows[0];
      return row
        ? res.redirect(301, publicUrl(row.username || row.slug))
        : res.sendStatus(404);
    }
    if (req.path === "/") {
      title = "Connect by Sunhub | Find solar work and service providers";
      description =
        "Find crews, specialist services, and support for your solar business on Connect by Sunhub.";
      content = `<div class="market-landing landing-editorial"><section class="landing-hero"><div class="landing-eyebrow">THE SOLAR WORK MARKETPLACE · BY SUNHUB</div><h1>Solar runs on people.</h1><div class="landing-hero-intro"><p>A crew for next week. An electrician for tomorrow. A partner for the long run. Find the right company for the work ahead.</p><div class="landing-actions"><a class="jobs-button jobs-primary" href="/jobs/new">Post a job →</a><a class="landing-text-link" href="/jobs">Find work →</a></div></div><figure class="landing-hero-photo"><picture><source media="(max-width:600px)" srcset="/assets/marketplace/solar-crew-800.webp"/><img src="/assets/marketplace/solar-crew-1600.webp" width="1536" height="1024" alt="A crew working together on a commercial solar array" fetchpriority="high"/></picture><figcaption>From the first plan to the final panel.</figcaption></figure></section></div>`;
    } else if (req.path === "/providers") {
      const data =
        await pool.query(`SELECT id,username,slug,name,type,tagline,description,location,logo_url,services,service_areas
        FROM companies WHERE NOT is_demo
        ORDER BY (listing_status='managed') DESC,(logo_url<>'') DESC,name LIMIT 24`);
      title = "Solar service providers | Connect by Sunhub";
      description =
        "Find solar installers, EPCs, specialist contractors and suppliers by service and location.";
      content = `<div class="jobs-page provider-directory"><div class="provider-intro"><div><span class="provider-overline">THE PEOPLE WHO GET IT BUILT</span><h1>Find the right crew for the work.</h1><p>${escape(description)}</p></div></div><section class="provider-grid">${data.rows.map((c: any) => `<a class="provider-card" href="${publicUrl(c.username || c.slug)}"><div class="provider-card-head">${c.logo_url ? `<img width="68" height="58" src="${escape(c.logo_url)}" alt=""/>` : ""}<span class="provider-card-type">${escape(c.type)}</span></div><h2>${escape(c.name)}</h2><p>${escape(c.tagline || c.description)}</p><p>${escape(c.location)}</p><div class="provider-card-bottom"><span>${escape(c.services.slice(0, 2).join(" · "))}</span><b>View profile →</b></div></a>`).join("")}</section></div>`;
      structured = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: data.rows.map((c: any, i: number) => ({
          "@type": "ListItem",
          position: i + 1,
          url: origin + publicUrl(c.username || c.slug),
          name: c.name,
        })),
      };
    } else if (segments[0] === "jobs") {
      title =
        segments.length === 1 ? "Find solar jobs | Connect" : "Jobs | Connect";
      description =
        "Find solar work, crew requests, and specialist opportunities. Send quotes and work with companies on Connect.";
      indexable = segments.length === 1;
      content = "<p class='manage-loading'>Opening jobs…</p>";
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
          "<h1>Company not found.</h1><a href='/providers'>Explore providers</a>";
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
        content = `<div class="jobs-page provider-profile"><a class="job-back" href="/providers">← Service providers</a><section class="provider-profile-hero"><div class="provider-profile-mark">${c.logo_url ? `<img src="${escape(c.logo_url)}" alt=""/>` : ""}</div><div class="provider-profile-title"><div class="provider-profile-label">${c.is_demo ? "DEMO COMPANY" : c.listing_status === "managed" ? escape(c.type).toUpperCase() : "PUBLIC LISTING"}</div><h1>${escape(c.name)}</h1><p>${escape(c.tagline || c.type)}</p><span>Based in ${escape(c.location)}</span></div>${c.listing_status === "unclaimed" ? `<a class="jobs-button jobs-secondary" href="/claim/${escape(c.username || c.slug)}">Claim profile</a>` : ""}</section><div class="provider-profile-layout"><div><section class="jobs-panel"><h2>What we do</h2><p class="provider-about">${escape(c.description)}</p></section><section class="jobs-panel"><h2>Work we take on</h2><p>${escape(c.services.join(" · "))}</p></section>${projects.rows.length ? `<section class="jobs-panel"><h2>Recent work</h2>${projects.rows.map((p) => `<article><h3>${escape(p.name)}</h3><p>${escape(p.location)} · ${escape(p.description)}</p></article>`).join("")}</section>` : ""}${posts.rows.length ? `<section class="jobs-panel"><h2>Company updates</h2>${posts.rows.map((p) => `<article><h3>${escape(p.title || "Update")}</h3><p>${escape(p.body.slice(0, 300))}</p></article>`).join("")}</section>` : ""}<section class="jobs-panel"><h2>Customer reviews</h2>${reviews.rows.length ? reviews.rows.map((r) => `<article><strong>${escape(r.name)} · ${r.rating}/5</strong><p>${escape(r.body)}</p></article>`).join("") : "<p>No Connect reviews yet.</p>"}</section></div><aside class="jobs-aside"><section class="jobs-panel"><h2>Where we work</h2><p>Based in ${escape(c.location)}</p><p>${escape(c.service_areas.join(" · "))}</p></section><section class="jobs-panel"><h2>Company details</h2><p>${escape(c.type)}</p>${c.website ? `<a href="${escape(c.website)}">Website ↗</a>` : ""}</section></aside></div></div>`;
        // Organization is accurate without inventing a complete street address for LocalBusiness.
        structured = {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: c.name,
          url: origin + canonical,
          description,
          logo: c.logo_url ? new URL(c.logo_url, origin).href : undefined,
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
        `<div id="root"><header class="jobs-site-header"><div class="jobs-header-inner"><a class="jobs-brand" href="/"><img src="/assets/connect-icon.png" alt=""/><span><strong>connect</strong><small>by Sunhub</small></span></a><nav class="jobs-top-nav"><a href="/jobs">Find work</a><a href="/providers">Find companies</a><a href="/#how-it-works">How it works</a></nav><div class="jobs-header-actions"><a class="jobs-button jobs-primary" href="/jobs/new">Post a job</a><a class="jobs-button jobs-secondary" href="/account">Sign in</a></div></div></header><main class="app-main">${content}</main></div>`,
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
