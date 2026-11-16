import { CompanyReviews } from "./reviews";
import { GoogleRating } from "./google-rating";
import { GoogleBusinessManager } from "./google-business-manager";
import "./brand/reputation.css";
import "./brand/profile-reference.css";
import "./brand/profile.css";
import { BrandIcon } from "./brand/icons";
import { recordDate } from "./profile-records";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Building2,
  Share2,
  Globe2,
  Users,
  FileBadge,
  ShieldCheck,
  ExternalLink,
  MapPin,
  Pencil,
  Star,
  Wrench,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import { projectsPath } from "./profile-projects";
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
  on_colabb?: boolean;
};
type Stats = {
  rating: number;
  reviewCount: number;
  completedJobs: number;
  distinctHirers: number;
  returningHirers: number;
  firstCompletedAt: string | null;
  milestones: { id:string; title:string; earned:boolean; earnedAt:string|null; count:number; target:number }[];
  reviews: { id: string; rating: number; text: string; reviewer: string; reviewerLogo?:string; reviewerUsername?:string; reviewerRole?:string; jobTitle?:string; created_at:string }[];
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

export function ProviderProfilePage() {
  const p = useParams(),
    [params, setParams] = useSearchParams(),
    { company: mine, admin, open, revision, refresh, toast, signIn } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const slug = p.slug || p.username || p.id;
  const [profile, setProfile] = useState<Profile | null>(null),
    [provider, setProvider] = useState<Provider | null>(null),
    [stats, setStats] = useState<Stats | null>(null),
    [updates, setUpdates] = useState<Update[]>([]);
  const [coverFailed, setCoverFailed] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const [showInvite, setShowInvite] = useState(false),
    [inviting, setInviting] = useState(false);
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([]),
    [chosen, setChosen] = useState(""),
    [error, setError] = useState("");
  const [jobsLoading, setJobsLoading] = useState(false),
    [jobsError, setJobsError] = useState("");
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
    setJobs([]);
    setChosen("");
    if (!mine || !admin) return;
    const controller = new AbortController();
    setJobsLoading(true);
    setJobsError("");
    api<{
      jobs: {
        id: string;
        title: string;
        hiring_company_id: string;
        status: string;
      }[];
    }>("/jobs/mine", { signal: controller.signal })
      .then((v) =>
        setJobs(
          v.jobs.filter(
            (j) => j.hiring_company_id === mine.id && j.status === "open",
          ),
        ),
      )
      .catch((e) => { if (!controller.signal.aborted) setJobsError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setJobsLoading(false); });
    return () => controller.abort();
  }, [mine?.id, admin]);
  useEffect(() => {
    const hash = location.hash.slice(1);
    const section = ["products", "coverage"].includes(hash) ? "services" : hash || (params.get("tab")==="reviews"?"company-reviews":"");
    setActiveSection(["overview","services","products","coverage","recent-work","credentials","company-reviews","team"].includes(section) ? section : "overview");
  }, [location.hash, location.search, slug]);
  useEffect(() => {
    if(params.get("action") === "invite" && provider && mine && admin && mine.id !== provider.id) setShowInvite(true);
  }, [params, provider?.id, mine?.id, admin]);
  const shareProfile = async () => {
    try {
      await navigator.clipboard.writeText(
        window.location.origin + "/" + (provider?.username || provider?.slug),
      );
      toast("Profile link copied");
    } catch {
      toast("Copy the profile link from your address bar.");
    }
  };
  const invite = async () => {
    if (!chosen || !provider) return;
    setInviting(true);
    try {
      await post("/jobs/" + chosen + "/invite", { companyIds: [provider.id] });
      toast("Invitation sent");
      setChosen("");
      setShowInvite(false);
      navigate(`/jobs/inbox?${new URLSearchParams({job:chosen,provider:provider.id})}`);
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
  if(showInvite) return <section className="colabb-invite-page pd-page"><button className="pd-quiet" onClick={()=>{setShowInvite(false);const next=new URLSearchParams(params);next.delete("action");setParams(next)}}><BrandIcon name="back" size={18}/>Back to {c.name}</button><p className="pd-eyebrow">START A WORKING CONVERSATION</p><h1>Invite {c.name} to a job.</h1><p>Choose the brief you want this company to respond to. Sending an invitation does not award the job.</p>{admin?<>{jobsLoading?<p role="status">Loading your open jobs…</p>:jobsError?<p role="alert">{jobsError}</p>:<><div className="colabb-invite-jobs">{jobs.map(j=><label key={j.id}><input type="radio" name="invite-job" value={j.id} checked={chosen===j.id} onChange={()=>setChosen(j.id)}/><span>{j.title}</span></label>)}</div>{jobs.length?<button className="pd-btn pd-primary" disabled={!chosen||inviting} onClick={()=>void invite()}>{inviting?"Sending…":"Send invitation"}<BrandIcon name="invite-company" size={18}/></button>:<><p>Post a job first, then invite this company to send a proposal.</p><Link className="pd-btn pd-primary" to="/jobs/new">Post a job</Link></>}</>}</>:<p>Ask a company owner or administrator to send this invitation.</p>}</section>;

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
    <div className="jobs-page provider-profile editorial-profile provider-dossier pp-page colabb-profile">
      <Link
        className="job-back"
        to={
          back
            ? "/jobs/" +
              back +
              (params.get("from") === "matches"
                ? "/matches?page=" +
                  encodeURIComponent(params.get("matchPage") || "1") +
                  "&view=" +
                  (["confirmation", "needsConfirmation"].includes(
                    params.get("matchView") || "",
                  )
                    ? "confirmation"
                    : "matches")
                : "")
            : "/providers"
        }
      >
        <ArrowLeft size={16} />
        {back
          ? params.get("from") === "matches"
            ? "Back to matches"
            : "Back to job"
          : "Find companies"}
      </Link>
      <header className="pp-identity">
        <div className="pp-identity-main"><div className="pp-logo">{c.logo_url && <img src={c.is_demo && c.logo_url.startsWith("/assets/demo-logos/") ? c.logo_url.replace(/(?<!-mark)\.svg$/, "-mark.svg") : c.logo_url} alt={`${c.name} logo`} onError={e=>{e.currentTarget.style.visibility="hidden"}}/>}</div>
          <div className="pp-identity-copy"><p className="pd-eyebrow">{c.listing_status==="unclaimed"?"PUBLIC COMPANY LISTING":"COMPANY PROFILE"}{c.is_demo?" · DEMO":""}</p><h1><span>{c.name}</span>{c.on_colabb && <Link to="/help/trust" className="pp-identity-mark" aria-label="On Colabb: managed company account"><img src="/brand/badges/on-colabb.svg" alt="" width={28} height={28}/></Link>}</h1>
          <p className="pp-tagline">{c.tagline||c.type}</p><div className="pp-meta">{c.location&&<span><BrandIcon name="location"/>{c.location}</span>}<span><BrandIcon name="company"/>{c.type}</span>{c.on_colabb&&<span>On Colabb</span>}</div></div>
        </div>
        <div className="pp-identity-actions">{owner?<Link className="pd-btn pd-primary" to="/settings/profile/overview"><BrandIcon name="edit" size={18}/>Edit profile</Link>:c.listing_status==="unclaimed"?<><a className="pd-btn" href={c.website||undefined} hidden={!c.website} target="_blank" rel="noreferrer">Visit website<BrandIcon name="open-external" size={18}/></a><Link className="pd-quiet" to={"/claim/"+(c.username||c.slug)}>Is this your company?</Link></>:mine?.id!==c.id?<button className="pd-btn pd-primary" onClick={()=>{if(!mine){const next=new URLSearchParams(params);next.set("action","invite");signIn(location.pathname+"?"+next.toString())}else setShowInvite(true)}}><BrandIcon name="invite-company" size={18}/>Invite to a job</button>:null}<button className="pd-quiet" onClick={()=>void shareProfile()}><Share2 size={16}/>Share profile</button></div>
      </header>
      <nav className="pd-tabs pp-tabs" aria-label="Company profile sections">{[["overview","Overview"],["services","Services"],["recent-work","Projects"],["credentials","Credentials"],["company-reviews","Reputation"],["team","Team"]].map(([section,label])=><a key={section} href={"#"+section} aria-current={activeSection===section?"page":undefined} onClick={()=>setActiveSection(section)}>{label}</a>)}</nav>
      <div className="provider-profile-layout">
        <div className="provider-profile-content">
          {(["overview","company-reviews"].includes(activeSection)) && <section className="profile-editorial-section pp-scorecard"><p className="pd-eyebrow">WORK ON COLABB</p><h2>A record of work together.</h2><div className="colabb-scorecard"><div><strong>{stats?.completedJobs||0}</strong><span>Completed jobs</span></div><div><strong>{stats?.returningHirers||0}</strong><span>Returning hirers</span></div><div><strong>{stats?.reviewCount ? stats.rating.toFixed(1) : "—"}</strong><span>{stats?.reviewCount||0} job reviews</span></div></div>{stats?.completedJobs ? <p className="pp-record-source">Final work accepted by the hiring company. Returning hirers have completed at least two jobs with this provider.</p>:<p className="pp-record-source">The company’s Colabb work record starts with its first completed job. Past project examples are shown separately.</p>}{stats?.milestones?.filter(m=>m.earned).map(m=><div key={m.id} className="colabb-milestone"><img src={"/brand/badges/"+({"first-job":"first-job-completed","five-jobs":"ten-jobs-completed","ten-jobs":"ten-jobs-completed","five-returning-hirers":"five-returning-hirers"}[m.id]||"first-job-completed")+".svg"} alt=""/><div><strong>{m.title}</strong><p>Milestone reached{m.earnedAt?` · ${new Date(m.earnedAt).toLocaleDateString(undefined,{month:"short",year:"numeric"})}`:""}</p></div></div>)}</section>}
          {activeSection==="team"&&<section className="profile-editorial-section"><p className="pd-eyebrow">THE PEOPLE BEHIND THE WORK</p><h2>Company team</h2>{profile.team.length?<div className="pp-people">{profile.team.map(person=><article className="pp-person" key={person.id}><span className="pp-person-avatar">{person.name.split(" ").map(n=>n[0]).slice(0,2).join("")}</span><div><h3>{person.name}</h3>{person.title&&<p>{person.title}</p>}</div></article>)}</div>:<p className="job-muted">Team details haven’t been added yet.</p>}{owner&&<Link className="pd-btn" to="/settings/profile/team"><BrandIcon name="invite" size={18}/>Manage team</Link>}</section>}

          <section
            className="profile-editorial-section"
            id="overview"
            hidden={activeSection !== "overview"}
            data-profile-section
          >
            <h2>Overview</h2>
            {c.description || c.tagline ? (
              <p className="provider-about">{c.description || c.tagline}</p>
            ) : (
              <p className="job-muted">
                {owner
                  ? "Tell companies about your team and the work you take on."
                  : `${c.name} is listed as a ${c.type.toLowerCase()}${c.location ? " based in " + c.location : ""}.`}
              </p>
            )}
            {c.capabilities && <ProviderSources data={c.capabilities} />}
          </section>
          {c.capabilities?.services.length ||
          (!c.capabilities && services.length) ? (
            <section
              className="profile-editorial-section"
              id="services"
              hidden={activeSection !== "services"}
              data-profile-section
            >
              <h2>Services</h2>
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
          ) : null}
          {activeSection==="services" && !(c.capabilities?.services.length || services.length || c.capabilities?.products.length) && <section className="profile-editorial-section pp-tab-empty"><h2>Services</h2><p>Detailed services haven’t been added yet. Contact the company to confirm the work it takes on.</p>{owner&&<Link className="pd-quiet" to="/settings/profile/services">Add services<BrandIcon name="arrow-right"/></Link>}</section>}
          {c.capabilities && activeSection==="services" && <ProviderProducts data={c.capabilities} />}
          {c.capabilities?.coverage.length || c.service_areas.length ? (
            <section
              className="profile-editorial-section"
              id="coverage"
              hidden={activeSection !== "coverage" && activeSection !== "services"}
              data-profile-section
            >
              <h2>
                {c.capabilities ? "Service & supply areas" : "Where we work"}
              </h2>
              {c.location && (
                <p className="provider-based-in">
                  <MapPin size={16} />
                  {c.location}
                </p>
              )}
              {c.capabilities?.coverage.length ? (
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
            </section>
          ) : null}

          {true && (
            <section
              className="profile-editorial-section"
              id="recent-work"
              hidden={activeSection !== "recent-work"}
              data-profile-section
            >
              <div className="profile-section-heading">
                <div>
                  <span className="editorial-label">
                    EXPERIENCE IN THE FIELD
                  </span>
                  <h2>Recent work</h2>
                </div>
                {owner && (
                  <Link
                    className="jobs-button jobs-secondary"
                    to={projectsPath + "/new"}
                  >
                    Add project <ArrowRight size={16} />
                  </Link>
                )}
              </div>
              {!profile.projects.length && (
                <p className="job-muted">
                  {owner ? "Show what your team has delivered. Add project photos, scope, and location." : "This company hasn’t added project examples yet."}
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
                      <Link
                        className="job-text-button"
                        to={projectsPath + "/" + project.id}
                      >
                        Edit project
                      </Link>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
          {activeSection==="credentials" && !(profile.licenses?.length || profile.insurance?.length || credentials.length || c.license_details || c.insurance_details) && <section className="profile-editorial-section pp-tab-empty"><h2>Credentials</h2><p>This company hasn’t added licenses, certifications or insurance details yet.</p>{owner&&<Link className="pd-quiet" to="/settings/profile/credentials">Add credentials<BrandIcon name="arrow-right"/></Link>}</section>}
          {(!!profile.licenses?.length ||
            !!profile.insurance?.length ||
            credentials.length > 0 ||
            c.license_details ||
            c.insurance_details) && (
            <section
              className="profile-editorial-section"
              id="credentials"
              hidden={activeSection !== "credentials"}
              data-profile-section
            >
              <span className="editorial-label">
                QUALIFICATIONS & COMPANY DETAILS
              </span>
              <h2>Credentials</h2>
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
                        {[
                          credential.organization,
                          credential.scope !== "company"
                            ? credential.scope_detail
                            : "",
                          credential.credential_number,
                          credential.valid_until
                            ? (credential.valid_until <
                              new Date().toLocaleDateString("en-CA")
                                ? "Expired "
                                : "Expires ") +
                              recordDate(credential.valid_until)
                            : credential.period,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="provider-credential-list">
                {profile.licenses?.map((r) => (
                  <div key={r.id}>
                    <FileBadge size={22} />
                    <div>
                      <small>License · {r.jurisdiction}</small>
                      <h3>
                        {r.license_type}
                        {r.classification ? " · " + r.classification : ""}
                      </h3>
                      <p>
                        #{r.license_number} · {r.authority}
                      </p>
                      <p>{r.holder}</p>
                      {r.expires_on && (
                        <p>
                          {r.expires_on < new Date().toLocaleDateString("en-CA")
                            ? "Expired"
                            : "Expires"}{" "}
                          {recordDate(r.expires_on)}
                        </p>
                      )}
                      {r.verification_url && (
                        <a
                          href={r.verification_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View license <ArrowUpRight size={15} />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                {profile.insurance?.map((r) => (
                  <div key={r.id}>
                    <ShieldCheck size={22} />
                    <div>
                      <small>Insurance</small>
                      <h3>{r.coverage_type}</h3>
                      <p>{r.insurer}</p>
                      {r.coverage_limit && (
                        <p>
                          {new Intl.NumberFormat(undefined, {
                            style: "currency",
                            currency: r.currency,
                            maximumFractionDigits: 0,
                          }).format(r.coverage_limit)}{" "}
                          {
                            {
                              per_occurrence: "per occurrence",
                              aggregate: "total policy limit",
                              statutory: "statutory coverage",
                              "": "",
                            }[r.limit_basis]
                          }
                        </p>
                      )}
                      <p>
                        {r.expires_on < new Date().toLocaleDateString("en-CA")
                          ? "Expired"
                          : "Expires"}{" "}
                        {recordDate(r.expires_on)}
                      </p>
                      {r.verification_url && (
                        <a
                          href={r.verification_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View coverage <ArrowUpRight size={15} />
                        </a>
                      )}
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
          <section
            className="profile-editorial-section"
            id="company-reviews"
            hidden={activeSection !== "company-reviews"}
            data-profile-section
          >
            <span className="editorial-label">WORKING TOGETHER</span>
            <h2>Colabb job reviews</h2>
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
                      <div className="colabb-reviewer">{review.reviewerLogo&&<img src={review.reviewerLogo} alt=""/>}<div>{review.reviewerUsername?<Link to={"/"+review.reviewerUsername}>{review.reviewer}</Link>:<b>{review.reviewer}</b>}<small>{review.created_at?new Date(review.created_at).toLocaleDateString():""} · Completed job</small></div></div>
                      <span>
                        <Star size={14} fill="currentColor" /> {review.rating}/5
                      </span>
                    </div>
                    {review.jobTitle&&<p className="colabb-review-job"><BrandIcon name="work" size={16}/>{review.jobTitle}</p>}<p>{review.text}</p>
                  </article>
                ))}
              </>
            ) : (
              <p className="job-muted">No Colabb job reviews yet.</p>
            )}
          </section>
          {activeSection==="company-reviews"&&<><section className="profile-editorial-section"><p className="pd-eyebrow">CUSTOMER EXPERIENCES</p><CompanyReviews target={c}/></section><section className="profile-editorial-section"><p className="pd-eyebrow">GOOGLE MAPS</p><h2>Google rating</h2><GoogleRating companyId={c.id} companyName={c.name} location={c.location||""}/>{owner&&<GoogleBusinessManager/>}</section></>}
          {updates.length > 0 && (
            <section className="profile-editorial-section provider-updates" hidden={activeSection!=="overview"}>
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
                <Link
                  className="job-text-button"
                  to="/settings/profile/coverage"
                >
                  Update availability <ArrowRight size={15} />
                </Link>
              )}
            </section>
          )}
          <section className="provider-aside-section">
            <h2>At a glance</h2>
            <dl className="provider-detail-list">
              <div>
                <dt>Business type</dt>
                <dd>{c.type}</dd>
              </div>
              {c.location && (
                <div>
                  <dt>Based in</dt>
                  <dd>{c.location}</dd>
                </div>
              )}
              {c.crew_size && (
                <div>
                  <dt>Team</dt>
                  <dd>{c.crew_size}</dd>
                </div>
              )}
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
