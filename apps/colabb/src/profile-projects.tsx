import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ImagePlus,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
import { FormError, uploadCompanyPhoto } from "./management";
import { usePageGuard } from "./page-navigation";
import type { Company, Project } from "./types";

export const projectsPath = "/settings/profile/portfolio";

export function ProfileProjects({
  projects,
  company,
  path,
}: {
  projects: Project[];
  company: Company;
  path: string;
}) {
  const project = projects.find((p) => p.id === path);
  if (path === "new" || project)
    return (
      <ProjectEditor
        key={company.id + path}
        company={company}
        project={project}
      />
    );
  if (path)
    return (
      <section className="project-not-found">
        <h2>Project not found</h2>
        <p>It may have been removed from your company profile.</p>
        <Link className="button" to={projectsPath}>
          <ArrowLeft size={17} /> Back to projects
        </Link>
      </section>
    );
  return (
    <section className="profile-project-section">
      <header className="workspace-section-heading">
        <div>
          <h2>
            Projects{" "}
            {projects.length > 0 && (
              <span className="project-count">{projects.length}</span>
            )}
          </h2>
          <p>Completed work that customers can see on your company profile.</p>
        </div>
        {projects.length > 0 && (
          <Link className="button primary" to={projectsPath + "/new"}>
            <Plus size={18} /> Add project
          </Link>
        )}
      </header>
      {projects.length ? (
        <div className="profile-project-list">
          {projects.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
        </div>
      ) : (
        <div className="project-empty-state">
          <div>
            <h3>Show your first project</h3>
            <p>
              Add a photo, describe your work, and include where and when it was
              completed.
            </p>
          </div>
          <Link className="button primary" to={projectsPath + "/new"}>
            <Plus size={18} /> Add project
          </Link>
        </div>
      )}
    </section>
  );
}

function ProjectRow({ project: p }: { project: Project }) {
  const { refresh, toast } = useApp();
  const [removing, setRemoving] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/companies/current/portfolio/" + p.id, { method: "DELETE" });
      refresh();
      toast("Project removed.");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <article
      className={"profile-project-row" + (p.image_url ? " has-photo" : "")}
    >
      {p.image_url && (
        <Link
          className="profile-project-thumbnail"
          to={projectsPath + "/" + p.id}
          tabIndex={-1}
          aria-hidden="true"
        >
          <img src={p.image_url} alt="" loading="lazy" />
        </Link>
      )}
      <div className="profile-project-summary">
        <h3>
          <Link to={projectsPath + "/" + p.id}>{p.name}</Link>
        </h3>
        {(p.location || p.completed_year || p.size) && (
          <div className="profile-project-meta">
            {p.location && (
              <span>
                <MapPin size={14} /> {p.location}
              </span>
            )}
            {p.completed_year && (
              <span>
                <CalendarDays size={14} /> {p.completed_year}
              </span>
            )}
            {p.size && <span>{p.size}</span>}
          </div>
        )}
        {p.description && <p>{p.description}</p>}
      </div>
      {!removing && (
        <div className="profile-project-actions">
          <Link className="button" to={projectsPath + "/" + p.id}>
            <Pencil size={16} /> Edit
          </Link>
          <button
            className="project-remove-button"
            type="button"
            aria-label={"Remove " + p.name}
            onClick={() => setRemoving(true)}
          >
            <Trash2 size={17} />
          </button>
        </div>
      )}
      {removing && (
        <div
          className="project-remove-confirmation"
          role="region"
          aria-label={"Remove " + p.name}
        >
          <div>
            <strong>Remove this project?</strong>
            <p>It will no longer appear on your public profile.</p>
          </div>
          <div className="page-actions">
            <button
              type="button"
              className="button"
              onClick={() => setRemoving(false)}
              disabled={busy}
            >
              Keep project
            </button>
            <button
              type="button"
              className="button project-danger"
              onClick={remove}
              disabled={busy}
            >
              {busy ? "Removing…" : "Remove project"}
            </button>
          </div>
          <FormError error={error} />
        </div>
      )}
    </article>
  );
}

function initialValues(project?: Project) {
  const size = project?.size?.match(
    /^([0-9]+(?:\.[0-9]+)?)\s+(kW|MW|systems|sites|panels)$/i,
  );
  return {
    name: project?.name || "",
    description: project?.description || "",
    location: project?.location || "",
    year: project?.completed_year?.toString() || "",
    url: project?.url || "",
    imageUrl: project?.image_url || "",
    sizeAmount: size?.[1] || "",
    sizeUnit: size
      ? (
          {
            kw: "kW",
            mw: "MW",
            systems: "systems",
            sites: "sites",
            panels: "panels",
          } as Record<string, string>
        )[size[2].toLowerCase()]
      : project?.size
        ? "existing"
        : "kW",
  };
}

