import { useState } from "react";
import {
  ArrowUpRight,
  Award,
  ChevronDown,
  Globe,
  Plus,
  Pencil,
  Users,
} from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
import {
  useAction,
  FormError,
  ConfirmAction,
  useUnsavedChanges,
} from "./management";
import type { Credential } from "./types";

const categories = {
  certification: "Certification",
  qualification: "Professional qualification",
  ranking: "Industry ranking",
  directory: "Directory listing",
  membership: "Industry membership",
};
const evidence = {
  issuer: "Issuer source",
  company: "Company-reported",
  directory: "Directory source",
};
const scopes = {
  company: "Company",
  product: "Product",
  personnel: "Personnel",
};
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export function CompanyCredentials({
  items = [],
  editable,
}: {
  items?: Credential[];
  editable: boolean;
}) {
  const { open } = useApp();
  const groups = [
    {
      label: "Certifications & qualifications",
      rows: items.filter(
        (item) =>
          item.category === "certification" ||
          item.category === "qualification",
      ),
    },
    {
      label: "Industry recognition",
      rows: items.filter(
        (item) => item.category === "ranking" || item.category === "membership",
      ),
    },
    {
      label: "Directory profiles",
      rows: items.filter((item) => item.category === "directory"),
    },
  ];
  return (
    <section className="profile-card credentials-card">
      <div className="profile-section-heading">
        <div>
          <h2>Credentials & presence</h2>
          <p>Certifications, recognition, and listings, with sources.</p>
        </div>
        {editable && (
          <button
            className="button small"
            aria-label="Add credential or directory listing"
            onClick={() => open(<CredentialEditor />)}
          >
            <Plus size={15} />
            Add
          </button>
        )}
      </div>
      {groups
        .filter((group) => group.rows.length)
        .map((group) => (
          <div className="credential-group" key={group.label}>
            <h3 className="credential-group-label">
              {group.label}
              <span>{group.rows.length}</span>
            </h3>
            {group.rows.map((item) => {
              const expired =
                !!item.valid_until &&
                item.valid_until.slice(0, 10) <
                  new Date().toISOString().slice(0, 10);
              const Icon =
                item.category === "directory"
                  ? Globe
                  : item.scope === "personnel"
                    ? Users
                    : Award;
              return (
                <article
                  className={`credential-entry credential-${item.category}`}
                  key={item.id}
                >
                  <details className="credential-disclosure">
                    <summary className="credential-summary">
                      <span className="credential-icon">
                        <Icon size={18} aria-hidden="true" />
                      </span>
                      <div className="credential-summary-text">
                        <h3>{item.title}</h3>
                        <span className="credential-meta">
                          {[
                            categories[item.category],
                            item.period,
                            scopes[item.scope],
                            evidence[item.evidence_basis],
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {expired && (
                          <span className="credential-meta">
                            Expired: {date(item.valid_until!)}
                          </span>
                        )}
                      </div>
                      <ChevronDown
                        className="credential-chevron"
                        size={16}
                        aria-hidden="true"
                      />
                    </summary>
                    <div className="credential-detail">
                      <p>{item.scope_detail}</p>
                      {item.description && <p>{item.description}</p>}
                      {item.organization && (
                        <p className="credential-meta">{item.organization}</p>
                      )}
                      {item.valid_until && !expired && (
                        <p className="credential-meta">
                          Valid until: {date(item.valid_until)}
                        </p>
                      )}
                      <div className="credential-proof">
                        <span>
                          {item.checked_at
                            ? `Source checked ${date(item.checked_at)}`
                            : "Not independently reviewed"}
                        </span>
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {item.category === "directory"
                            ? "View listing"
                            : "View source"}
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </a>
                      </div>
                    </div>
                  </details>
                  {editable && !item.catalog_key && (
                    <button
                      className="icon-button credential-edit"
                      aria-label={`Edit ${item.title}`}
                      onClick={() => open(<CredentialEditor item={item} />)}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        ))}
      {!items.length && <p className="muted">No credentials added yet.</p>}
    </section>
  );
}

function CredentialEditor({ item }: { item?: Credential }) {
  const { refresh, close, open } = useApp();
  const task = useAction();
  const [dirty, setDirty] = useState(false);
  const guard = useUnsavedChanges(dirty, task.busy);
  const [category, setCategory] = useState(item?.category || "certification");
  return (
    <section className="manage-dialog">
      <header className="manage-heading">
        <h2>{item ? "Edit credential" : "Add credential or listing"}</h2>
        <p>
          Add a public source and describe exactly what it covers. Company
          submissions are labeled company-reported.
        </p>
      </header>
      <form
        className="manage-form"
        onChange={() => setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          void task.run(async () => {
            await api(
              "/companies/current/credentials" + (item ? `/${item.id}` : ""),
              {
                method: item ? "PATCH" : "POST",
                body: JSON.stringify({
                  category,
                  title: values.get("title"),
                  organization: values.get("organization"),
                  scope: values.get("scope"),
                  scopeDetail: values.get("scopeDetail"),
                  description: values.get("description"),
                  sourceUrl: values.get("sourceUrl"),
                  period: values.get("period"),
                  validUntil: values.get("validUntil") || null,
                }),
              },
            );
            refresh();
            close();
          });
        }}
      >
        <label>
          Type
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as Credential["category"])
            }
          >
            {Object.entries(categories).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input
            name="title"
            required
            minLength={2}
            maxLength={180}
            defaultValue={item?.title}
            placeholder="e.g. UL 61730 or EnergySage profile"
          />
        </label>
        <label>
          Issuing organization or directory
          <input
            name="organization"
            maxLength={180}
            defaultValue={item?.organization}
          />
        </label>
        <label>
          Applies to
          <select name="scope" defaultValue={item?.scope || "company"}>
            {Object.entries(scopes).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scope
          <input
            name="scopeDetail"
            required
            minLength={2}
            maxLength={600}
            defaultValue={item?.scope_detail}
            placeholder="Named product models, people, or business entity"
          />
        </label>
        <label>
          Details
          <textarea
            name="description"
            maxLength={1200}
            defaultValue={item?.description}
          />
        </label>
        <label>
          Public source URL
          <input
            name="sourceUrl"
            type="url"
            required
            pattern="https://.*"
            maxLength={2000}
            defaultValue={item?.source_url}
          />
        </label>
        <label>
          Applicable period
          <input
            name="period"
            maxLength={100}
            defaultValue={item?.period}
            placeholder="e.g. Q3 2026; leave blank if not stated"
          />
        </label>
        <label>
          Expiry, if stated
          <input
            name="validUntil"
            type="date"
            defaultValue={item?.valid_until?.slice(0, 10)}
          />
        </label>
        <FormError error={task.error} />
        {guard}
        <footer className="manage-footer">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          {item && (
            <button
              type="button"
              className="button"
              onClick={() =>
                open(
                  <ConfirmAction
                    title="Remove credential?"
                    description={item.title}
                    action={() =>
                      api(`/companies/current/credentials/${item.id}`, {
                        method: "DELETE",
                      })
                    }
                  />,
                )
              }
            >
              Remove
            </button>
          )}
          <button className="button primary" disabled={task.busy}>
            {task.busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </form>
    </section>
  );
}
