import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Globe2,
  Users,
  FileBadge,
  ExternalLink,
  MapPin,
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
import type { Company, Profile, Project } from "./types";
import {
  ProviderServices,
  ProviderProducts,
  ProviderCoverage,
  ProviderSources,
  type ProviderCapabilities,
} from "./provider-capabilities";

type Provider = Company & {
  trades: string[];
  project_types: string[];
  availability: string;
  crew_size: string;
  capacity: string;
  license_details: string;
  insurance_details: string;
  capabilities?: ProviderCapabilities | null;
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
  const [coverFailed, setCoverFailed] = useState(false);
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
    setCoverFailed(false);
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
  const owner = mine?.id === c.id && admin;
  const cover =
    c.cover_url &&
    (c.is_demo ||
      !["/assets/solar.jpg", "/assets/office.jpg"].includes(c.cover_url))
      ? c.cover_url
      : "";
  const services = c.trades.length ? c.trades : c.services;
  const credentials = profile.credentials || [];
  const credentialLabel = {
    certification: "Certification",
    qualification: "Qualification",
    ranking: "Industry ranking",
    directory: "Directory listing",
    membership: "Membership",
  };
  return (
    <div className="jobs-page provider-profile editorial-profile">
      <Link className="job-back" to={back ? "/jobs/" + back : "/providers"}>
        <ArrowLeft size={16} />
        {back ? "Back to job" : "Find companies"}
      </Link>
      <header
        className={`provider-profile-hero ${cover && !coverFailed ? "has-cover" : ""}`}
      >
        <div className="provider-hero-copy">
          <div className="provider-identity-row">
            <div
              className={`provider-profile-logo ${c.is_demo ? "is-demo" : ""}`}
            >
              {c.logo_url && (
                <img
                  src={
                    c.is_demo && c.logo_url.startsWith("/assets/demo-logos/")
                      ? c.logo_url.replace(/\.svg$/, "-mark.svg")
                      : c.logo_url
                  }
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.visibility = "hidden";
                  }}
                />
              )}
            </div>
            <span className="provider-overline">
              {c.type}
              {c.is_demo
                ? " · Demo company"
                : c.listing_status === "unclaimed"
                  ? " · Public listing"
                  : ""}
            </span>
          </div>
          <div className="provider-profile-heading">
            <h1>{c.name}</h1>
            {c.tagline && <p>{c.tagline}</p>}
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
                        admin && (
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
        </div>
        {cover && !coverFailed && (
          <figure className="provider-cover">
            <img
              src={cover}
              alt={`${c.name} company cover`}
              onError={() => setCoverFailed(true)}
            />
            <figcaption>
              <span>
                {c.is_demo
                  ? "Illustrative image · Demo company"
                  : "Company cover"}
              </span>
            </figcaption>
          </figure>
        )}
      </header>
      <dl className="provider-fact-band">
        {c.location && (
          <div>
            <dt>
              <MapPin size={16} /> Based in
            </dt>
            <dd>{c.location}</dd>
          </div>
        )}
        {c.service_areas.length > 0 && (
          <div>
            <dt>
              <Globe2 size={16} />{" "}
              {c.capabilities ? "Coverage" : "Working across"}
            </dt>
            <dd>
              {c.service_areas.slice(0, 2).join(" · ")}
              {c.service_areas.length > 2 && (
                <a href="#coverage"> +{c.service_areas.length - 2} areas</a>
              )}
            </dd>
          </div>
        )}
        {c.crew_size && (
          <div>
            <dt>
              <Users size={16} /> Team
            </dt>
            <dd>{c.crew_size}</dd>
          </div>
        )}
        {c.established && (
          <div>
            <dt>
              <CalendarDays size={16} /> Established
            </dt>
            <dd>{c.established}</dd>
          </div>
        )}
      </dl>
      <nav
        className="provider-profile-nav"
        aria-label="Company profile sections"
      >
        <a href="#overview">Overview</a>
        {!!c.capabilities?.products.length && (
          <a href="#products">Products & equipment</a>
        )}
        {(profile.projects.length > 0 || owner) && (
          <a href="#recent-work">
            Recent work <span>{profile.projects.length}</span>
          </a>
        )}
        {!!credentials.length && (
          <a href="#credentials">
            Credentials <span>{credentials.length}</span>
          </a>
        )}
        <a href="#company-reviews">
          Reviews
          {stats && stats.reviewCount > 0 && <span>{stats.reviewCount}</span>}
        </a>
      </nav>
      <div className="provider-profile-layout">
        <div className="provider-profile-content">
          <section className="profile-editorial-section" id="overview">
            <span className="editorial-label">THE COMPANY</span>
            <h2>What we do.</h2>
            {c.description || c.tagline ? (
              <p className="provider-about">{c.description || c.tagline}</p>
            ) : (
              <p className="job-muted">
                {owner
                  ? "Tell companies about your team and the work you take on."
                  : `${c.name} is listed as a ${c.type.toLowerCase()}${c.location ? " based in " + c.location : ""}.`}
              </p>
            )}
            {c.capabilities ? (
              <ProviderServices data={c.capabilities} />
            ) : (
              services.length > 0 && (
                <div className="provider-service-list" aria-label="Services">
                  {services.map((service, i) => (
                    <div key={service}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <h3>{service}</h3>
                    </div>
                  ))}
                </div>
              )
            )}
            {c.project_types.length > 0 && (
              <div className="provider-project-types">
                <span>Project types</span>
                <p>{c.project_types.join(" · ")}</p>
              </div>
            )}
          </section>
          {c.capabilities && <ProviderProducts data={c.capabilities} />}
          {(profile.projects.length > 0 || owner) && (
            <section className="profile-editorial-section" id="recent-work">
              <div className="profile-section-heading">
                <div>
                  <span className="editorial-label">
                    EXPERIENCE IN THE FIELD
                  </span>
                  <h2>Recent work.</h2>
                </div>
                {owner && (
                  <button
                    className="jobs-button jobs-secondary"
                    onClick={() => open(<PortfolioEditor />)}
                  >
                    Add project <ArrowRight size={16} />
                  </button>
                )}
              </div>
              {!profile.projects.length && (
                <p className="job-muted">
                  Show what your team has delivered. Add project photos, scope,
                  and location.
                </p>
              )}
              <div className="provider-work-grid">
                {profile.projects.map((project) => (
                  <article
                    key={project.id}
                    className={project.image_url ? "" : "project-without-image"}
                  >
                    <button
                      className="provider-project-open"
                      onClick={() =>
                        open(
                          <ProviderProject
                            project={project}
                            demo={!!c.is_demo}
                          />,
                        )
                      }
                      aria-label={`View project: ${project.name}`}
                    >
                      {project.image_url && (
                        <div className="provider-project-photo">
                          <img
                            src={project.image_url}
                            alt={project.name}
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.parentElement!.style.display =
                                "none";
                            }}
                          />
                          <span>
                            <ArrowUpRight size={20} />
                          </span>
                        </div>
                      )}
                      <span className="provider-project-caption">
                        <small>
                          {[
                            project.location,
                            project.size,
                            project.completed_year,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                        <strong>{project.name}</strong>
                        <span>{project.description}</span>
                        {!project.image_url && (
                          <span className="project-open-link">
                            View project <ArrowRight size={16} />
                          </span>
                        )}
                      </span>
                    </button>
                    {owner && (
                      <button
                        className="job-text-button"
                        onClick={() =>
                          open(<PortfolioEditor project={project} />)
                        }
                      >
                        Edit project
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
          {(credentials.length > 0 ||
            c.license_details ||
            c.insurance_details) && (
            <section className="profile-editorial-section" id="credentials">
              <span className="editorial-label">
                QUALIFICATIONS & COMPANY DETAILS
              </span>
              <h2>Credentials.</h2>
              <div className="provider-credential-list">
                {credentials.map((credential) => (
                  <div key={credential.id}>
                    <FileBadge size={22} />
                    <div>
                      <small>{credentialLabel[credential.category]}</small>
                      {credential.source_url ? (
                        <a
                          href={credential.source_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <h3>{credential.title}</h3>
                          <ArrowUpRight size={16} />
                        </a>
                      ) : (
                        <h3>{credential.title}</h3>
                      )}
                      <p>
                        {[credential.organization, credential.period]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {c.license_details && (
                <div className="profile-detail-row">
                  <b>License details</b>
                  <p>{c.license_details}</p>
                </div>
              )}
              {c.insurance_details && (
                <div className="profile-detail-row">
                  <b>Insurance</b>
                  <p>{c.insurance_details}</p>
                </div>
              )}
            </section>
          )}
          <section className="profile-editorial-section" id="company-reviews">
            <span className="editorial-label">WORKING TOGETHER</span>
            <h2>Connect job reviews.</h2>
            {stats && stats.reviewCount > 0 ? (
              <>
                <div className="provider-review-summary">
                  <strong>{stats.rating.toFixed(1)}</strong>
                  <div>
                    <Star size={20} fill="currentColor" />
                    <span>
                      {stats.reviewCount} reviews · {stats.completedJobs}{" "}
                      completed jobs
                    </span>
                  </div>
                </div>
                {stats.reviews.map((review) => (
                  <article className="provider-review" key={review.id}>
                    <div>
                      <b>{review.reviewer}</b>
                      <span>
                        <Star size={14} fill="currentColor" /> {review.rating}/5
                      </span>
                    </div>
                    <p>{review.text}</p>
                  </article>
                ))}
              </>
            ) : (
              <p className="job-muted">No Connect job reviews yet.</p>
            )}
          </section>
          {updates.length > 0 && (
            <section className="profile-editorial-section provider-updates">
              <span className="editorial-label">FROM THE COMPANY</span>
              <h2>Latest updates.</h2>
              {updates.map((update) => (
                <article key={update.id}>
                  <span>
                    {update.kind === "press_release"
                      ? "PRESS RELEASE"
                      : "UPDATE"}{" "}
                    ·{" "}
                    {new Date(update.published_at).toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric", year: "numeric" },
                    )}
                  </span>
                  <h3>{update.title || update.body.slice(0, 70)}</h3>
                  <p>{update.body.slice(0, 240)}</p>
                </article>
              ))}
            </section>
          )}
        </div>
        <aside className="provider-company-aside">
          {(c.availability || c.capacity) && (
            <section className="provider-capacity">
              <span className="editorial-label">LET’S GET TO WORK</span>
              <h2>{c.availability || "Team capacity"}</h2>
              {c.capacity && <p>{c.capacity}</p>}
              {owner && (
                <button
                  className="job-text-button"
                  onClick={() =>
                    open(<WorkDetailsEditor provider={c} onSaved={refresh} />)
                  }
                >
                  Update availability <ArrowRight size={15} />
                </button>
              )}
            </section>
          )}
          <section className="provider-aside-section" id="coverage">
            <h2>
              {c.capabilities ? "Service & supply areas" : "Where we work"}
            </h2>
            {c.location && (
              <p className="provider-based-in">
                <MapPin size={16} />
                {c.location}
              </p>
            )}
            {c.capabilities ? (
              <ProviderCoverage data={c.capabilities} />
            ) : (
              c.service_areas.length > 0 && (
                <div className="provider-area-list">
                  {c.service_areas.map((area) => (
                    <span key={area}>{area}</span>
                  ))}
                </div>
              )
            )}
            {c.capabilities && <ProviderSources data={c.capabilities} />}
          </section>
          <section className="provider-aside-section">
            <h2>Company details</h2>
            <dl className="provider-detail-list">
              <div>
                <dt>Business type</dt>
                <dd>{c.type}</dd>
              </div>
              {c.employee_count && (
                <div>
                  <dt>Company size</dt>
                  <dd>{c.employee_count}</dd>
                </div>
              )}
              {c.established && (
                <div>
                  <dt>Founded</dt>
                  <dd>{c.established}</dd>
                </div>
              )}
              {c.website && (
                <div>
                  <dt>Website</dt>
                  <dd>
                    <a href={c.website} target="_blank" rel="noreferrer">
                      {c.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}{" "}
                      <ArrowUpRight size={15} />
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </section>
          {c.listing_status === "unclaimed" && (
            <div className="provider-claim-note">
              <h3>Make this profile yours.</h3>
              <p>
                Manage your company details, showcase your work, and receive job
                invitations.
              </p>
              <Link to={"/claim/" + (c.username || c.slug)}>
                Claim company profile <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function ProviderProject({
  project,
  demo,
}: {
  project: Project;
  demo: boolean;
}) {
  return (
    <section className="manage-dialog provider-project-dialog">
      {project.image_url && <img src={project.image_url} alt={project.name} />}
      <div>
        <span className="editorial-label">
          {demo ? "ILLUSTRATIVE DEMO PROJECT" : "COMPANY PROJECT"}
        </span>
        <h2>{project.name}</h2>
        <p className="provider-project-location">
          {[project.location, project.size, project.completed_year]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p>{project.description}</p>
        {project.url && (
          <a
            className="jobs-button jobs-secondary"
            href={project.url}
            target="_blank"
            rel="noreferrer"
          >
            Project website <ArrowUpRight size={16} />
          </a>
        )}
      </div>
    </section>
  );
}