function ProjectEditor({
  company,
  project,
}: {
  company: Company;
  project?: Project;
}) {
  const { refresh, toast } = useApp();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => initialValues(project));
  const [saved, setSaved] = useState(() =>
    JSON.stringify(initialValues(project)),
  );
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(form.imageUrl);
  const [busy, setBusy] = useState(false),
    [finished, setFinished] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const dirty = !finished && (JSON.stringify(form) !== saved || !!file);
  usePageGuard(dirty, busy);
  useEffect(() => {
    if (finished && !busy) {
      navigate(projectsPath, { replace: true });
    }
  }, [finished, busy, navigate]);
  useEffect(() => {
    if (!file) {
      setPreview(form.imageUrl);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, form.imageUrl]);
  const update = (field: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));
  function chooseFile(next?: File) {
    if (!next) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(next.type)) {
      setError("Choose a JPG, PNG, or WebP photo.");
      return;
    }
    if (next.size > 10 * 1024 * 1024) {
      setError("Choose a photo smaller than 10 MB.");
      return;
    }
    setError("");
    setFile(next);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const imageUrl = file
        ? (await uploadCompanyPhoto(file)).url
        : form.imageUrl;
      await api(
        "/companies/current/portfolio" + (project ? "/" + project.id : ""),
        {
          method: project ? "PATCH" : "POST",
          body: JSON.stringify({
            expectedCompanyId: company.id,
            name: form.name,
            description: form.description,
            location: form.location,
            completedYear: form.year ? Number(form.year) : null,
            url: form.url,
            imageUrl,
            size:
              form.sizeUnit === "existing"
                ? project?.size || ""
                : form.sizeAmount
                  ? form.sizeAmount + " " + form.sizeUnit
                  : "",
          }),
        },
      );
      setSaved(JSON.stringify(form));
      setFinished(true);
      refresh();
      toast(project ? "Project updated." : "Project added to your profile.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-project-editor">
      <Link className="project-back-link" to={projectsPath}>
        <ArrowLeft size={16} /> Projects
      </Link>
      <header className="workspace-section-heading">
        <div>
          <h2>{project ? "Edit project" : "Add project"}</h2>
          <p>
            Show what your team completed. Only the project name is required.
          </p>
        </div>
      </header>
      <form className="workspace-form project-form" onSubmit={save}>
        <fieldset className="project-editor-fields" disabled={busy || finished}>
          <div className="project-details-fields">
            <label>
              Project name
              <input
                autoFocus
                name="projectName"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                required
                minLength={2}
                maxLength={150}
                placeholder="e.g. Rooftop solar installation for a warehouse"
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                rows={5}
                maxLength={3000}
                placeholder="What did your team do? Describe the scope and the result."
              />
              <small>
                {form.description.length.toLocaleString()} / 3,000 characters
              </small>
            </label>
            <div className="project-location-fields">
              <label>
                Location
                <input
                  name="location"
                  autoComplete="address-level2"
                  value={form.location}
                  onChange={(e) => update("location", e.target.value)}
                  maxLength={160}
                  placeholder="City, state"
                />
              </label>
              <label>
                Completion year
                <input
                  name="year"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="1900"
                  max={new Date().getFullYear()}
                  value={form.year}
                  onChange={(e) => update("year", e.target.value)}
                  placeholder={String(new Date().getFullYear())}
                />
              </label>
            </div>
            <fieldset className="project-size-fields">
              <legend>
                Project size <small>Optional</small>
              </legend>
              <div>
                {form.sizeUnit !== "existing" && (
                  <input
                    aria-label="Project size quantity"
                    type="number"
                    inputMode={
                      ["kW", "MW"].includes(form.sizeUnit)
                        ? "decimal"
                        : "numeric"
                    }
                    min={["kW", "MW"].includes(form.sizeUnit) ? "0.01" : "1"}
                    step={["kW", "MW"].includes(form.sizeUnit) ? "0.01" : "1"}
                    max="100000000"
                    value={form.sizeAmount}
                    onChange={(e) => update("sizeAmount", e.target.value)}
                    placeholder="Quantity"
                  />
                )}
                <select
                  aria-label="Project size unit"
                  value={form.sizeUnit}
                  onChange={(e) => update("sizeUnit", e.target.value)}
                >
                  <option value="kW">kW</option>
                  <option value="MW">MW</option>
                  <option value="systems">Systems</option>
                  <option value="sites">Sites</option>
                  <option value="panels">Panels</option>
                  {project?.size &&
                    initialValues(project).sizeUnit === "existing" && (
                      <option value="existing">{project.size}</option>
                    )}
                </select>
              </div>
            </fieldset>
            <label>
              <span className="workspace-label">
                Project link <small>Optional</small>
              </span>
              <input
                name="url"
                type="url"
                value={form.url}
                onChange={(e) => update("url", e.target.value)}
                maxLength={2000}
                placeholder="https://"
              />
            </label>
          </div>
          <div className="project-photo-field">
            <span className="project-photo-label">
              Project photo <small>Optional</small>
            </span>
            <button
              className={"project-photo-select" + (preview ? " has-photo" : "")}
              type="button"
              onClick={() => input.current?.click()}
              aria-label={
                preview ? "Change project photo" : "Choose project photo"
              }
            >
              {preview ? (
                <img src={preview} alt="Project photo preview" />
              ) : (
                <>
                  <ImagePlus size={28} />
                  <span>Choose a photo</span>
                </>
              )}
            </button>
            <input
              ref={input}
              type="file"
              hidden
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                chooseFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {preview && (
              <div className="project-photo-actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => input.current?.click()}
                >
                  <ImagePlus size={16} /> Change photo
                </button>
                <button
                  className="project-remove-button"
                  type="button"
                  aria-label="Remove project photo"
                  onClick={() => {
                    setFile(null);
                    update("imageUrl", "");
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            )}
            <small>JPG, PNG, or WebP · Up to 10 MB</small>
            <p>
              This photo appears beside your project on your company profile.
            </p>
            {file && (
              <span className="project-photo-selected">
                <Check size={15} /> Photo selected
              </span>
            )}
          </div>
        </fieldset>
        <FormError error={error} />
        <footer className="workspace-save-bar project-save-bar">
          <span>
            {busy
              ? "Saving your project…"
              : "Visible on your company profile after saving."}
          </span>
          <div className="page-actions">
            <Link className="button" to={projectsPath}>
              Cancel
            </Link>
            <button
              type="submit"
              className="button primary"
              disabled={busy || finished || (!!project && !dirty)}
            >
              {busy ? "Saving…" : "Save project"}
            </button>
          </div>
        </footer>
      </form>
    </section>
  );
}
