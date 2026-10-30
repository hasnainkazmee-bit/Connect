import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams, useNavigate, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Award,
  BriefcaseBusiness,
  Building2,
  Calendar,
  Camera,
  Check,
  ExternalLink,
  Globe,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  Share2,
  Star,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
import { Avatar, Logo } from "./identity";
import { CompanyUpdates, FollowButton, SocialStats } from "./social";
import { CompanyReviews, Stars } from "./reviews";
import {
  AchievementEditor,
  BrandEditor,
  ConfirmAction,
  EmployeeInvite,
  FormError,
  PortfolioEditor,
  ProfileEditor,
  ShareProfile,
  useAction,
} from "./management";
import type { Company, Profile } from "./types";
import "./company-profile.css";

function MemberTitle({
  member,
}: {
  member: { id: string; name: string; title: string };
}) {
  const { close, refresh } = useApp(),
    task = useAction();
  return (
    <section className="manage-dialog">
      <header className="manage-heading">
        <h2>{member.name}</h2>
        <p>Add the role people will see on your company profile.</p>
      </header>
      <form
        className="manage-form"
        onSubmit={(e) => {
          e.preventDefault();
          const title = new FormData(e.currentTarget).get("title");
          void task.run(async () => {
            await api("/team/" + member.id + "/profile", {
              method: "PATCH",
              body: JSON.stringify({ title }),
            });
            refresh();
            close();
          });
        }}
      >
        <label>
          Job title
          <input
            name="title"
            defaultValue={member.title}
            maxLength={120}
            placeholder="e.g. Head of engineering"
          />
        </label>
        <FormError error={task.error} />
        <footer className="manage-footer">
          <button className="button primary" disabled={task.busy}>
            Save title
          </button>
        </footer>
      </form>
    </section>
  );
}
const tabs = ["Updates", "About", "Portfolio", "People", "Reviews"] as const;
export function CompanyProfileView({
  controls,
  username,
}: {
  controls: (profile: Profile) => ReactNode;
  username?: string;
}) {
  const navigate = useNavigate(), location = useLocation();
  const { id } = useParams(),
    [params, setParams] = useSearchParams();
  const { company, session, admin, open, revision } = useApp();
  const [data, setData] = useState<Profile | null>(null),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false);
  const tab =
    tabs.find((t) => t.toLowerCase() === params.get("tab")) || "Updates";
  useEffect(() => {
    let cancel = false;
    setError("");
    api<Profile>("/companies/" + encodeURIComponent(username || id || ""))
      .then((d) => {
        if (!cancel) {
          setData(d);
          if (d.company.username && location.pathname !== "/" + d.company.username)
            navigate("/" + d.company.username + location.search + location.hash, { replace: true });
        }
      })
      .catch((e) => {
        if (!cancel) setError(e.message);
      });
    return () => {
      cancel = true;
    };
  }, [id, username, revision, company?.id, location.pathname, location.search, location.hash, navigate]);
  if (error)
    return (
      <div className="profile-not-found">
        <Building2 size={32} />
        <h1>We couldn’t open this profile.</h1>
        <p>{error}</p>
        <Link className="button" to="/directory">
          Explore companies
        </Link>
      </div>
    );
  if (!data)
    return (
      <div className="manage-loading">
        <LoaderCircle className="spin" />
        Loading company profile…
      </div>
    );
  const c = data.company,
    owner = company?.id === c.id,
    editable = owner && admin && !preview;
  const setTab = (value: typeof tab) =>
    setParams(value === "Updates" ? {} : { tab: value.toLowerCase() }, {
      replace: true,
    });
  const edit = (label: string, fn: () => void) =>
    editable ? (
      <button
        className="section-edit"
        aria-label={label}
        title={label}
        onClick={fn}
      >
        <Pencil size={16} />
      </button>
    ) : null;
  const achievements = (
    <section className="profile-card achievements-card">
      <div className="profile-section-heading">
        <div>
          <h2>Achievements</h2>
          <p>Awards, qualifications, and moments that matter.</p>
        </div>
        {editable && (
          <button
            className="button small"
            onClick={() => open(<AchievementEditor />)}
          >
            <Plus size={15} />
            Add
          </button>
        )}
      </div>
      {data.achievements?.length ? (
        data.achievements.map((a) => (
          <article className="achievement" key={a.id}>
            <span className="achievement-icon">
              <Award size={22} />
            </span>
            <div>
              <h3>{a.title}</h3>
              <small>{[a.issuer, a.year].filter(Boolean).join(" · ")}</small>
              {a.description && <p>{a.description}</p>}
              {a.url && (
                <a href={a.url} target="_blank" rel="noopener noreferrer">
                  View achievement
                  <ArrowUpRight size={13} />
                </a>
              )}
            </div>
            {editable && (
              <div className="entry-actions">
                <button
                  className="icon-button"
                  aria-label={"Edit " + a.title}
                  onClick={() => open(<AchievementEditor achievement={a} />)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label={"Delete " + a.title}
                  onClick={() =>
                    open(
                      <ConfirmAction
                        title="Remove this achievement?"
                        description={
                          a.title + " will no longer appear on your profile."
                        }
                        action={() =>
                          api("/companies/current/achievements/" + a.id, {
                            method: "DELETE",
                          })
                        }
                      />,
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </article>
        ))
      ) : (
        <div className="profile-empty compact">
          <Award size={26} />
          <h3>
            {editable
              ? "Give your milestones a home."
              : "Achievements coming soon."}
          </h3>
          <p>
            {editable
              ? "Add an award, certification, or a moment your team is proud of."
              : "This company hasn’t added achievements yet."}
          </p>
        </div>
      )}
    </section>
  );
  return (
    <div className="company-home">
      <div className="profile-breadcrumb">
        <Link to="/directory">
          <ArrowLeft size={14} />
          Directory
        </Link>
        {owner && admin && (
          <button aria-pressed={preview} onClick={() => setPreview(!preview)}>
            {preview ? "Back to editing" : "View as visitor"}
            <ExternalLink size={13} />
          </button>
        )}
      </div>
      <article className="company-hero">
        <div className="company-cover">
          {c.cover_url ? (
            <img src={c.cover_url} alt={c.name + " cover photo"} />
          ) : (
            <div className="company-cover-placeholder">
              <span />
              <span />
              <span />
            </div>
          )}
          {editable && (
            <button
              className="cover-edit"
              onClick={() => open(<BrandEditor target={c} slot="cover" />)}
            >
              <Camera size={16} />
              <span>Edit cover</span>
            </button>
          )}
        </div>
        <div className="company-intro">
          <div className="company-logo-wrap">
            <Logo company={c} size="large" />
            {editable && (
              <button
                aria-label="Edit company logo"
                onClick={() => open(<BrandEditor target={c} slot="logo" />)}
              >
                <Camera size={14} />
              </button>
            )}
          </div>
          <div className="company-top-actions">
            {editable ? (
              <>
                <button
                  className="button"
                  onClick={() => open(<ProfileEditor target={c} />)}
                >
                  <Pencil size={15} />
                  Edit profile
                </button>
                <button
                  className="button primary"
                  onClick={() => open(<EmployeeInvite />)}
                >
                  <UserPlus size={15} />
                  Invite employee
                </button>
              </>
            ) : (
              !owner && (
                <>
                  <FollowButton target={c} />
                  {controls(data)}
                </>
              )
            )}
            <button
              className="button icon-button"
              aria-label="Share company profile"
              title="Share profile"
              onClick={() => open(<ShareProfile target={c} />)}
            >
              <Share2 size={17} />
            </button>
          </div>
          <div className="company-name">
            <h1>{c.name}</h1>
            {c.username && <span>@{c.username}</span>}
          </div>
          <p className="company-headline">{c.tagline || c.type}</p>
          <div className="company-key-info">
            <span>
              <Building2 size={14} />
              {c.type}
            </span>
            {c.location && (
              <span>
                <MapPin size={14} />
                Based in {c.location}
              </span>
            )}
            {c.employee_count && (
              <button onClick={() => setTab("People")}>
                <Users size={14} />
                {c.employee_count} people
              </button>
            )}
            {c.website && (
              <a href={c.website} target="_blank" rel="noopener noreferrer">
                <Globe size={14} />
                {new URL(c.website).hostname}
                <ArrowUpRight size={12} />
              </a>
            )}
          </div>
          <div className="company-social-line">
            <SocialStats companyId={c.id} />
            <button
              className="profile-rating"
              onClick={() => setTab("Reviews")}
            >
              <Star
                size={14}
                fill={data.rating?.count ? "currentColor" : "none"}
              />
              {data.rating?.count ? (
                <>
                  <strong>{data.rating.average?.toFixed(1)}</strong>
                  <span>({data.rating.count} reviews)</span>
                </>
              ) : (
                <span>No reviews yet</span>
              )}
            </button>
          </div>
        </div>
        <nav className="company-sections" aria-label="Company profile sections">
          {tabs.map((t) => (
            <button
              key={t}
              aria-current={t === tab ? "page" : undefined}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Portfolio" && !!data.projects.length && (
                <small>{data.projects.length}</small>
              )}
              {t === "People" && !!data.team.length && (
                <small>{data.team.length}</small>
              )}
            </button>
          ))}
        </nav>
      </article>
      {editable && (!c.username || !c.description || !c.logo_url) && (
        <div className="profile-nudge">
          <span>
            <strong>A few details make a lasting impression.</strong>
            <small>
              {!c.username ? "Choose your company username. " : ""}
              {!c.logo_url ? "Add your logo. " : ""}
              {!c.description ? "Tell your story." : ""}
            </small>
          </span>
          <button
            onClick={() =>
              open(
                !c.logo_url && c.username && c.description ? (
                  <BrandEditor target={c} slot="logo" />
                ) : (
                  <ProfileEditor target={c} />
                ),
              )
            }
          >
            Complete profile
            <ArrowUpRight size={15} />
          </button>
        </div>
      )}
      <div
        className={"company-content " + (tab === "Updates" ? "with-rail" : "")}
      >
        {tab === "Updates" ? (
          <>
            <div>
              <CompanyUpdates target={c} preview={preview} />
            </div>
            <aside className="profile-side">
              <section className="profile-card">
                <div className="profile-section-heading">
                  <h2>At a glance</h2>
                  {edit("Edit company details", () =>
                    open(<ProfileEditor target={c} />),
                  )}
                </div>
                <p className="profile-about-short">
                  {c.description ||
                    "The people and projects behind " + c.name + "."}
                </p>
                <div className="profile-facts">
                  {c.location && (
                    <div>
                      <MapPin size={16} />
                      <span>
                        <small>Based in</small>
                        {c.location}
                      </span>
                    </div>
                  )}
                  {c.established && (
                    <div>
                      <Calendar size={16} />
                      <span>
                        <small>Founded</small>
                        {c.established}
                      </span>
                    </div>
                  )}
                  {c.service_areas.length > 0 && (
                    <div>
                      <Globe size={16} />
                      <span>
                        <small>Areas served</small>
                        {c.service_areas.join(", ")}
                      </span>
                    </div>
                  )}
                </div>
                <div className="company-service-tags">
                  {c.services.slice(0, 5).map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
                <button
                  className="profile-text-link"
                  onClick={() => setTab("About")}
                >
                  More about {c.name}
                  <ArrowUpRight size={14} />
                </button>
              </section>
              {data.projects.length > 0 && (
                <section className="profile-card featured-work">
                  <div className="profile-section-heading">
                    <h2>Featured work</h2>
                  </div>
                  {data.projects[0].image_url && (
                    <img
                      src={data.projects[0].image_url}
                      alt={data.projects[0].name}
                    />
                  )}
                  <h3>{data.projects[0].name}</h3>
                  <p>
                    {[data.projects[0].location, data.projects[0].size]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <button
                    className="profile-text-link"
                    onClick={() => setTab("Portfolio")}
                  >
                    Explore portfolio
                    <ArrowUpRight size={14} />
                  </button>
                </section>
              )}
              {!!data.rating?.count && (
                <section className="profile-card side-rating">
                  <strong>{data.rating.average?.toFixed(1)}</strong>
                  <Stars value={data.rating.average || 0} />
                  <button onClick={() => setTab("Reviews")}>
                    {data.rating.count} customer reviews
                    <ArrowUpRight size={13} />
                  </button>
                </section>
              )}
            </aside>
          </>
        ) : tab === "About" ? (
          <div className="about-sections">
            <section className="profile-card about-main">
              <div className="profile-section-heading">
                <h2>About {c.name}</h2>
                {edit("Edit about", () => open(<ProfileEditor target={c} />))}
              </div>
              <p className="profile-about-full">
                {c.description ||
                  "This company is still writing its introduction."}
              </p>
              <dl className="profile-details">
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
                {c.employee_count && (
                  <div>
                    <dt>Company size</dt>
                    <dd>{c.employee_count} people</dd>
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
                      <a
                        href={c.website}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {new URL(c.website).hostname}
                        <ArrowUpRight size={12} />
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
              <h3>What we do</h3>
              <div className="company-service-tags">
                {c.services.length ? (
                  c.services.map((s) => <span key={s}>{s}</span>)
                ) : (
                  <p className="muted">Services haven’t been added yet.</p>
                )}
              </div>
              <h3>Where we work</h3>
              <div className="company-service-tags">
                {c.service_areas.length ? (
                  c.service_areas.map((s) => <span key={s}>{s}</span>)
                ) : (
                  <p className="muted">Contact us about your location.</p>
                )}
              </div>
            </section>
            {achievements}
          </div>
        ) : tab === "Portfolio" ? (
          <section className="profile-card portfolio-section">
            <div className="profile-section-heading">
              <div>
                <h2>Work worth sharing.</h2>
                <p>Explore the projects behind {c.name}.</p>
              </div>
              {editable && (
                <button
                  className="button primary"
                  onClick={() => open(<PortfolioEditor />)}
                >
                  <Plus size={16} />
                  Add project
                </button>
              )}
            </div>
            {data.projects.length ? (
              <div className="portfolio-grid">
                {data.projects.map((p) => (
                  <article key={p.id}>
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} loading="lazy" />
                    ) : (
                      <div className="project-placeholder">
                        <BriefcaseBusiness size={30} />
                      </div>
                    )}
                    <div>
                      <small>
                        {[p.location, p.completed_year]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                      <h3>{p.name}</h3>
                      {p.size && (
                        <span className="project-capacity">{p.size}</span>
                      )}
                      <p>{p.description}</p>
                      <footer>
                        {p.url && (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Explore project
                            <ArrowUpRight size={13} />
                          </a>
                        )}
                        {editable && (
                          <>
                            <button
                              aria-label={"Edit " + p.name}
                              onClick={() =>
                                open(<PortfolioEditor project={p} />)
                              }
                            >
                              <Pencil size={14} />
                              Edit
                            </button>
                            <button
                              aria-label={"Delete " + p.name}
                              onClick={() =>
                                open(
                                  <ConfirmAction
                                    title="Remove this project?"
                                    description={
                                      p.name +
                                      " will no longer appear in your portfolio."
                                    }
                                    action={() =>
                                      api(
                                        "/companies/current/portfolio/" + p.id,
                                        { method: "DELETE" },
                                      )
                                    }
                                  />,
                                )
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </footer>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="profile-empty">
                <BriefcaseBusiness size={30} />
                <h3>
                  {editable
                    ? "Your next introduction is your work."
                    : "Projects coming soon."}
                </h3>
                <p>
                  {editable
                    ? "Add photos and a few details from a project you’re proud of."
                    : "This company hasn’t shared its portfolio yet."}
                </p>
                {editable && (
                  <button
                    className="button"
                    onClick={() => open(<PortfolioEditor />)}
                  >
                    Add your first project
                    <Plus size={15} />
                  </button>
                )}
              </div>
            )}
          </section>
        ) : tab === "People" ? (
          <section className="profile-card">
            <div className="profile-section-heading">
              <div>
                <h2>The people behind {c.name}</h2>
                <p>A shared purpose. A team of their own.</p>
              </div>
              {editable && (
                <button
                  className="button primary"
                  onClick={() => open(<EmployeeInvite />)}
                >
                  <UserPlus size={16} />
                  Invite employee
                </button>
              )}
            </div>
            <div className="company-people">
              {data.team.map((m) => (
                <article key={m.id}>
                  <Avatar name={m.name} />
                  <div>
                    <h3>{m.name}</h3>
                    <p>{m.title || "Team member"}</p>
                  </div>
                  {(editable ||
                    (owner && !preview && m.id === session.user?.id)) && (
                    <button
                      className="icon-button"
                      aria-label={"Edit title for " + m.name}
                      onClick={() => open(<MemberTitle member={m} />)}
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                </article>
              ))}
            </div>
            {!data.team.length && (
              <div className="profile-empty">
                <Users size={28} />
                <h3>Meet the team soon.</h3>
                <p>
                  People will appear here as this company invites employees.
                </p>
              </div>
            )}
            {editable && (
              <Link className="profile-text-link" to="/settings">
                Manage employee access
                <ArrowUpRight size={15} />
              </Link>
            )}
          </section>
        ) : (
          <section className="profile-card">
            <CompanyReviews target={c} />
          </section>
        )}
      </div>
    </div>
  );
}
