import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Navigate,
  useParams,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowUpRight,
  Building2,
  Check,
  FileBadge,
  ImagePlus,
  MapPin,
  Plus,
  Users,
  Wrench,
  BriefcaseBusiness,
} from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
import { Logo } from "./identity";
import {
  AchievementEditor,
  BrandEditor,
  FormError,
  TagInput,
  TeamManager,
  UsernameField,
  useUnsavedChanges,
} from "./management";
import { ProfileRecords } from "./profile-records";
import { ProfileProjects } from "./profile-projects";
import type { Company, Profile, Session, WorkSettings } from "./types";

type Work = {
  work_settings?: WorkSettings | null;
  trades: string[];
  project_types: string[];
  availability: string;
  crew_size: string;
  capacity: string;
  license_details: string;
  insurance_details: string;
};
type Provider = Company & Work;
const sections = [
  { id: "overview", title: "Company information", icon: Building2 },
  { id: "services", title: "Services & project types", icon: Wrench },
  { id: "coverage", title: "Areas & availability", icon: MapPin },
  { id: "photos", title: "Logo & cover photo", icon: ImagePlus },
  { id: "credentials", title: "Licenses & certifications", icon: FileBadge },
  { id: "portfolio", title: "Projects", icon: BriefcaseBusiness },
  { id: "team", title: "Your team", icon: Users },
];
const profilePath = (c: Company) => "/" + (c.username || c.slug);
export function CompanyProfileEditorPage() {
  const { company, admin, revision, open, refresh } = useApp();
  const { section = "overview", "*": subpage = "" } = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [data, setData] = useState<{
    profile: Profile;
    provider: Provider;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!company) return;
    let active = true;
    setError("");
    Promise.all([
      api<Profile>("/companies/" + company.id),
      api<{ provider: Provider }>("/jobs/providers/" + company.id),
    ])
      .then(([profile, p]) => {
        if (active) setData({ profile, provider: p.provider });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [company?.id, revision]);
  if (!company) return null;
  if (!admin)
    return (
      <div className="profile-workspace">
        <h1>Your company profile</h1>
        <p>
          Ask your company owner or an administrator to update this profile.
        </p>
        <Link className="button" to={profilePath(company)}>
          View company profile
        </Link>
      </div>
    );
  if (!sections.some((s) => s.id === section))
    return <Navigate to="/settings/profile/overview" replace />;
  if (error && !data)
    return (
      <div className="profile-workspace">
        <FormError error={error} />
        <button className="button" onClick={refresh}>
          Try again
        </button>
      </div>
    );
  if (!data || data.provider.id !== company.id)
    return (
      <div className="profile-workspace" role="status">
        Loading your company profile…
      </div>
    );
  const c = data.provider;
  const complete: Record<string, boolean> = {
    overview: !!(c.description && c.tagline && c.website),
    services: !!(c.services.length && c.project_types.length),
    coverage: !!(c.location && c.service_areas.length),
    photos: !!c.logo_url,
    credentials: !!(
      data.profile.licenses?.length ||
      data.profile.insurance?.length ||
      c.license_details ||
      data.profile.credentials?.length ||
      data.profile.achievements.length
    ),
    portfolio: data.profile.projects.length > 0,
    team: data.profile.team.length > 1,
  };
  return (
    <div className="profile-workspace">
      <header className="profile-workspace-heading">
        <div>
          <h1>Edit company profile</h1>
          <p>Manage the details customers see about your company.</p>
        </div>
        <Link className="button" to={profilePath(c)}>
          View public profile <ArrowUpRight size={18} />
        </Link>
      </header>
      {search.get("claimed") === "1" && (
        <div className="claim-complete-banner" role="status">
          <Check size={22} />
          <div>
            <strong>You now manage {c.name}.</strong>
            <p>
              Your existing information is here. Start by checking your company
              details, services, and areas served.
            </p>
          </div>
        </div>
      )}
      <div className="profile-workspace-layout">
        <aside className="profile-workspace-sidebar">
          <div className="workspace-company">
            <Logo company={c} />
            <div>
              <strong>{c.name}</strong>
              <span>{c.location || c.type}</span>
            </div>
          </div>
          <label className="workspace-mobile-sections">
            Edit section
            <select
              value={section}
              onChange={(e) => navigate("/settings/profile/" + e.target.value)}
            >
              {sections.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <nav aria-label="Profile sections">
            {sections.map(({ id, title, icon: Icon }) => (
              <NavLink
                key={id}
                to={"/settings/profile/" + id}
                className={({ isActive }) =>
                  isActive || (id === "overview" && section === "overview")
                    ? "active"
                    : ""
                }
              >
                <Icon size={20} />
                <span>{title}</span>
                {complete[id] && (
                  <Check
                    className="section-complete"
                    size={15}
                    aria-label="Details added"
                  />
                )}
              </NavLink>
            ))}
          </nav>
          <p className="workspace-side-note">
            Save each section when you’re ready. You can come back anytime.
          </p>
        </aside>
        <section className="profile-workspace-main">
          <FormError error={error} />
          {["overview", "services", "coverage"].includes(section) && (
            <ProfileSectionForm
              key={c.id + section}
              provider={c}
              section={section}
            />
          )}
          {section === "photos" && (
            <>
              <SectionHeading title="Logo & cover photo">
                Make your company easy to recognize. You can position and crop
                each image before saving.
              </SectionHeading>
              <div className="workspace-photo-grid">
                {(["logo", "cover"] as const).map((slot) => (
                  <section
                    className={"workspace-photo-card " + slot}
                    key={slot}
                  >
                    <div className="workspace-photo-preview">
                      {c[slot === "logo" ? "logo_url" : "cover_url"] &&
                      c[slot === "logo" ? "logo_url" : "cover_url"] !==
                        "/assets/solar.jpg" ? (
                        <img
                          src={c[slot === "logo" ? "logo_url" : "cover_url"]}
                          alt={
                            slot === "logo"
                              ? "Current company logo"
                              : "Current company cover"
                          }
                        />
                      ) : (
                        <ImagePlus size={34} />
                      )}
                    </div>
                    <h3>{slot === "logo" ? "Company logo" : "Cover photo"}</h3>
                    <p>
                      {slot === "logo"
                        ? "A square logo works best."
                        : "A photo of your team or completed work."}
                    </p>
                    <button
                      className="button"
                      onClick={() =>
                        open(<BrandEditor target={c} slot={slot} />)
                      }
                    >
                      <ImagePlus size={18} />
                      {slot === "logo" ? "Change logo" : "Change cover photo"}
                    </button>
                  </section>
                ))}
              </div>
            </>
          )}
          {section === "portfolio" && (
            <ProfileProjects
              projects={data.profile.projects}
              company={c}
              path={subpage}
            />
          )}
          {section === "credentials" && (
            <div className="workspace-records">
              <ProfileRecords
                profile={data.profile}
                company={c}
                legacyLicense={c.license_details}
                legacyInsurance={c.insurance_details}
              />
              <SectionHeading
                title="Achievements"
                action={
                  <button
                    className="button"
                    onClick={() => open(<AchievementEditor />)}
                  >
                    <Plus size={17} />
                    Add achievement
                  </button>
                }
              >
                Add awards and company milestones.
              </SectionHeading>
              {data.profile.achievements.map((a) => (
                <div className="workspace-record" key={a.id}>
                  <FileBadge size={20} />
                  <div>
                    <strong>{a.title}</strong>
                    <p>{[a.issuer, a.year].filter(Boolean).join(" · ")}</p>
                  </div>
                  <button
                    className="button"
                    onClick={() => open(<AchievementEditor achievement={a} />)}
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}
          {section === "team" && (
            <>
              <SectionHeading title="Your team">
                Invite employees to help manage this company. Everyone uses
                their own login.
              </SectionHeading>
              <TeamManager />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
function SectionHeading({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="workspace-section-heading">
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
      {action}
    </header>
  );
}
function profileForm(c: Provider) {
  return {
    expectedCompanyId: c.id,
    name: c.name,
    username: c.username || "",
    tagline: c.tagline,
    description: c.description,
    type: c.type,
    location: c.location,
    services: c.services || [],
    service_areas: c.service_areas || [],
    audiences: c.audiences || [],
    phone: c.phone || "",
    website: c.website || "",
    employee_count: c.employee_count || "",
    established: c.established || null,
    workDetails: {
      trades: c.trades || [],
      projectTypes: c.project_types || [],
      availability: c.availability || "",
      crewSize: c.crew_size || "",
      capacity: c.capacity || "",
      licenseDetails: c.license_details || "",
      insuranceDetails: c.insurance_details || "",
      settings: c.work_settings || undefined,
    },
  };
}
function ProfileSectionForm({
  provider,
  section,
}: {
  provider: Provider;
  section: string;
}) {
  const { refresh, setSession } = useApp();
  const [form, setForm] = useState(() => profileForm(provider));
  const [saved, setSaved] = useState(() =>
    JSON.stringify(profileForm(provider)),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(false);
  const dirty = JSON.stringify(form) !== saved;
  useUnsavedChanges(dirty, busy);
  const update = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSuccess(false);
  };
  const work = <K extends keyof typeof form.workDetails>(
    key: K,
    value: (typeof form.workDetails)[K],
  ) => {
    setForm((f) => ({ ...f, workDetails: { ...f.workDetails, [key]: value } }));
    setSuccess(false);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/companies/current/profile", {
        method: "PATCH",
        body: JSON.stringify({ ...form, username: form.username || undefined }),
      });
      setSaved(JSON.stringify(form));
      setSuccess(true);
      refresh();
      try {
        setSession(await api<Session>("/session"));
      } catch {
        /* Profile has already been saved; session refresh retries independently. */
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="workspace-form" onSubmit={save}>
      {section === "overview" && (
        <>
          <SectionHeading title="Company information">
            Introduce your company in your own words. These details appear on
            your public profile.
          </SectionHeading>
          <label>
            Company name
            <input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              required
              minLength={2}
              maxLength={120}
              autoComplete="organization"
            />
          </label>
          <div className="workspace-field-pair">
            <label>
              Business type
              <select
                value={form.type}
                onChange={(e) => update("type", e.target.value)}
              >
                {[
                  "Installer",
                  "EPC",
                  "Contractor",
                  "Developer",
                  "Distributor",
                  "Manufacturer",
                  "Service provider",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Company size
              <select
                value={form.employee_count}
                onChange={(e) => update("employee_count", e.target.value)}
              >
                <option value="">Select company size</option>
                {[
                  "1–10",
                  "11–50",
                  "51–200",
                  "201–500",
                  "501–1,000",
                  "1,000+",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Short introduction
            <input
              value={form.tagline}
              maxLength={200}
              onChange={(e) => update("tagline", e.target.value)}
              placeholder="e.g. Commercial solar installation and electrical services"
            />
            <small>A sentence customers see beside your company name.</small>
          </label>
          <label>
            Company overview
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              maxLength={3000}
              rows={7}
              placeholder="Describe the work you do, who you help, and your experience."
            />
            <small>
              {form.description.length.toLocaleString()} / 3,000 characters
            </small>
          </label>
          <div className="workspace-field-pair">
            <label>
              Website
              <input
                type="url"
                value={form.website}
                onChange={(e) => update("website", e.target.value)}
                placeholder="https://yourcompany.com"
                maxLength={2000}
              />
            </label>
            <label>
              Business phone
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                maxLength={40}
                autoComplete="tel"
              />
            </label>
          </div>
          <label>
            <span className="workspace-label">
              Year founded <small>Optional</small>
            </span>
            <input
              type="number"
              min={1800}
              max={new Date().getFullYear()}
              value={form.established || ""}
              onChange={(e) =>
                update(
                  "established",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            />
          </label>
          <UsernameField
            value={form.username}
            current={provider.username}
            onChange={(v) => update("username", v)}
          />
        </>
      )}
      {section === "services" && (
        <>
          <SectionHeading title="Services & project types">
            Help customers find you for the right work. Choose the services you
            offer and add any that are missing.
          </SectionHeading>
          <TagInput
            label="Services you offer"
            values={form.services}
            onChange={(v) => update("services", v)}
            placeholder="e.g. Battery installation"
            suggestions={[
              "Solar installation",
              "Electrical services",
              "Battery storage",
              "Roofing",
              "Solar design",
              "Solar repairs & maintenance",
              "Equipment supply",
            ]}
          />
          <TagInput
            label="Project types"
            values={form.workDetails.projectTypes}
            onChange={(v) => work("projectTypes", v)}
            maxItems={12}
            maxLength={80}
            placeholder="e.g. Commercial rooftops"
            suggestions={[
              "Residential solar",
              "Commercial solar",
              "Industrial solar",
              "Utility-scale solar",
              "Battery storage",
              "EV charging",
            ]}
          />
          <TagInput
            label="Types of work"
            values={form.workDetails.trades}
            onChange={(v) => work("trades", v)}
            maxItems={12}
            maxLength={80}
            placeholder="Add a type of work"
            suggestions={[
              "Installation",
              "Electrical",
              "Roofing",
              "Design",
              "Engineering",
              "Service",
              "Equipment supply",
            ]}
          />
          <fieldset className="workspace-options">
            <legend>Customers you work with</legend>
            {["Residential", "Commercial", "Utility-scale"].map((v) => (
              <label key={v}>
                <input
                  type="checkbox"
                  checked={form.audiences.includes(v)}
                  onChange={(e) =>
                    update(
                      "audiences",
                      e.target.checked
                        ? [...form.audiences, v]
                        : form.audiences.filter((x) => x !== v),
                    )
                  }
                />
                {v}
              </label>
            ))}
          </fieldset>
        </>
      )}
      {section === "coverage" && (
        <>
          <SectionHeading title="Areas & availability">
            Let customers know where you work and when you can take on a job.
          </SectionHeading>
          <label>
            Based in
            <input
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
              maxLength={160}
              placeholder="City, state"
            />
          </label>
          <TagInput
            label="Areas you serve"
            values={form.service_areas}
            onChange={(v) => update("service_areas", v)}
            placeholder="Add a city, state, or region"
          />
          <WorkSettingsFields
            value={form.workDetails.settings}
            legacy={provider}
            onChange={(v) => work("settings", v)}
          />
        </>
      )}
      <FormError error={error} />
      <footer className="workspace-save-bar">
        <span role="status">
          {busy ? (
            "Saving your changes…"
          ) : dirty ? (
            "You have unsaved changes"
          ) : success ? (
            <>
              <Check size={18} />
              Changes saved
            </>
          ) : (
            "Your saved information is shown above"
          )}
        </span>
        <button
          className="button primary"
          disabled={!dirty || busy}
          type="submit"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </footer>
    </form>
  );
}

const emptySettings: WorkSettings = {
  availability: "",
  availableFrom: null,
  crewCount: null,
  peoplePerCrew: null,
  capacityQuantity: null,
  capacityUnit: "projects",
  capacityPeriod: "month",
};
function WorkSettingsFields({
  value,
  legacy,
  onChange,
}: {
  value?: WorkSettings;
  legacy: Work;
  onChange: (v: WorkSettings) => void;
}) {
  const v = value || emptySettings;
  const set = (changes: Partial<WorkSettings>) =>
    onChange({ ...v, ...changes });
  return (
    <>
      {!value &&
        (legacy.availability || legacy.crew_size || legacy.capacity) && (
          <div className="record-legacy">
            <strong>Current availability & team information</strong>
            <p>
              {[legacy.availability, legacy.crew_size, legacy.capacity]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <small>
              Use the fields below to replace this with your current details.
            </small>
          </div>
        )}
      <div className="workspace-field-pair">
        <label>
          Availability
          <select
            value={v.availability}
            onChange={(e) =>
              set({
                availability: e.target.value as WorkSettings["availability"],
                availableFrom:
                  e.target.value === "from_date" ? v.availableFrom : null,
              })
            }
          >
            <option value="">Not specified</option>
            <option value="accepting">Accepting new work</option>
            <option value="from_date">Available from a date</option>
            <option value="limited">Limited availability</option>
            <option value="unavailable">Not taking new work</option>
          </select>
        </label>
        {v.availability === "from_date" && (
          <label>
            Available from
            <input
              type="date"
              required
              value={v.availableFrom || ""}
              onChange={(e) => set({ availableFrom: e.target.value || null })}
            />
          </label>
        )}
      </div>
      <div className="workspace-field-pair">
        <label>
          <span className="workspace-label">
            Number of crews <small>Optional</small>
          </span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="10000"
            step="1"
            value={v.crewCount ?? ""}
            onChange={(e) =>
              set({ crewCount: e.target.value ? Number(e.target.value) : null })
            }
          />
        </label>
        <label>
          <span className="workspace-label">
            People per crew <small>Optional</small>
          </span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="1000"
            step="1"
            value={v.peoplePerCrew ?? ""}
            onChange={(e) =>
              set({
                peoplePerCrew: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </label>
      </div>
      <fieldset className="capacity-fields">
        <legend>
          Work capacity <small>Optional</small>
        </legend>
        <div className="workspace-field-triple">
          <label>
            Up to
            <input
              type="number"
              inputMode="decimal"
              min={["kW", "MW"].includes(v.capacityUnit) ? "0.01" : "1"}
              max="100000000"
              step={["kW", "MW"].includes(v.capacityUnit) ? "0.01" : "1"}
              value={v.capacityQuantity ?? ""}
              onChange={(e) =>
                set({
                  capacityQuantity: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
            />
          </label>
          <label>
            Unit
            <select
              value={v.capacityUnit}
              onChange={(e) =>
                set({
                  capacityUnit: e.target.value as WorkSettings["capacityUnit"],
                })
              }
            >
              <option value="projects">Projects</option>
              <option value="systems">Systems</option>
              <option value="kW">kW</option>
              <option value="MW">MW</option>
            </select>
          </label>
          <label>
            Per
            <select
              value={v.capacityPeriod}
              onChange={(e) =>
                set({
                  capacityPeriod: e.target
                    .value as WorkSettings["capacityPeriod"],
                })
              }
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
        </div>
      </fieldset>
    </>
  );
}
