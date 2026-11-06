import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  Building2,
  Check,
  Factory,
  Globe,
  Hammer,
  HardHat,
  LoaderCircle,
  MapPinned,
  MapPin,
  Search,
  Star,
  Truck,
  Wrench,
  X,
} from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
import { Logo } from "./identity";
import type { Company } from "./types";
import "./directory.css";

type Results = {
  companies: Company[];
  total: number;
  services: string[];
  areas: string[];
  types: Record<string, number>;
  page: number;
  pageSize: number;
  places: { slug: string; name: string; region: string }[];
};
const categories = [
  { label: "All companies", value: "", icon: Building2 },
  { label: "Installers", value: "Installer", icon: HardHat },
  { label: "EPCs", value: "EPC", icon: Building2 },
  { label: "Manufacturers", value: "Manufacturer", icon: Factory },
  { label: "Contractors", value: "Contractor", icon: Hammer },
  { label: "Developers", value: "Developer", icon: MapPinned },
  { label: "Distributors", value: "Distributor", icon: Truck },
  { label: "Service providers", value: "Service provider", icon: Wrench },
];
export function Directory({ home = false }: { home?: boolean }) {
  const { session, revision, createCompany, signIn } = useApp();
  const navigate = useNavigate();
  const { place } = useParams();
  const [params, setParams] = useSearchParams();
  const query = new URLSearchParams(params);
  if (place) {
    query.set("type", "Installer");
    query.set("area", place);
  }
  const queryKey = query.toString();
  const [data, setData] = useState<Results | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const type = query.get("type") || "",
    area = query.get("area") || "",
    q = query.get("q") || "";
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    api<Results>("/companies?" + queryKey, { signal: abort.signal })
      .then((r) => {
        if (!abort.signal.aborted) setData(r);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [queryKey, revision]);
  const placeName = data?.places.find((p) => p.slug === place)?.name;
  useEffect(() => {
    document.title = placeName
      ? `Solar installers serving ${placeName} | Connect`
      : "Find solar companies | Connect";
  }, [placeName]);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(query);
    next.delete("page");
    value ? next.set(key, value) : next.delete(key);
    if (place) navigate("/directory?" + next.toString());
    else setParams(next);
  };
  const filtered = !!(
    q ||
    type ||
    area ||
    query.get("service") ||
    query.get("audience") ||
    query.get("office")
  );
  const clear = () => (place ? navigate("/directory") : setParams({}));
  return (
    <div className={"discovery " + (home ? "discovery-home" : "")}>
      <section className="discovery-intro">
        <div>
          <span className="discovery-eyebrow">
            <span /> THE SOLAR DIRECTORY
          </span>
          <h1>
            {placeName ? (
              <>
                Solar installers
                <br />
                serving {placeName}.
              </>
            ) : home ? (
              <>
                Find the right company.
                <br />
                Bring your next project to life.
              </>
            ) : (
              "Discover companies"
            )}
          </h1>
          <p>
            Explore solar installers, manufacturers and partners. Get to know
            their work, then get in touch.
          </p>
        </div>
        <div className="discovery-intro-note">
          <img src="/assets/connect-icon.png" alt="" />
          <span>
            Connect.
            <br />
            Talk.
            <br />
            Celebrate.
          </span>
        </div>
      </section>
      <form
        className="discovery-search"
        key={q + area}
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const next = new URLSearchParams(query);
          next.delete("page");
          for (const field of ["q", "area"]) {
            const value = String(form.get(field) || "").trim();
            value ? next.set(field, value) : next.delete(field);
          }
          navigate("/directory" + (next.size ? "?" + next.toString() : ""));
        }}
      >
        <label>
          <Search size={21} />
          <span>
            <b>What are you looking for?</b>
            <input
              name="q"
              aria-label="Search directory"
              defaultValue={q}
              placeholder="Company name or service"
              maxLength={100}
            />
          </span>
        </label>
        <label>
          <MapPin size={21} />
          <span>
            <b>Where do you need them?</b>
            <input
              name="area"
              aria-label="Service area"
              defaultValue={placeName || area}
              placeholder="City or state"
              list="directory-areas"
              maxLength={60}
            />
          </span>
        </label>
        <datalist id="directory-areas">
          {[
            ...new Set([
              ...(data?.places.map((p) => p.name) || []),
              ...(data?.areas || []),
            ]),
          ].map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <button className="button primary" aria-label="Search">
          <Search size={17} />
          <span>Find companies</span>
        </button>
      </form>
      <div className="discovery-filters">
        <nav className="discovery-categories" aria-label="Business categories">
          {categories.map(({ label, value, icon: Icon }) => (
            <button
              key={label}
              aria-pressed={type === value}
              onClick={() => change("type", value)}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <div className="discovery-selects">
          <select
            aria-label="Company type"
            value={type}
            onChange={(e) => change("type", e.target.value)}
          >
            <option value="">All business types</option>
            {[
              "Installer",
              "Manufacturer",
              "EPC",
              "Contractor",
              "Developer",
              "Distributor",
              "Service provider",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            aria-label="Services"
            value={query.get("service") || ""}
            onChange={(e) => change("service", e.target.value)}
          >
            <option value="">All services</option>
            {(data?.services || []).map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            aria-label="Project type"
            value={query.get("audience") || ""}
            onChange={(e) => change("audience", e.target.value)}
          >
            <option value="">Any project</option>
            <option value="Residential">For my home</option>
            <option value="Commercial">For my business</option>
            <option value="Utility-scale">Utility-scale</option>
          </select>
          {filtered && (
            <button className="text-button" onClick={clear}>
              <X size={14} />
              Clear filters
            </button>
          )}
        </div>
      </div>
      <div className="discovery-results-heading" aria-live="polite">
        <span>
          {loading ? (
            "Finding companies…"
          ) : (
            <>
              <strong>{data?.total || 0}</strong>{" "}
              {data?.total === 1 ? "company" : "companies"}
              {area ? ` serving ${placeName || area}` : " to explore"}
            </>
          )}
        </span>
        <span>Public profiles. Open to everyone.</span>
      </div>
      {error ? (
        <div role="alert" className="discovery-empty">
          <h2>We couldn’t load the directory.</h2>
          <p>{error}</p>
          <button className="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      ) : loading && !data ? (
        <div className="discovery-loading">
          <LoaderCircle className="spin" />
          Loading companies…
        </div>
      ) : (
        <>
          <section
            className="discovery-grid"
            aria-label="Company listings"
            aria-busy={loading}
          >
            {data?.companies.map((c) => (
              <article className="discovery-card" key={c.id}>
                <Link
                  className="discovery-card-link"
                  to={"/" + (c.username || c.slug)}
                >
                  <div className="discovery-card-top">
                    <Logo company={c} />
                    <span className="discovery-type">{c.type}</span>
                  </div>
                  <h2>
                    {c.name}
                    <ArrowUpRight size={17} />
                  </h2>
                  <p className="discovery-tagline">
                    {c.tagline || "Explore this company’s services and work."}
                  </p>
                  {!!c.certifications?.length && (
                    <div
                      className="discovery-certifications"
                      aria-label="Certifications and qualifications"
                    >
                      {c.certifications.slice(0, 2).map((certificate) => (
                        <span
                          className="discovery-certificate"
                          key={certificate.id}
                          title={`${certificate.title} · ${certificate.scope} · ${certificate.evidence_basis === "company" ? "Company-reported" : certificate.evidence_basis === "issuer" ? "Issuer source" : "Directory source"}\n${certificate.scope_detail}`}
                        >
                          <Award size={14} aria-hidden="true" />
                          <span>{certificate.title}</span>
                        </span>
                      ))}
                      {(c.certification_count || 0) > 2 && (
                        <span
                          className="discovery-certificate-more"
                          title={`${c.certification_count! - 2} more certifications and qualifications`}
                        >
                          +{c.certification_count! - 2}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="discovery-facts">
                    <span>
                      <MapPin size={14} />
                      {c.location || "Location not added"}
                    </span>
                    <span>
                      <Globe size={14} />
                      <span>
                        {c.service_areas.length
                          ? (c.type === "Manufacturer"
                              ? "Supplies "
                              : "Serves ") +
                            c.service_areas.slice(0, 2).join(" · ") +
                            (c.service_areas.length > 2
                              ? ` +${c.service_areas.length - 2}`
                              : "")
                          : "Ask about service coverage"}
                      </span>
                    </span>
                  </div>
                  <div className="discovery-tags">
                    {c.services.slice(0, 3).map((s) => (
                      <span key={s}>{s}</span>
                    ))}
                  </div>
                  <div className="discovery-card-footer">
                    <span>
                      {c.review_count ? (
                        <>
                          <Star size={14} />
                          <b>{c.rating_average?.toFixed(1)}</b> (
                          {c.review_count})
                        </>
                      ) : (
                        "No Connect reviews yet"
                      )}
                    </span>
                    <span>
                      {c.listing_status === "unclaimed" ? (
                        "View company"
                      ) : (
                        <>
                          <span className="discovery-online" />
                          On Connect
                        </>
                      )}
                      <ArrowRight size={15} />
                    </span>
                  </div>
                </Link>
              </article>
            ))}
          </section>
          {!data?.companies.length && (
            <div className="discovery-empty">
              <Search size={28} />
              <h2>No companies match just yet.</h2>
              <p>
                Try a nearby city, a state, or fewer filters. We’re adding more
                companies.
              </p>
              <button className="button" onClick={clear}>
                Explore all companies
              </button>
            </div>
          )}
          {data && data.total > data.pageSize && (
            <div className="directory-pagination">
              <button
                className="button"
                disabled={data.page === 1}
                onClick={() => {
                  const p = new URLSearchParams(query);
                  p.set("page", String(data.page - 1));
                  setParams(p);
                }}
              >
                Previous
              </button>
              <span>
                Page {data.page} of {Math.ceil(data.total / data.pageSize)}
              </span>
              <button
                className="button"
                disabled={data.page * data.pageSize >= data.total}
                onClick={() => {
                  const p = new URLSearchParams(query);
                  p.set("page", String(data.page + 1));
                  setParams(p);
                }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
      <section className="discovery-bottom">
        <div className="discovery-owner">
          <Building2 size={25} />
          <div>
            <h2>Your company belongs here.</h2>
            <p>
              Claim an existing profile or add your business. Manage your
              listing, share your work and meet your next partner in Connect.
            </p>
            <div>
              <Link className="button" to="/claim">
                Find my company <ArrowRight size={15} />
              </Link>
              {session.user?.account_type !== "individual" && (
                <button
                  className="text-button"
                  onClick={() => (session.user ? createCompany() : signIn())}
                >
                  Add a company
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="discovery-places">
          <h3>Find installers near you</h3>
          {data?.places.map((p) => (
            <Link key={p.slug} to={"/directory/installers/" + p.slug}>
              {p.name}
              <ArrowUpRight size={13} />
            </Link>
          ))}
        </div>
      </section>
      <p className="discovery-source-note">
        <Check size={14} />
        Directory listings use company-provided information or cited official
        websites. Listing a business does not mean it has joined Connect or been
        endorsed.
      </p>
    </div>
  );
}
