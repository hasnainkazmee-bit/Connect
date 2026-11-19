import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { PublicPagePayload } from "../../api/src/shared/public-seo";
import "./brand/discovery.css";

let initial: { path: string; value: PublicPagePayload } | undefined;
try {
  const tag = document.getElementById("colabb-public-page");
  if (tag)
    initial = {
      path: tag.dataset.path || "",
      value: JSON.parse(tag.textContent || "{}"),
    };
} catch {}
const initialUntil = Date.now() + 5000;
const pending = new Map<string, Promise<PublicPagePayload>>();
function getPage(
  path: string,
  signal?: AbortSignal,
): Promise<PublicPagePayload> {
  if (initial?.path === path && Date.now() < initialUntil) {
    const value = initial.value;
    return Promise.resolve(value);
  }
  let promise = pending.get(path);
  if (!promise) {
    promise = fetch("/api/public-page?" + new URLSearchParams({ path }), {
      credentials: "omit",
    })
      .then((r) => {
        if (!r.ok) throw new Error("Could not load this page.");
        return r.json();
      })
      .finally(() => pending.delete(path));
    pending.set(path, promise);
  }
  return promise.then((value) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return value;
  });
}
function setMeta(key: string, value: string, property = false) {
  const attr = property ? "property" : "name";
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.append(el);
  }
  el.content = value;
  el.dataset.colabbSeo = "";
}
export function PublicSEO() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const controller = new AbortController();
    // Never leave a previous company's schema attached to an account/workspace.
    document.head
      .querySelectorAll('script[type="application/ld+json"]')
      .forEach((s) => s.remove());
    setMeta("robots", "noindex,follow");
    getPage(pathname + search, controller.signal)
      .then(({ metadata: m }) => {
        document.title = m.title;
        let canonical = document.head.querySelector<HTMLLinkElement>(
          'link[rel="canonical"]',
        );
        if (!canonical) {
          canonical = document.createElement("link");
          canonical.rel = "canonical";
          document.head.append(canonical);
        }
        canonical.href = m.canonical;
        canonical.dataset.colabbSeo = "";
        setMeta("description", m.description);
        setMeta("robots", m.robots);
        for (const [key, value] of Object.entries({
          "og:title": m.title,
          "og:description": m.description,
          "og:url": m.canonical,
          "og:type": "website",
          "og:site_name": "Colabb",
          "og:locale": "en_US",
          "og:image": m.image,
          "og:image:width": "1200",
          "og:image:height": "630",
          "og:image:alt": m.imageAlt,
        }))
          setMeta(key, value, true);
        for (const [key, value] of Object.entries({
          "twitter:card": "summary_large_image",
          "twitter:title": m.title,
          "twitter:description": m.description,
          "twitter:image": m.image,
          "twitter:image:alt": m.imageAlt,
        }))
          setMeta(key, value);
        if (m.schema) {
          const script = document.createElement("script");
          script.type = "application/ld+json";
          script.dataset.colabbSeo = "";
          script.textContent = JSON.stringify(m.schema).replace(
            /</g,
            "\\u003c",
          );
          document.head.append(script);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          document.title = "Colabb";
          setMeta("robots", "noindex,follow");
        }
      });
    return () => controller.abort();
  }, [pathname, search]);
  return null;
}
export function ServiceDiscovery() {
  const { pathname, search } = useLocation(),
    key = pathname + search;
  const [result, setResult] = useState<{
      key: string;
      page: PublicPagePayload;
    } | null>(null),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    getPage(key, controller.signal)
      .then((page) => setResult({ key, page }))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [key, retry]);
  if (error)
    return (
      <section className="seo-page">
        <h1>We could not load these companies.</h1>
        <p>Please try again.</p>
        <button className="seo-cta" onClick={() => setRetry(retry + 1)}>
          Try again
        </button>
      </section>
    );
  if (result?.key !== key)
    return (
      <section className="seo-page" role="status">
        Finding companies…
      </section>
    );
  return (
    <div
      dangerouslySetInnerHTML={{
        __html:
          result.page.discoveryHtml ||
          '<section class="seo-page"><h1>Page not found.</h1><a href="/services">Browse services</a></section>',
      }}
    />
  );
}
