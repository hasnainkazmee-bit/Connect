import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePageGuard } from "./page-navigation";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  ExternalLink,
  ImagePlus,
  LoaderCircle,
  Mail,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import { Avatar, Logo } from "./identity";
import type { Achievement, Company, Project } from "./types";
import { usePhotoAdjuster } from "./photo-adjuster";
import "./management.css";

type Site = {
  appOrigin: string;
  profileDomain: string;
  subdomainsEnabled: boolean;
  profileUsername: string | null;
};
let sitePromise: Promise<Site> | undefined;
export function useSite() {
  const [site, setSite] = useState<Site>({
    appOrigin: location.origin,
    profileDomain: location.hostname,
    subdomainsEnabled: false,
    profileUsername: null,
  });
  useEffect(() => {
    sitePromise ||= api<Site>("/site");
    sitePromise.then(setSite).catch(() => {
      sitePromise = undefined;
    });
  }, []);
  return site;
}
export function publicProfileUrl(c: Company, site: Site) {
  return (
    site.appOrigin + (c.username ? "/" + c.username : "/company/" + c.slug)
  );
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
export function FormError({ error }: { error: string }) {
  return error ? (
    <div className="manage-error" role="alert">
      {error}
    </div>
  ) : null;
}
export function useUnsavedChanges(dirty: boolean, busy = false) {
  usePageGuard(dirty, busy);
  return null;
}
export function UsernameField({
  value,
  onChange,
  current,
}: {
  value: string;
  onChange: (s: string) => void;
  current?: string | null;
}) {
  const [state, setState] = useState(""),
    [valid, setValid] = useState(false);
  const site = useSite();
  useEffect(() => {
    if (!value || value === current) {
      setState(
        value
          ? "Your company username"
          : "Choose a memorable name for your profile.",
      );
      setValid(true);
      return;
    }
    let cancelled = false;
    setState("Checking availability…");
    setValid(false);
    const timer = setTimeout(
      () =>
        api<{ available: boolean }>("/usernames/" + encodeURIComponent(value))
          .then((r) => {
            if (!cancelled) {
              setState(
                r.available ? "Available" : "That name is taken. Try another.",
              );
              setValid(r.available);
            }
          })
          .catch((e) => {
            if (!cancelled) {
              setState(e.message);
              setValid(false);
            }
          }),
      400,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, current]);
  return (
    <label className="username-field">
      Company username
      <div className="input-prefix">
        <span>@</span>
        <input
          name="username"
          value={value}
          maxLength={30}
          pattern="[a-z][a-z0-9-]{1,28}[a-z0-9]"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="your-company"
          onChange={(e) =>
            onChange(e.target.value.toLowerCase().replace(/\s/g, ""))
          }
        />
        {value && valid && <Check size={16} />}
      </div>
      <small className={valid ? "" : "field-warning"} role="status">
        {state}
      </small>
      {value && valid && (
        <span className="profile-address">
          {site.appOrigin.replace(/^https?:\/\//, "") + "/" + value}
        </span>
      )}
    </label>
  );
}
export async function uploadCompanyPhoto(file: File, signal?: AbortSignal) {
  const form = new FormData();
  form.set("file", file);
  return api<{ id: string; url: string }>("/companies/current/assets", {
    method: "POST",
    body: form,
    signal,
  });
}
export function BrandEditor({
  target,
  slot,
}: {
  target: Company;
  slot: "logo" | "cover";
}) {
  const { close, refresh, setSession, toast } = useApp(),
    task = useAction();
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(
      slot === "logo" ? target.logo_url || "" : target.cover_url,
    );
  const input = useRef<HTMLInputElement>(null);
  const operations = useRef(new AbortController()),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    operations.current = new AbortController();
    return () => {
      mounted.current = false;
      operations.current.abort();
    };
  }, [target.id, slot]);
  const owns = (owner: AbortController) =>
    mounted.current && operations.current === owner && !owner.signal.aborted;
  const { adjustPhoto, photoAdjuster, adjustingPhoto } = usePhotoAdjuster();
  const guard = useUnsavedChanges(!!file, task.busy || adjustingPhoto);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <section className="manage-dialog brand-photo-editor">
      <header className="manage-heading">
        <span>MAKE IT YOURS</span>
        <h2>{slot === "logo" ? "Company logo" : "Cover photo"}</h2>
        <p>
          {slot === "logo"
            ? "Choose a clear, square image that people will recognize."
            : "Show your work with a portrait or square photo. Adjust the crop before saving."}
        </p>
      </header>
      <button
        type="button"
        className={"branding-preview " + slot}
        disabled={task.busy || adjustingPhoto}
        onClick={() => input.current?.click()}
      >
        {preview ? (
          <img
            src={preview}
            alt={slot === "logo" ? "Logo preview" : "Cover preview"}
          />
        ) : (
          <ImagePlus size={40} />
        )}
        <span>
          <ImagePlus size={16} />
          {preview ? "Choose a different photo" : "Choose a photo"}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        hidden
        disabled={task.busy || adjustingPhoto}
        accept=".jpg,.jpeg,.png,.webp"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          const owner = operations.current;
          if (task.busy || adjustingPhoto || !owns(owner)) return;
          if (f) {
            if (f.size > 10 * 1024 * 1024)
              task.setError("Choose a photo under 10 MB.");
            else {
              task.setError("");
              const adjusted = await adjustPhoto(f, {
                title:
                  slot === "logo"
                    ? "Adjust company logo"
                    : "Adjust cover photo",
                aspects:
                  slot === "logo"
                    ? [{ label: "Square 1:1", value: 1 }]
                    : [
                        { label: "Portrait 4:5", value: 4 / 5 },
                        { label: "Square 1:1", value: 1 },
                      ],
                initialAspect: slot === "logo" ? 1 : 4 / 5,
              });
              if (adjusted && owns(owner)) setFile(adjusted);
            }
          }
        }}
      />
      <p className="manage-help">JPG, PNG or WebP · up to 10 MB</p>
      <FormError error={task.error} />
      {guard}
      {photoAdjuster}
      <footer className="manage-footer">
        <button className="button" onClick={close} disabled={task.busy}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!file || task.busy}
          onClick={() =>
            void task.run(async () => {
              const owner = operations.current;
              if (!owns(owner)) return;
              const asset = await uploadCompanyPhoto(file!, owner.signal);
              if (!owns(owner)) return;
              await api("/companies/current/branding", {
                method: "PUT",
                body: JSON.stringify({ slot, assetId: asset.id }),
                signal: owner.signal,
              });
              if (!owns(owner)) return;
              const next = await api("/session", { signal: owner.signal });
              if (!owns(owner)) return;
              setSession(next);
              refresh();
              close(true);
              toast(
                slot === "logo"
                  ? "Company logo updated."
                  : "Cover photo updated.",
              );
            })
          }
        >
          {task.busy ? "Saving…" : "Save photo"}
        </button>
      </footer>
    </section>
  );
}
export function TagInput({
  label,
  values,
  onChange,
  placeholder,
  suggestions = [],
  maxItems = 30,
  maxLength = 60,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  suggestions?: string[];
  maxItems?: number;
  maxLength?: number;
}) {
  const [input, setInput] = useState("");
  const add = (v: string) => {
    const clean = v.trim();
    if (
      clean &&
      !values.some((value) => value.toLowerCase() === clean.toLowerCase()) &&
      values.length < maxItems
    )
      onChange([...values, clean.slice(0, maxLength)]);
    setInput("");
  };
  return (
    <fieldset className="tag-field">
      <legend>{label}</legend>
      <div className="tag-input">
        {values.map((v) => (
          <span key={v}>
            {v}
            <button
              type="button"
              aria-label={"Remove " + v}
              onClick={() => onChange(values.filter((t) => t !== v))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          aria-label={label}
          value={input}
          placeholder={
            values.length >= maxItems ? "Maximum items added" : placeholder
          }
          maxLength={maxLength}
          disabled={values.length >= maxItems}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(input);
            }
          }}
          onBlur={() => add(input)}
        />
        <button
          className="tag-add-button"
          type="button"
          onClick={() => add(input)}
          disabled={!input.trim() || values.length >= maxItems}
        >
          <Plus size={16} />
          Add
        </button>
      </div>
      {suggestions.filter((v) => !values.includes(v)).length > 0 && (
        <div className="tag-suggestions">
          {suggestions
            .filter((v) => !values.includes(v))
            .map((v) => (
              <button key={v} type="button" onClick={() => add(v)}>
                <Plus size={11} />
                {v}
              </button>
            ))}
        </div>
      )}
    </fieldset>
  );
}
export function ProfileEditor({ target }: { target: Company }) {
  const { close, refresh, setSession, toast } = useApp(),
    task = useAction();
  const [username, setUsername] = useState(target.username || ""),
    [services, setServices] = useState(target.services),
    [areas, setAreas] = useState(target.service_areas),
    [audiences, setAudiences] = useState(target.audiences || []),
    [dirty, setDirty] = useState(false);
  const guard = useUnsavedChanges(dirty, task.busy);
  return (
    <section className="manage-dialog profile-editor">
      <header className="manage-heading">
        <span>YOUR COMPANY PROFILE</span>
        <h2>Make a great introduction.</h2>
        <p>The essentials people look for before starting a conversation.</p>
      </header>
      <form
        className="manage-form"
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.currentTarget));
          void task.run(async () => {
            await api("/companies/current/profile", {
              method: "PATCH",
              body: JSON.stringify({
                ...data,
                username: username || undefined,
                services,
                service_areas: areas,
                audiences,
                established: data.established ? Number(data.established) : null,
              }),
            });
            setSession(await api("/session"));
            refresh();
            close(true);
            toast("Your profile is up to date.");
          });
        }}
      >
        <div className="manage-section">
          <h3>At a glance</h3>
          <label>
            Company name
            <input
              name="name"
              defaultValue={target.name}
              required
              minLength={2}
              maxLength={120}
              autoComplete="organization"
            />
          </label>
          <UsernameField
            value={username}
            current={target.username}
            onChange={(v) => {
              setUsername(v);
              setDirty(true);
            }}
          />
          <label>
            Headline
            <input
              name="tagline"
              defaultValue={target.tagline}
              maxLength={200}
              placeholder="What you do, in one clear sentence"
            />
            <small>A short introduction shown beside your company name.</small>
          </label>
          <div className="manage-grid">
            <label>
              Business type
              <select name="type" defaultValue={target.type}>
                {[
                  "Installer",
                  "EPC",
                  "Contractor",
                  "Developer",
                  "Distributor",
                  "Manufacturer",
                  "Service provider",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Based in
              <input
                name="location"
                defaultValue={target.location}
                maxLength={160}
                placeholder="City, state or country"
              />
            </label>
          </div>
        </div>
        <div className="manage-section">
          <h3>A little more about you</h3>
          <label>
            About
            <textarea
              name="description"
              defaultValue={target.description}
              maxLength={3000}
              rows={5}
              placeholder="Who you help, what you believe in, and what makes your work different."
            />
          </label>
          <label>
            Website
            <input
              name="website"
              type="url"
              defaultValue={target.website}
              placeholder="https://yourcompany.com"
            />
          </label>
          <div className="manage-grid">
            <label>
              Company size
              <select
                name="employee_count"
                defaultValue={target.employee_count || ""}
              >
                <option value="">Choose a range</option>
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
            <label>
              Founded
              <input
                name="established"
                type="number"
                min={1800}
                max={new Date().getFullYear()}
                defaultValue={target.established || ""}
                placeholder="Year"
              />
            </label>
          </div>
          <label>
            Public business phone
            <input
              name="phone"
              type="tel"
              defaultValue={target.phone || ""}
              maxLength={40}
              placeholder="e.g. +1 512 555 0100"
            />
            <small>Shown on your public directory profile.</small>
          </label>
          <fieldset>
            <legend>Projects you support</legend>
            <div className="service-choices">
              {["Residential", "Commercial", "Utility-scale"].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={audiences.includes(value)}
                  onClick={() => {
                    setAudiences((a) =>
                      a.includes(value)
                        ? a.filter((v) => v !== value)
                        : [...a, value],
                    );
                    setDirty(true);
                  }}
                >
                  {audiences.includes(value) && <Check size={13} />} {value}
                </button>
              ))}
            </div>
          </fieldset>
          <TagInput
            label="Services"
            values={services}
            onChange={(v) => {
              setServices(v);
              setDirty(true);
            }}
            placeholder="Add a service, then press Enter"
            suggestions={[
              "Installation",
              "Design",
              "Engineering",
              "O&M",
              "Energy storage",
            ]}
          />
          <TagInput
            label="Areas served"
            values={areas}
            onChange={(v) => {
              setAreas(v);
              setDirty(true);
            }}
            placeholder="Add a state or region, then press Enter"
          />
        </div>
        <FormError error={task.error} />
        {guard}
        <footer className="manage-footer">
          <span>Changes appear on your public profile.</span>
          <button className="button primary" disabled={task.busy}>
            {task.busy ? "Saving…" : "Save changes"}
            <Check size={16} />
          </button>
        </footer>
      </form>
    </section>
  );
}
export function PortfolioEditor({ project }: { project?: Project }) {
  const { close, refresh, toast } = useApp(),
    task = useAction();
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(project?.image_url || ""),
    [dirty, setDirty] = useState(false);
  const savedSize = project?.size?.match(
    /^([0-9]+(?:\.[0-9]+)?)\s+(kW|MW|systems|sites|panels)$/i,
  );
  const [sizeAmount, setSizeAmount] = useState(savedSize?.[1] || "");
  const [sizeUnit, setSizeUnit] = useState(
    savedSize?.[2]
      ? (
          {
            kw: "kW",
            mw: "MW",
            systems: "systems",
            sites: "sites",
            panels: "panels",
          } as Record<string, string>
        )[savedSize[2].toLowerCase()]
      : project?.size
        ? "existing"
        : "kW",
  );
  const input = useRef<HTMLInputElement>(null),
    guard = useUnsavedChanges(dirty, task.busy);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <section className="manage-dialog">
      <header className="manage-heading">
        <span>YOUR WORK, ON DISPLAY</span>
        <h2>{project ? "Edit project" : "Add a project"}</h2>
        <p>Show the work behind your company’s name.</p>
      </header>
      <form
        className="manage-form"
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.currentTarget));
          void task.run(async () => {
            const imageUrl = file
              ? (await uploadCompanyPhoto(file)).url
              : project?.image_url || "";
            await api(
              "/companies/current/portfolio" +
                (project ? "/" + project.id : ""),
              {
                method: project ? "PATCH" : "POST",
                body: JSON.stringify({
                  ...data,
                  size:
                    sizeUnit === "existing"
                      ? project?.size || ""
                      : sizeAmount
                        ? sizeAmount + " " + sizeUnit
                        : "",
                  imageUrl,
                  completedYear: data.completedYear
                    ? Number(data.completedYear)
                    : null,
                }),
              },
            );
            refresh();
            close(true);
            toast("Project saved to your portfolio.");
          });
        }}
      >
        <button
          className="project-upload"
          type="button"
          onClick={() => input.current?.click()}
        >
          {preview ? (
            <img src={preview} alt="Project preview" />
          ) : (
            <ImagePlus size={30} />
          )}
          <span>
            {preview ? "Change project photo" : "Add a project photo"}
          </span>
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".jpg,.jpeg,.png,.webp"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              setFile(e.target.files[0]);
              setDirty(true);
            }
            e.target.value = "";
          }}
        />
        <label>
          Project name
          <input
            name="name"
            required
            minLength={2}
            maxLength={150}
            defaultValue={project?.name}
            placeholder="A name your work deserves"
          />
        </label>
        <label>
          The story
          <textarea
            name="description"
            rows={4}
            maxLength={3000}
            defaultValue={project?.description}
            placeholder="What did you build? What changed for your customer?"
          />
        </label>
        <div className="manage-grid">
          <label>
            Location
            <input
              name="location"
              autoComplete="address-level2"
              maxLength={160}
              defaultValue={project?.location}
              placeholder="City, state"
            />
          </label>
          <fieldset className="portfolio-size">
            <legend>
              Project size <small>Optional</small>
            </legend>
            <div className="workspace-field-pair">
              {sizeUnit !== "existing" && (
                <label>
                  Quantity
                  <input
                    aria-label="Project size quantity"
                    type="number"
                    min={["kW", "MW"].includes(sizeUnit) ? "0.01" : "1"}
                    max="100000000"
                    step={["kW", "MW"].includes(sizeUnit) ? "0.01" : "1"}
                    inputMode="decimal"
                    value={sizeAmount}
                    onChange={(e) => setSizeAmount(e.target.value)}
                  />
                </label>
              )}
              <label>
                Unit
                <select
                  aria-label="Project size unit"
                  value={sizeUnit}
                  onChange={(e) => setSizeUnit(e.target.value)}
                >
                  <option value="kW">kW</option>
                  <option value="MW">MW</option>
                  <option value="systems">Systems</option>
                  <option value="sites">Sites</option>
                  <option value="panels">Panels</option>
                  {sizeUnit === "existing" && (
                    <option value="existing">{project?.size}</option>
                  )}
                </select>
              </label>
            </div>
          </fieldset>
          <label>
            Completion year
            <input
              name="completedYear"
              type="number"
              min={1900}
              max={new Date().getFullYear()}
              step="1"
              inputMode="numeric"
              defaultValue={project?.completed_year || ""}
            />
          </label>
          <label>
            Project link <small>optional</small>
            <input
              name="url"
              type="url"
              defaultValue={project?.url}
              placeholder="https://"
            />
          </label>
        </div>
        <FormError error={task.error} />
        {guard}
        <footer className="manage-footer">
          <span>Appears in your company portfolio.</span>
          <button className="button primary" disabled={task.busy}>
            {task.busy ? "Saving…" : "Save project"}
          </button>
        </footer>
      </form>
    </section>
  );
}
export function AchievementEditor({
  achievement: a,
}: {
  achievement?: Achievement;
}) {
  const { close, refresh, toast } = useApp(),
    task = useAction();
  const [dirty, setDirty] = useState(false),
    guard = useUnsavedChanges(dirty, task.busy);
  return (
    <section className="manage-dialog">
      <header className="manage-heading">
        <span>SOMETHING TO CELEBRATE</span>
        <h2>{a ? "Edit achievement" : "Add an achievement"}</h2>
        <p>Add an award or a company milestone to your profile.</p>
      </header>
      <form
        className="manage-form"
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.currentTarget));
          void task.run(async () => {
            await api(
              "/companies/current/achievements" + (a ? "/" + a.id : ""),
              {
                method: a ? "PATCH" : "POST",
                body: JSON.stringify({
                  ...data,
                  year: data.year ? Number(data.year) : null,
                }),
              },
            );
            refresh();
            close(true);
            toast("Achievement added to your profile.");
          });
        }}
      >
        <label>
          Title
          <input
            name="title"
            required
            minLength={2}
            maxLength={150}
            defaultValue={a?.title}
            placeholder="What are you celebrating?"
          />
        </label>
        <div className="manage-grid">
          <label>
            Issued by
            <input
              name="issuer"
              maxLength={150}
              defaultValue={a?.issuer}
              placeholder="Organization, if applicable"
            />
          </label>
          <label>
            Year
            <input
              name="year"
              type="number"
              min={1900}
              max={new Date().getFullYear()}
              step="1"
              inputMode="numeric"
              defaultValue={a?.year || ""}
            />
          </label>
        </div>
        <label>
          Description
          <textarea
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={a?.description}
          />
        </label>
        <label>
          Supporting link
          <input
            name="url"
            type="url"
            defaultValue={a?.url}
            placeholder="https://"
          />
        </label>
        <FormError error={task.error} />
        {guard}
        <footer className="manage-footer">
          <span>Let your work speak for itself.</span>
          <button className="button primary" disabled={task.busy}>
            {task.busy ? "Saving…" : "Save achievement"}
          </button>
        </footer>
      </form>
    </section>
  );
}
export function ConfirmAction({
  title,
  description,
  label = "Remove",
  action,
}: {
  title: string;
  description: string;
  label?: string;
  action: () => Promise<void>;
}) {
  const { close, refresh } = useApp(),
    task = useAction();
  return (
    <section className="manage-dialog">
      <header className="manage-heading">
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <FormError error={task.error} />
      <footer className="manage-footer">
        <button className="button" disabled={task.busy} onClick={close}>
          Keep it
        </button>
        <button
          className="button danger"
          disabled={task.busy}
          onClick={() =>
            void task.run(async () => {
              await action();
              refresh();
              close(true);
            })
          }
        >
          {task.busy ? "Working…" : label}
        </button>
      </footer>
    </section>
  );
}
export function ShareProfile({
  target,
  reviews = false,
}: {
  target: Company;
  reviews?: boolean;
}) {
  const site = useSite(),
    task = useAction();
  const [copied, setCopied] = useState(false);
  const url = publicProfileUrl(target, site) + (reviews ? "?tab=reviews" : "");
  return (
    <section className="manage-dialog share-profile">
      <Logo company={target} size="large" />
      <header className="manage-heading">
        <h2>
          {reviews
            ? "Invite your customers to review you."
            : "Share " + target.name}
        </h2>
        <p>
          {reviews
            ? "Send this link after a project. Customers can share their experience and rate your company."
            : "One link to your updates, work, people, and customer reviews."}
        </p>
      </header>
      <label className="share-address">
        Your {reviews ? "review" : "profile"} link
        <input
          readOnly
          value={url}
          aria-label="Profile link"
          onFocus={(e) => e.currentTarget.select()}
        />
      </label>
      <FormError error={task.error} />
      <button
        className="button primary"
        onClick={() =>
          void task.run(async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          })
        }
      >
        {copied ? <CheckCheck size={17} /> : <Copy size={17} />}
        {copied ? "Link copied" : "Copy link"}
      </button>
    </section>
  );
}
const roleDescriptions = {
  admin:
    "Manage jobs and quotes, update the provider profile, invite employees, and reply in project conversations.",
  member:
    "Read and reply in project conversations. Jobs, quotes, profile editing, and team settings stay with administrators.",
};
export function EmployeeInvite({
  initialEmail = "",
  initialRole = "member",
}: {
  initialEmail?: string;
  initialRole?: "admin" | "member";
}) {
  const { company, refresh, close } = useApp(),
    task = useAction();
  const [email, setEmail] = useState(initialEmail),
    [role, setRole] = useState<"admin" | "member">(initialRole),
    [url, setUrl] = useState(""),
    [copied, setCopied] = useState(false);
  const guard = useUnsavedChanges(!url && !!email, task.busy);
  return (
    <section className="manage-dialog employee-invite">
      <header className="manage-heading">
        <span>BETTER, TOGETHER</span>
        <h2>{url ? "Your invitation is ready." : "Invite an employee"}</h2>
        <p>
          {url
            ? "Share this welcome link with " + email + "."
            : `Give a teammate access to ${company?.name}. They’ll sign in with their own account.`}
        </p>
      </header>
      {url ? (
        <>
          <div className="invite-summary">
            <span className="invite-success">
              <Check size={23} />
            </span>
            <div>
              <strong>{email}</strong>
              <small>
                {role === "admin" ? "Administrator" : "Inbox member"} · Expires
                in 3 days
              </small>
            </div>
          </div>
          <label className="share-address">
            Your company’s welcome link
            <input
              aria-label="Invitation link"
              value={url}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <div className="invite-detail">
            <ShieldCheck size={19} />
            <p>
              Only an invited, verified email can get access. This invitation
              expires in 3 days. Copy the link and share it with your employee.
            </p>
          </div>
          <FormError error={task.error} />
          <footer className="manage-footer">
            <button className="button" onClick={close}>
              Done
            </button>
            <button
              className="button primary"
              onClick={() =>
                void task.run(async () => {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                })
              }
            >
              {copied ? <CheckCheck size={16} /> : <Copy size={16} />}
              {copied ? "Copied" : "Copy invitation"}
            </button>
          </footer>
        </>
      ) : (
        <form
          className="manage-form"
          onSubmit={(e) => {
            e.preventDefault();
            void task.run(async () => {
              setUrl(
                (await post<{ url: string }>("/team/invites", { email, role }))
                  .url,
              );
              refresh();
            });
          }}
        >
          <label>
            Employee’s work email
            <input
              type="email"
              name="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="name@yourcompany.com"
            />
          </label>
          <fieldset className="invite-roles">
            <legend>What should they be able to do?</legend>
            {(["member", "admin"] as const).map((value) => (
              <label className={role === value ? "selected" : ""} key={value}>
                <input
                  type="radio"
                  name="role"
                  value={value}
                  checked={role === value}
                  onChange={() => setRole(value)}
                />
                <span>
                  <strong>
                    {value === "admin" ? "Administrator" : "Inbox member"}
                  </strong>
                  <small>{roleDescriptions[value]}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="invite-detail">
            <ShieldCheck size={18} />
            <p>
              Separate logins. One company profile. You can remove access
              anytime.
            </p>
          </div>
          <FormError error={task.error} />
          {guard}
          <footer className="manage-footer">
            <button className="button" type="button" onClick={close}>
              Cancel
            </button>
            <button className="button primary" disabled={task.busy}>
              {task.busy ? "Creating…" : "Create invitation"}
              <ArrowRight size={16} />
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}
type Member = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  title: string;
};
type Invite = {
  id: string;
  email: string;
  role: "admin" | "member";
  expires_at: string;
};
export function TeamManager() {
  const { company, admin, session, revision, refresh, open } = useApp();
  const [members, setMembers] = useState<Member[]>([]),
    [invites, setInvites] = useState<Invite[]>([]),
    [loading, setLoading] = useState(true);
  const task = useAction();
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<Member[]>("/team"),
      admin ? api<Invite[]>("/team/invites") : Promise.resolve([]),
    ])
      .then(([m, i]) => {
        if (!cancelled) {
          setMembers(m);
          setInvites(i);
        }
      })
      .catch((e) => task.setError(e.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [company?.id, revision, admin]);
  return (
    <section className="team-manager">
      <div className="manage-section-heading">
        <div>
          <h2>People with access</h2>
          <p>
            Everyone uses their own login. Your company keeps its conversations.
          </p>
        </div>
        {admin && (
          <button
            className="button primary"
            onClick={() => open(<EmployeeInvite />)}
          >
            <UserPlus size={17} />
            Invite employee
          </button>
        )}
      </div>
      <FormError error={task.error} />
      {loading ? (
        <div className="manage-loading">
          <LoaderCircle className="spin" />
          Loading your team…
        </div>
      ) : (
        <div className="access-list">
          {members.map((m) => (
            <div className="access-row" key={m.id}>
              <Avatar name={m.name} />
              <div className="access-person">
                <strong>
                  {m.name}
                  {session.user?.id === m.id && <small> (you)</small>}
                </strong>
                <span>{m.email}</span>
              </div>
              <span className={"access-role " + m.role}>
                {m.role === "owner"
                  ? "Owner"
                  : m.role === "admin"
                    ? "Administrator"
                    : "Inbox member"}
              </span>
              {admin &&
                m.id !== session.user?.id &&
                m.role !== "owner" &&
                (company?.role === "owner" || m.role === "member") && (
                  <details className="access-menu">
                    <summary
                      className="icon-button"
                      aria-label={"Manage " + m.name}
                    >
                      <ChevronDown size={17} />
                    </summary>
                    <div className="dropdown">
                      {company?.role === "owner" && (
                        <button
                          onClick={() =>
                            open(
                              <ConfirmAction
                                title={"Change access for " + m.name + "?"}
                                description={
                                  m.role === "admin"
                                    ? roleDescriptions.member
                                    : roleDescriptions.admin
                                }
                                label={
                                  m.role === "admin"
                                    ? "Make team member"
                                    : "Make administrator"
                                }
                                action={() =>
                                  api("/team/" + m.id + "/role", {
                                    method: "PATCH",
                                    body: JSON.stringify({
                                      role:
                                        m.role === "admin" ? "member" : "admin",
                                    }),
                                  })
                                }
                              />,
                            )
                          }
                        >
                          Change to{" "}
                          {m.role === "admin" ? "team member" : "administrator"}
                        </button>
                      )}
                      <button
                        className="danger-text"
                        onClick={() =>
                          open(
                            <ConfirmAction
                              title={"Remove " + m.name + "?"}
                              description="They will lose access to this company. Existing jobs, quotes, and project conversations stay with the company."
                              label="Remove access"
                              action={() =>
                                api("/team/" + m.id, { method: "DELETE" })
                              }
                            />,
                          )
                        }
                      >
                        <Trash2 size={14} />
                        Remove access
                      </button>
                    </div>
                  </details>
                )}
            </div>
          ))}
        </div>
      )}
      {admin && (
        <section className="pending-invites">
          <h3>
            Pending invitations <span>{invites.length}</span>
          </h3>
          {invites.length ? (
            invites.map((i) => (
              <div className="access-row" key={i.id}>
                <span className="pending-icon">
                  <Mail size={18} />
                </span>
                <div className="access-person">
                  <strong>{i.email}</strong>
                  <span>
                    {i.role === "admin" ? "Administrator" : "Inbox member"} ·
                    Expires{" "}
                    {new Date(i.expires_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    open(
                      <EmployeeInvite
                        initialEmail={i.email}
                        initialRole={i.role}
                      />,
                    )
                  }
                >
                  New link
                </button>
                <button
                  className="icon-button"
                  aria-label={"Revoke invitation for " + i.email}
                  onClick={() =>
                    open(
                      <ConfirmAction
                        title="Revoke this invitation?"
                        description={
                          "The invitation for " +
                          i.email +
                          " will stop working."
                        }
                        label="Revoke invitation"
                        action={() =>
                          api("/team/invites/" + i.id, { method: "DELETE" })
                        }
                      />,
                    )
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))
          ) : (
            <div className="pending-empty">
              <Check size={17} />
              <span>No invitations waiting. Everyone’s accounted for.</span>
            </div>
          )}
        </section>
      )}
      <div className="team-permissions">
        <div>
          <ShieldCheck size={20} />
          <h3>Clear roles. Shared purpose.</h3>
        </div>
        <p>
          <strong>Administrators</strong> manage jobs, quotes, the company
          profile, and employees. <strong>Team members</strong> share job
          messages and progress updates. Only the owner can change permissions
          or remove an administrator.
        </p>
      </div>
    </section>
  );
}
export function CompanySettings() {
  const { company, admin, open } = useApp();
  if (!company) return null;
  return (
    <div className="company-settings">
      <header className="settings-heading">
        <div>
          <span className="section-kicker">COMPANY WORKSPACE</span>
          <h1>Your company, together.</h1>
          <p>Manage the profile and the people behind it.</p>
        </div>
        <Link
          className="button"
          to={"/company/" + (company.username || company.slug)}
        >
          View profile
          <ExternalLink size={15} />
        </Link>
      </header>
      <section className="settings-company">
        <Logo company={company} size="large" />
        <div>
          <h2>{company.name}</h2>
          <p>{company.tagline || company.type}</p>
          <small>
            {company.username ? "@" + company.username : company.location}
          </small>
        </div>
        {admin && (
          <Link className="button" to="/settings/profile/overview">
            <Pencil size={15} />
            Edit profile
          </Link>
        )}
      </section>
      <TeamManager />
      <Link className="settings-security" to="/account">
        <ShieldCheck size={19} />
        <span>
          <strong>Your personal login & security</strong>
          <small>Password and signed-in devices</small>
        </span>
        <ArrowRight size={18} />
      </Link>
    </div>
  );
}
