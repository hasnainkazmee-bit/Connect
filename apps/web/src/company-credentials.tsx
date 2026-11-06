import { useState } from "react";
import { ArrowUpRight, Award, Globe, Plus, Pencil } from "lucide-react";
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
  return (
    <section className="profile-card credentials-card">
      <div className="profile-section-heading">
        <div>
          <h2>Credentials & industry presence</h2>
          <p>Certifications, qualifications, and places to learn more.</p>
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
      {([false, true] as const).map((directory) => {
        const rows = items.filter(
          (item) => (item.category === "directory") === directory,
        );
        return rows.length ? (
          <div key={String(directory)} className="credential-group">
            <h3>
              {directory ? "Around the industry" : "Credentials & recognition"}
            </h3>
            {rows.map((item) => {
              const expired =
                !!item.valid_until &&
                item.valid_until.slice(0, 10) <
                  new Date().toISOString().slice(0, 10);
              return (
                <article className="achievement" key={item.id}>
                  <span className="achievement-icon">
                    {directory ? <Globe size={22} /> : <Award size={22} />}
                  </span>
                  <div className="credential-content">
                    <small>
                      {categories[item.category]} · {scopes[item.scope]}
                    </small>
                    <h3>{item.title}</h3>
                    <small>
                      {[item.organization, item.period]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                    <p>{item.scope_detail}</p>
                    {item.description && <p>{item.description}</p>}
                    {item.valid_until && (
                      <p>
                        {expired ? "Expired" : "Valid until"}:{" "}
                        {date(item.valid_until)}
                      </p>
                    )}
                    <a
                      href={item.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {directory ? "View listing" : "View source"}
                      <ArrowUpRight size={13} />
                    </a>
                    <small className="credential-evidence">
                      {evidence[item.evidence_basis]}
                      {item.checked_at
                        ? ` · Source checked ${date(item.checked_at)}`
                        : " · Not independently reviewed"}
                    </small>
                  </div>
                  {editable && !item.catalog_key && (
                    <button
                      className="icon-button"
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
        ) : null;
      })}
      {!items.length && (
        <p className="profile-empty compact">
          No sourced credentials added yet.
        </p>
      )}
      <p className="credential-note">
        Product certificates apply to the named models. Personnel qualifications
        belong to people. Rankings and directory listings are separate from
        certifications.
      </p>
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
