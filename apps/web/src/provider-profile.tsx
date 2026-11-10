import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  FileBadge,
  ExternalLink,
  MapPin,
  MessageCircle,
  Pencil,
  Star,
  Wrench,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import {
  ProfileEditor,
  PortfolioEditor,
  useUnsavedChanges,
} from "./management";
import type { Company, Profile } from "./types";

type Provider = Company & {
  trades: string[];
  project_types: string[];
  availability: string;
  crew_size: string;
  capacity: string;
  license_details: string;
  insurance_details: string;
};
type Stats = {
  rating: number;
  reviewCount: number;
  completedJobs: number;
  reviews: { id: string; rating: number; text: string; reviewer: string }[];
};
type Update = {
  id: string;
  title: string;
  body: string;
  kind: string;
  published_at: string;
};
const list = (value: string) =>
  value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

function WorkDetailsEditor({
  provider,
  onSaved,
}: {
  provider: Provider;
  onSaved: () => void;
}) {
  const { close } = useApp();
  const [trades, setTrades] = useState((provider.trades || []).join(", "));
  const [projects, setProjects] = useState(
    (provider.project_types || []).join(", "),
  );
  const [availability, setAvailability] = useState(provider.availability || "");
  const [crew, setCrew] = useState(provider.crew_size || "");
  const [capacity, setCapacity] = useState(provider.capacity || "");
  const [license, setLicense] = useState(provider.license_details || "");
  const [insurance, setInsurance] = useState(provider.insurance_details || "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useUnsavedChanges(
    trades !== (provider.trades || []).join(", ") ||
      projects !== (provider.project_types || []).join(", ") ||
      availability !== (provider.availability || "") ||
      crew !== (provider.crew_size || "") ||
      capacity !== (provider.capacity || "") ||
      license !== (provider.license_details || "") ||
      insurance !== (provider.insurance_details || ""),
    busy,
  );
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/jobs/providers/me", {
        method: "PATCH",
        body: JSON.stringify({
          trades: list(trades),
          projectTypes: list(projects),
          availability,
          crewSize: crew,
          capacity,
          licenseDetails: license,
          insuranceDetails: insurance,
        }),
      });
      onSaved();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="manage-dialog provider-edit">
      <header className="manage-heading">
        <h2>Work details</h2>
        <p>
          Help hiring companies understand the work you take on. Only add
          details you can support.
        </p>
      </header>
      <form className="manage-form" onSubmit={save}>
        <label>
          Trades <small>Separate with commas</small>
          <input
            value={trades}
            onChange={(e) => setTrades(e.target.value)}
            placeholder="Installation, Electrical, Roofing"
          />
        </label>
        <label>
          Project types <small>Separate with commas</small>
          <input
            value={projects}
            onChange={(e) => setProjects(e.target.value)}
            placeholder="Commercial rooftop, Residential storage"
          />
        </label>
        <div className="provider-edit-pair">
          <label>
            Availability
            <input
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              placeholder="Available for new projects"
            />
          </label>
          <label>
            Crew size
            <input
              value={crew}
              onChange={(e) => setCrew(e.target.value)}
              placeholder="3 installation crews"
            />
          </label>
        </div>
        <label>
          Capacity
          <input
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="Up to 5 rooftops each month"
          />
        </label>
        <label>
          License details
          <textarea
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            rows={2}
            placeholder="License name, number and issuing state"
          />
        </label>
        <label>
          Insurance details
          <textarea
            value={insurance}
            onChange={(e) => setInsurance(e.target.value)}
            rows={2}
            placeholder="Coverage and expiry date"
          />
        </label>
        {error && <p className="job-error">{error}</p>}
        <footer className="manage-footer">
          <button
            type="button"
            className="button secondary"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save work details"}
          </button>
        </footer>
      </form>
    </section>
  );
}

export function ProviderProfilePage() {
  const p = useParams(),
    [params] = useSearchParams(),
    { company: mine, admin, open, revision, refresh, toast, signIn } = useApp();
  const slug = p.slug || p.username || p.id;
  const [profile, setProfile] = useState<Profile | null>(null),
    [provider, setProvider] = useState<Provider | null>(null),
    [stats, setStats] = useState<Stats | null>(null),
    [updates, setUpdates] = useState<Update[]>([]);
  const [showInvite, setShowInvite] = useState(false),
    [inviting, setInviting] = useState(false);
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([]),
    [chosen, setChosen] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (!slug) return;
    let live = true;
    setError("");
    setProfile(null);
    setProvider(null);
    setUpdates([]);
    setChosen("");
    setShowInvite(false);
    Promise.all([
      api<Profile>("/companies/" + encodeURIComponent(slug)),
      api<{ provider: Provider }>(
        "/jobs/providers/" + encodeURIComponent(slug),
      ),
      api<Stats>("/jobs/companies/" + encodeURIComponent(slug)),
    ])
      .then(([a, b, c]) => {
        if (live) {
          setProfile(a);
          setProvider(b.provider);
          setStats(c);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [slug, revision]);
  useEffect(() => {
    if (!provider) return;
    const controller = new AbortController();
    api<{ posts: Update[] }>("/feed?companyId=" + provider.id, {
      signal: controller.signal,
    })
      .then((v) => setUpdates(v.posts.slice(0, 3)))
      .catch(() => {});
    return () => controller.abort();
  }, [provider?.id]);
  useEffect(() => {
    if (!mine || !admin) return;
    api<{
      jobs: {
        id: string;
        title: string;
        hiring_company_id: string;
        status: string;
      }[];
    }>("/jobs/mine")
      .then((v) =>
        setJobs(
          v.jobs.filter(
            (j) => j.hiring_company_id === mine.id && j.status === "open",
          ),
        ),
      )
      .catch(() => {});
  }, [mine?.id, admin]);
  const invite = async () => {
    if (!chosen || !provider) return;
    setInviting(true);
    try {
      await post("/jobs/" + chosen + "/invite", { companyIds: [provider.id] });
      toast("Invitation sent");
      setChosen("");
      setShowInvite(false);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setInviting(false);
    }
  };
  const c = provider,
    back = params.get("back");
  if (error)
    return (
      <div className="jobs-page">
        <p className="job-error">{error}</p>
        <Link to="/providers">Browse providers</Link>
      </div>
    );
  if (!c || !profile)
    return (
      <div className="jobs-page job-loading">Loading provider profile…</div>
    );
  return (
    <div className="jobs-page provider-profile">
      <Link className="job-back" to={back ? "/jobs/" + back : "/providers"}>
        <ArrowLeft size={16} />
        {back ? "Back to job" : "Service providers"}
      </Link>
      <section className="provider-profile-hero">
        <div className="provider-profile-logo">
          {c.logo_url ? (
            <img
              src={
                c.is_demo && c.logo_url.startsWith("/assets/demo-logos/")
                  ? c.logo_url.replace(/\.svg$/, "-mark.svg")
                  : c.logo_url
              }
              alt=""
            />
          ) : null}
        </div>
        <div className="provider-profile-heading">
          <div className="provider-overline">
            {c.is_demo
              ? "DEMO COMPANY"
              : c.listing_status === "managed"
                ? c.type.toUpperCase()
                : "PUBLIC LISTING"}
          </div>
          <h1>{c.name}</h1>
          <p>{c.tagline || c.type}</p>
          <span>
            <MapPin size={15} />
            {c.location || "Location not listed"}
          </span>
        </div>
        <div className="provider-profile-actions">
          {mine?.id === c.id && admin ? (
            <>
              <button
                className="jobs-button jobs-primary"
                onClick={() => open(<ProfileEditor target={c} />)}
              >
                <Pencil size={16} /> Edit profile
              </button>
              <button
                className="jobs-button jobs-secondary"
                onClick={() =>
                  open(<WorkDetailsEditor provider={c} onSaved={refresh} />)
                }
              >
                <Wrench size={16} /> Edit work details
              </button>
            </>
          ) : (
            <>
              {c.listing_status === "unclaimed" ? (
                <>
                  {c.website && (
                    <a
                      className="jobs-button jobs-primary"
                      href={c.website}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Visit website
                      <ExternalLink size={16} />
                    </a>
                  )}
                  <Link
                    className="jobs-button jobs-secondary"
                    to={"/claim/" + (c.username || c.slug)}
                  >
                    Is this your company?
                  </Link>
                </>
              ) : (
                mine?.id !== c.id && (
                  <>
                    {!mine ? (
                      <button
                        className="jobs-button jobs-primary"
                        onClick={signIn}
                      >
                        Sign in to invite
                      </button>
                    ) : (
                      admin &&
                      !!mine.is_demo === !!c.is_demo && (
                        <button
                          className="jobs-button jobs-primary"
                          onClick={() => setShowInvite((v) => !v)}
                        >
                          Invite to a job
                          <ArrowRight size={16} />
                        </button>
                      )
                    )}
                    {showInvite && (
                      <div className="provider-invite">
                        {jobs.length ? (
                          <>
                            <select
                              aria-label="Choose a job to invite this company to"
                              value={chosen}
                              onChange={(e) => setChosen(e.target.value)}
                            >
                              <option value="">Choose your open job</option>
                              {jobs.map((j) => (
                                <option key={j.id} value={j.id}>
                                  {j.title}
                                </option>
                              ))}
                            </select>
                            <button
                              className="jobs-button jobs-secondary"
                              disabled={!chosen || inviting}
                              onClick={() => void invite()}
                            >
                              {inviting ? "Sending…" : "Send invitation"}
                            </button>
                          </>
                        ) : (
                          <>
                            <small>
                              Post a job first, then invite this company to
                              quote.
                            </small>
                            <Link
                              className="jobs-button jobs-secondary"
                              to="/jobs/new"
                            >
                              Post a job
                            </Link>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )
              )}
            </>
          )}
        </div>
      </section>
      <nav
        className="provider-profile-nav"
        aria-label="Company profile sections"
      >
        <a href="#overview">Overview</a>
        {profile.projects.length > 0 && <a href="#recent-work">Recent work</a>}
        {!!profile.credentials?.length && (
          <a href="#credentials">Credentials</a>
        )}
        <a href="#company-reviews">Reviews</a>
      </nav>
      <div className="provider-profile-layout">
        <main>
          <section className="jobs-panel" id="overview">
            <h2>What we do</h2>
            <p className="provider-about">
              {c.description ||
                c.tagline ||
                "This company has not added a description yet."}
            </p>
          </section>
          {(c.trades.length > 0 || c.services.length > 0) && (
            <section className="jobs-panel">
              <h2>Work we take on</h2>
              <div className="job-service-chips">
                {(c.trades.length ? c.trades : c.services).map((x) => (
                  <span key={x}>
                    <Wrench size={14} />
                    {x}
                  </span>
                ))}
              </div>
              {c.project_types.length > 0 && (
                <>
                  <h3>Project types</h3>
                  <div className="job-service-chips">
                    {c.project_types.map((x) => (
                      <span key={x}>{x}</span>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
          {(profile.projects.length > 0 || (mine?.id === c.id && admin)) && (
            <section className="jobs-panel" id="recent-work">
              <div className="jobs-section-title">
                <h2>Recent work</h2>
                {mine?.id === c.id && admin && (
                  <button
                    className="job-text-button"
                    onClick={() => open(<PortfolioEditor />)}
                  >
                    Add project
                  </button>
                )}
              </div>
              {!profile.projects.length && (
                <p className="job-muted">
                  Show hiring companies what your team has delivered. Add your
                  first project with photos, scope, and location.
                </p>
              )}
              <div className="job-project-grid">
                {profile.projects.slice(0, 6).map((x) => (
                  <article key={x.id}>
                    {x.image_url && <img src={x.image_url} alt="" />}
                    <h3>{x.name}</h3>
                    <small>
                      <MapPin size={13} />
                      {x.location}
                    </small>
                    <p>{x.description}</p>
                    {mine?.id === c.id && admin && (
                      <button
                        className="job-text-button"
                        onClick={() => open(<PortfolioEditor project={x} />)}
                      >
                        Edit project
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
          {updates.length > 0 && (
            <section className="jobs-panel provider-updates">
              <h2>Company updates</h2>
              {updates.map((x) => (
                <article key={x.id}>
                  <span>
                    {x.kind === "press_release" ? "PRESS RELEASE" : "UPDATE"}
                  </span>
                  <h3>{x.title || x.body.slice(0, 70)}</h3>
                  <p>{x.body.slice(0, 180)}</p>
                </article>
              ))}
            </section>
          )}
        </main>
        <aside className="jobs-aside">
          <section className="jobs-panel">
            <h2>Where we work</h2>
            <p>
              <MapPin size={16} /> Based in{" "}
              {c.location || "Location not listed"}
            </p>
            {c.service_areas.length > 0 && (
              <div className="job-service-chips">
                {c.service_areas.slice(0, 16).map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
            )}
          </section>
          {(c.availability || c.crew_size || c.capacity) && (
            <section className="jobs-panel">
              <h2>Availability & capacity</h2>
              {c.availability && (
                <div className="job-side-fact">
                  <b>Availability</b>
                  <span>{c.availability}</span>
                </div>
              )}
              {c.crew_size && (
                <div className="job-side-fact">
                  <b>Crew</b>
                  <span>{c.crew_size}</span>
                </div>
              )}
              {c.capacity && (
                <div className="job-side-fact">
                  <b>Capacity</b>
                  <span>{c.capacity}</span>
                </div>
              )}
            </section>
          )}
          <section className="jobs-panel">
            <h2>Company details</h2>
            <div className="job-side-fact">
              <b>Type</b>
              <span>{c.type}</span>
            </div>
            {c.established && (
              <div className="job-side-fact">
                <b>Founded</b>
                <span>{c.established}</span>
              </div>
            )}
            {c.website && (
              <div className="job-side-fact">
                <b>Website</b>
                <a href={c.website} target="_blank" rel="noreferrer">
                  {c.website.replace(/^https?:\/\//, "")} ↗
                </a>
              </div>
            )}
          </section>
          {(c.license_details ||
            c.insurance_details ||
            !!profile.credentials?.length) && (
            <section className="jobs-panel" id="credentials">
              <h2>Credentials & coverage</h2>
              {profile.credentials?.slice(0, 5).map((x) => (
                <div className="job-credential" key={x.id}>
                  <FileBadge size={16} />
                  <span>
                    {x.source_url ? (
                      <a href={x.source_url} target="_blank" rel="noreferrer">
                        <b>{x.title}</b>
                      </a>
                    ) : (
                      <b>{x.title}</b>
                    )}
                    <small>{x.organization}</small>
                  </span>
                </div>
              ))}
              {c.license_details && (
                <div className="job-side-fact">
                  <b>License details · company provided</b>
                  <span>{c.license_details}</span>
                </div>
              )}
              {c.insurance_details && (
                <div className="job-side-fact">
                  <b>Insurance · company provided</b>
                  <span>{c.insurance_details}</span>
                </div>
              )}
            </section>
          )}
          <section className="jobs-panel" id="company-reviews">
            <h2>Connect job reviews</h2>
            {stats && stats.reviewCount > 0 ? (
              <>
                <div className="job-rating">
                  <strong>{stats.rating.toFixed(1)}</strong>
                  <span>
                    <Star size={17} fill="currentColor" />
                    {stats.reviewCount} reviews
                  </span>
                </div>
                <p>{stats.completedJobs} completed jobs</p>
                {stats.reviews.slice(0, 3).map((x) => (
                  <div className="job-profile-review" key={x.id}>
                    <b>
                      {x.reviewer} · {x.rating}/5
                    </b>
                    <p>{x.text}</p>
                  </div>
                ))}
              </>
            ) : (
              <p className="job-muted">No Connect job reviews yet.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
