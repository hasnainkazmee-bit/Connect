import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  FileBadge,
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  ArrowUpRight,
  ArrowLeft,
  CalendarDays,
  Check,
} from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
import { FormError, useUnsavedChanges } from "./management";
import "./profile-credentials-editor.css";
import type { Company, Credential, Insurance, License, Profile } from "./types";

export const usStates = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "District of Columbia",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
];
const licenseTypes = [
  "Electrical contractor",
  "General contractor",
  "Solar contractor",
  "Roofing contractor",
  "Professional engineer",
  "Master electrician",
];
const coverageTypes = [
  "General liability",
  "Workers’ compensation",
  "Professional liability",
  "Commercial auto",
  "Umbrella liability",
];
const categories: Record<Credential["category"], string> = {
  certification: "Certification",
  qualification: "Qualification",
  membership: "Membership",
  directory: "Directory listing",
  ranking: "Ranking",
};
export const recordDate = (date?: string | null) =>
  date
    ? new Date(date + "T12:00:00").toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";
export const credentialsPath = "/settings/profile/credentials";
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
function RecordExpiry({
  date,
  forever,
}: {
  date?: string | null;
  forever?: boolean;
}) {
  if (!date && !forever) return null;
  const expired = !!date && date < today();
  return (
    <span className={`credential-expiry${expired ? " expired" : ""}`}>
      {forever ? <Check size={14} /> : <CalendarDays size={14} />}
      {forever
        ? "Does not expire"
        : `${expired ? "Expired" : "Expires"} ${recordDate(date)}`}
    </span>
  );
}
function RecordGroup({
  title,
  description,
  kind,
  count,
  children,
}: {
  title: string;
  description: string;
  kind: string;
  count: number;
  children: ReactNode;
}) {
  const Icon = kind === "insurance" ? ShieldCheck : FileBadge;
  const singular =
    kind === "licenses"
      ? "license"
      : kind === "insurance"
        ? "insurance"
        : "certification";
  return (
    <section className="credential-record-group">
      <header className="credential-group-heading">
        <span className="credential-group-icon">
          <Icon size={22} />
        </span>
        <div>
          <h2>
            {title}
            <span className="credential-record-count">{count}</span>
          </h2>
          <p>{description}</p>
        </div>
        <Link
          className="button credential-add"
          to={`${credentialsPath}/${kind}/new`}
        >
          <Plus size={18} /> Add {singular}
        </Link>
      </header>
      <div className="credential-record-list">{children}</div>
    </section>
  );
}
function RecordActions({
  kind,
  id,
  title,
}: {
  kind: string;
  id: string;
  title: string;
}) {
  const { refresh, toast } = useApp();
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/companies/current/${kind === "certifications" ? "credentials" : kind}/${id}`,
        { method: "DELETE" },
      );
      refresh();
      toast("Record removed from your profile.");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div
      className={`credential-record-actions${removing ? " is-removing" : ""}`}
    >
      {removing ? (
        <>
          <p>
            Remove <strong>{title}</strong> from your profile?
          </p>
          <div>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setRemoving(false)}
            >
              Keep it
            </button>
            <button
              type="button"
              className="button credential-remove-confirm"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? "Removing…" : "Remove"}
            </button>
          </div>
        </>
      ) : (
        <>
          <Link
            className="button"
            aria-label={`Edit ${title}`}
            to={`${credentialsPath}/${kind}/${id}`}
          >
            <Pencil size={16} /> Edit
          </Link>
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${title}`}
            onClick={() => setRemoving(true)}
          >
            <Trash2 size={17} />
          </button>
        </>
      )}
      <FormError error={error} />
    </div>
  );
}
function SourcedCredential({ record: r }: { record: Credential }) {
  return (
    <section className="credential-sourced-detail">
      <Link className="credential-back" to={credentialsPath}>
        <ArrowLeft size={17} /> Licenses & certifications
      </Link>
      <header>
        <span className="credential-record-category">
          {categories[r.category]}
        </span>
        <h2>{r.title}</h2>
        <p>{r.organization}</p>
      </header>
      <dl>
        <div>
          <dt>Applies to</dt>
          <dd>
            {r.scope_detail ||
              (r.scope === "company"
                ? "Company"
                : r.scope === "personnel"
                  ? "Team members"
                  : "Product")}
          </dd>
        </div>
        {r.credential_number && (
          <div>
            <dt>Credential number</dt>
            <dd>{r.credential_number}</dd>
          </div>
        )}
        {r.valid_until && (
          <div>
            <dt>Expiry</dt>
            <dd>
              <RecordExpiry date={r.valid_until} forever={r.does_not_expire} />
            </dd>
          </div>
        )}
        {r.description && (
          <div>
            <dt>Details</dt>
            <dd>{r.description}</dd>
          </div>
        )}
      </dl>
      <p className="credential-sourced-note">
        This record was added from a public source. Your own certifications can
        be added separately.
      </p>
      {r.source_url && (
        <a
          className="button"
          href={r.source_url}
          target="_blank"
          rel="noreferrer"
        >
          View source <ArrowUpRight size={16} />
        </a>
      )}
    </section>
  );
}
export function ProfileRecords({
  profile,
  company,
  legacyLicense,
  legacyInsurance,
}: {
  profile: Profile;
  company: Company;
  legacyLicense?: string;
  legacyInsurance?: string;
}) {
  const { "*": subpage = "" } = useParams();
  const navigate = useNavigate();
  const done = () => navigate(credentialsPath, { replace: true });
  if (subpage) {
    const [kind, id, extra] = subpage.split("/");
    const license = profile.licenses?.find((r) => r.id === id);
    const certification = profile.credentials?.find((r) => r.id === id);
    const insurance = profile.insurance?.find((r) => r.id === id);
    const key = company.id + subpage;
    if (!extra && kind === "licenses" && (id === "new" || license))
      return (
        <LicenseEditor
          key={key}
          company={company}
          record={license}
          onDone={done}
        />
      );
    if (
      !extra &&
      kind === "certifications" &&
      (id === "new" || certification)
    ) {
      if (certification && certification.catalog_key !== null)
        return <SourcedCredential record={certification} />;
      return (
        <CertificationEditor
          key={key}
          company={company}
          record={certification}
          onDone={done}
        />
      );
    }
    if (!extra && kind === "insurance" && (id === "new" || insurance))
      return (
        <InsuranceEditor
          key={key}
          company={company}
          record={insurance}
          onDone={done}
        />
      );
    return (
      <section className="credential-not-found">
        <h2>Record not found</h2>
        <p>It may have been removed from your company profile.</p>
        <Link className="button" to={credentialsPath}>
          <ArrowLeft size={17} /> Back to licenses & certifications
        </Link>
      </section>
    );
  }
  return (
    <div className="profile-credentials">
      <div className="credential-section-intro">
        <h2>Licenses & certifications</h2>
        <p>Keep the qualifications customers look for in one place.</p>
      </div>
      <RecordGroup
        title="Licenses"
        description="Your contractor, trade and professional licenses."
        kind="licenses"
        count={profile.licenses?.length || 0}
      >
        {profile.licenses?.map((r) => (
          <article className="credential-record" key={r.id}>
            <div className="credential-record-copy">
              <h3>
                {r.license_type}
                {r.classification ? " · " + r.classification : ""}
              </h3>
              <p>
                {r.jurisdiction} · License #{r.license_number}
              </p>
              <span className="credential-record-issuer">{r.authority}</span>
              <RecordExpiry date={r.expires_on} forever={r.does_not_expire} />
            </div>
            <RecordActions kind="licenses" id={r.id} title={r.license_type} />
          </article>
        ))}
        {!profile.licenses?.length && (
          <p className="credential-empty">
            No licenses added yet. Add the license type, number and issuing
            authority.
          </p>
        )}
        {legacyLicense && (
          <details className="credential-legacy">
            <summary>Previously added license information</summary>
            <p>{legacyLicense}</p>
          </details>
        )}
      </RecordGroup>
      <RecordGroup
        title="Certifications"
        description="Qualifications held by your company, people or products."
        kind="certifications"
        count={profile.credentials?.length || 0}
      >
        {profile.credentials?.map((r) => (
          <article className="credential-record" key={r.id}>
            <div className="credential-record-copy">
              <span className="credential-record-category">
                {categories[r.category]}
                {r.scope === "personnel"
                  ? " · Team member"
                  : r.scope === "product"
                    ? " · Product"
                    : ""}
              </span>
              <h3>{r.title}</h3>
              <p>
                {[r.organization, r.scope !== "company" ? r.scope_detail : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <RecordExpiry date={r.valid_until} forever={r.does_not_expire} />
            </div>
            {r.catalog_key === null ? (
              <RecordActions kind="certifications" id={r.id} title={r.title} />
            ) : (
              <div className="credential-source-actions">
                <Link
                  className="button"
                  to={`${credentialsPath}/certifications/${r.id}`}
                >
                  View details
                </Link>
                <span>From a public source</span>
              </div>
            )}
          </article>
        ))}
        {!profile.credentials?.length && (
          <p className="credential-empty">
            No certifications added yet. Add NABCEP, manufacturer training or
            another credential.
          </p>
        )}
      </RecordGroup>
      <RecordGroup
        title="Insurance"
        description="Coverage details customers can see on your profile."
        kind="insurance"
        count={profile.insurance?.length || 0}
      >
        {profile.insurance?.map((r) => (
          <article className="credential-record" key={r.id}>
            <div className="credential-record-copy">
              <h3>{r.coverage_type}</h3>
              <p>{r.insurer}</p>
              {r.coverage_limit && (
                <span className="credential-insurance-limit">
                  {new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: r.currency,
                    maximumFractionDigits: 0,
                  }).format(r.coverage_limit)}
                  {r.limit_basis === "per_occurrence"
                    ? " per occurrence"
                    : r.limit_basis === "aggregate"
                      ? " total policy limit"
                      : ""}
                </span>
              )}
              <RecordExpiry date={r.expires_on} />
            </div>
            <RecordActions kind="insurance" id={r.id} title={r.coverage_type} />
          </article>
        ))}
        {!profile.insurance?.length && (
          <p className="credential-empty">
            No insurance added yet. Add general liability, workers’ compensation
            or other coverage.
          </p>
        )}
        {legacyInsurance && (
          <details className="credential-legacy">
            <summary>Previously added insurance information</summary>
            <p>{legacyInsurance}</p>
          </details>
        )}
      </RecordGroup>
    </div>
  );
}
function ChoiceWithOther({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const custom = value !== "" && !options.includes(value);
  return (
    <div className="credential-choice">
      <label>
        {label}
        <select
          required
          value={custom ? "other" : value}
          onChange={(e) =>
            onChange(e.target.value === "other" ? "Other" : e.target.value)
          }
        >
          <option value="">Choose {label.toLowerCase()}</option>
          {options.map((v) => (
            <option key={v}>{v}</option>
          ))}
          <option value="other">Other</option>
        </select>
      </label>
      {custom && (
        <label>
          <span className="workspace-label">Other {label.toLowerCase()}</span>
          <input
            required
            minLength={2}
            maxLength={180}
            value={value === "Other" ? "" : value}
            placeholder={`Enter ${label.toLowerCase()}`}
            onChange={(e) => onChange(e.target.value || "Other")}
          />
        </label>
      )}
    </div>
  );
}
function RecordSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="credential-form-section">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}
function RecordForm({
  title,
  description,
  path,
  recordId,
  body,
  dirty,
  children,
  onDone,
}: {
  title: string;
  description: string;
  path: string;
  recordId?: string;
  body: unknown;
  dirty: boolean;
  children: ReactNode;
  onDone?: () => void;
}) {
  const { close, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [finished, setFinished] = useState(false);
  useUnsavedChanges(dirty && !finished, busy && !finished);
  useEffect(() => {
    if (finished && !busy) onDone ? onDone() : close(true);
  }, [finished, busy, onDone, close]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/companies/current/" + path + (recordId ? "/" + recordId : ""),
        { method: recordId ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      setFinished(true);
      refresh();
      toast(
        recordId ? "Record updated." : "Record added to your company profile.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="workspace-form record-editor credential-editor"
      onSubmit={save}
    >
      {onDone && (
        <Link className="credential-back" to={credentialsPath}>
          <ArrowLeft size={17} /> Licenses & certifications
        </Link>
      )}
      <header className="workspace-section-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <fieldset disabled={busy || finished} className="record-fields">
        {children}
      </fieldset>
      <FormError error={error} />
      <footer className="workspace-save-bar">
        <button
          type="button"
          className="button"
          onClick={() => (onDone ? onDone() : close())}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          className="button primary"
          type="submit"
          disabled={busy || finished}
        >
          {busy
            ? "Saving…"
            : "Save " +
              (path === "credentials"
                ? "certification"
                : path === "licenses"
                  ? "license"
                  : "insurance")}
        </button>
      </footer>
    </form>
  );
}
function DateFields({
  issued,
  expires,
  forever,
  onChange,
}: {
  issued: string;
  expires: string;
  forever: boolean;
  onChange: (v: {
    issued?: string;
    expires?: string;
    forever?: boolean;
  }) => void;
}) {
  return (
    <>
      <div className="workspace-field-pair">
        <label>
          <span className="workspace-label">
            Issue date <small>Optional</small>
          </span>
          <input
            type="date"
            value={issued}
            max={expires || undefined}
            onChange={(e) => onChange({ issued: e.target.value })}
          />
        </label>
        <label>
          <span className="workspace-label">
            Expiry date <small>Optional</small>
          </span>
          <input
            type="date"
            value={expires}
            min={issued || undefined}
            disabled={forever}
            onChange={(e) => onChange({ expires: e.target.value })}
          />
        </label>
      </div>
      <label className="record-checkbox">
        <input
          type="checkbox"
          checked={forever}
          onChange={(e) =>
            onChange({
              forever: e.target.checked,
              ...(e.target.checked ? { expires: "" } : {}),
            })
          }
        />
        Does not expire
      </label>
    </>
  );
}
export function LicenseEditor({
  company,
  record: r,
  onDone,
}: {
  company: Company;
  record?: License;
  onDone?: () => void;
}) {
  const [f, set] = useState(() => ({
    licenseType: r?.license_type || "",
    licenseNumber: r?.license_number || "",
    authority: r?.authority || "",
    jurisdiction: r?.jurisdiction || "",
    holder: r?.holder || company.name,
    classification: r?.classification || "",
    issued: r?.issued_on || "",
    expires: r?.expires_on || "",
    forever: r?.does_not_expire || false,
    verificationUrl: r?.verification_url || "",
  }));
  const [initial] = useState(JSON.stringify(f));
  const change = (v: Partial<typeof f>) => set((s) => ({ ...s, ...v }));
  const body = {
    expectedCompanyId: company.id,
    licenseType: f.licenseType,
    licenseNumber: f.licenseNumber,
    authority: f.authority,
    jurisdiction: f.jurisdiction,
    holder: f.holder,
    classification: f.classification,
    issuedOn: f.issued || null,
    expiresOn: f.expires || null,
    doesNotExpire: f.forever,
    verificationUrl: f.verificationUrl,
  };
  return (
    <RecordForm
      title={r ? "Edit license" : "Add a license"}
      description="Enter the details as they appear on your license."
      path="licenses"
      recordId={r?.id}
      body={body}
      dirty={JSON.stringify(f) !== initial}
      onDone={onDone}
    >
      <RecordSection title="License details">
        <ChoiceWithOther
          label="License type"
          value={f.licenseType}
          onChange={(licenseType) => change({ licenseType })}
          options={licenseTypes}
        />
        <div className="workspace-field-pair">
          <label>
            License number
            <input
              type="text"
              autoCapitalize="characters"
              spellCheck={false}
              required
              maxLength={100}
              value={f.licenseNumber}
              onChange={(e) => change({ licenseNumber: e.target.value })}
              placeholder="e.g. EC-012345"
            />
          </label>
          <label>
            <span className="workspace-label">
              Class or designation <small>Optional</small>
            </span>
            <input
              maxLength={120}
              value={f.classification}
              onChange={(e) => change({ classification: e.target.value })}
              placeholder="e.g. C-10"
            />
          </label>
        </div>
        <ChoiceWithOther
          label="State, province or jurisdiction"
          value={f.jurisdiction}
          onChange={(jurisdiction) => change({ jurisdiction })}
          options={[
            ...usStates,
            "Alberta",
            "British Columbia",
            "Manitoba",
            "New Brunswick",
            "Newfoundland and Labrador",
            "Northwest Territories",
            "Nova Scotia",
            "Nunavut",
            "Ontario",
            "Prince Edward Island",
            "Quebec",
            "Saskatchewan",
            "Yukon",
          ]}
        />
        <label>
          Issuing authority
          <input
            required
            minLength={2}
            maxLength={180}
            value={f.authority}
            onChange={(e) => change({ authority: e.target.value })}
            placeholder="e.g. Texas Department of Licensing and Regulation"
          />
        </label>
        <label>
          License holder
          <input
            required
            minLength={2}
            maxLength={180}
            value={f.holder}
            onChange={(e) => change({ holder: e.target.value })}
          />
          <small>Company or qualified professional named on the license.</small>
        </label>
      </RecordSection>
      <RecordSection title="Dates & verification">
        <DateFields
          issued={f.issued}
          expires={f.expires}
          forever={f.forever}
          onChange={change}
        />
        <label>
          <span className="workspace-label">
            Verification link <small>Optional</small>
          </span>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            pattern="https://.*"
            maxLength={2000}
            value={f.verificationUrl}
            onChange={(e) => change({ verificationUrl: e.target.value })}
            placeholder="https://…"
          />
          <small>
            A public link to the issuing authority’s license record.
          </small>
        </label>
      </RecordSection>
    </RecordForm>
  );
}
export function CertificationEditor({
  company,
  record: r,
  onDone,
}: {
  company: Company;
  record?: Credential;
  onDone?: () => void;
}) {
  const [f, set] = useState(() => ({
    category: r?.category || "certification",
    title: r?.title || "",
    organization: r?.organization || "",
    scope: r?.scope || "company",
    scopeDetail:
      r?.scope_detail || (!r || r.scope === "company" ? company.name : ""),
    credentialNumber: r?.credential_number || "",
    issued: r?.issued_on || "",
    expires: r?.valid_until || "",
    forever: r?.does_not_expire || false,
    sourceUrl: r?.source_url || "",
  }));
  const [initial] = useState(JSON.stringify(f));
  const change = (v: Partial<typeof f>) => set((s) => ({ ...s, ...v }));
  const body = {
    expectedCompanyId: company.id,
    category: f.category,
    title: f.title,
    organization: f.organization,
    scope: f.scope,
    scopeDetail: f.scopeDetail,
    credentialNumber: f.credentialNumber,
    issuedOn: f.issued || null,
    validUntil: f.expires || null,
    doesNotExpire: f.forever,
    sourceUrl: f.sourceUrl,
    description: r?.description || "",
    period: r?.period || "",
  };
  return (
    <RecordForm
      title={r ? "Edit certification" : "Add a certification"}
      description="Show the credential and who it applies to."
      path="credentials"
      recordId={r?.id}
      body={body}
      dirty={JSON.stringify(f) !== initial}
      onDone={onDone}
    >
      <RecordSection title="Certification details">
        <label>
          {categories[f.category]} name
          <input
            required
            minLength={2}
            maxLength={180}
            value={f.title}
            onChange={(e) => change({ title: e.target.value })}
            placeholder="e.g. NABCEP PV Installation Professional"
            list="credential-names"
          />
          <datalist id="credential-names">
            {[
              "NABCEP PV Installation Professional",
              "Enphase Certified Installer",
              "Tesla Certified Installer",
              "SolarEdge Certified Installer",
            ].map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        <div className="workspace-field-pair">
          <label>
            <span className="workspace-label">
              Issued by <small>Optional</small>
            </span>
            <input
              maxLength={180}
              value={f.organization}
              onChange={(e) => change({ organization: e.target.value })}
              placeholder="e.g. NABCEP"
            />
          </label>
          <label>
            Credential type
            <select
              value={f.category}
              onChange={(e) =>
                change({ category: e.target.value as Credential["category"] })
              }
            >
              {Object.entries(categories).map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      </RecordSection>
      <RecordSection title="Who holds this credential?">
        <label>
          Applies to
          <select
            value={f.scope}
            onChange={(e) =>
              change({
                scope: e.target.value as Credential["scope"],
                scopeDetail: e.target.value === "company" ? company.name : "",
              })
            }
          >
            <option value="company">Our company</option>
            <option value="personnel">A member of our team</option>
            <option value="product">A specific product</option>
          </select>
        </label>
        <label>
          {f.scope === "personnel"
            ? "Certified person’s name"
            : f.scope === "product"
              ? "Product or model"
              : "Company name"}
          <input
            required
            minLength={2}
            maxLength={600}
            value={f.scopeDetail}
            onChange={(e) => change({ scopeDetail: e.target.value })}
          />
        </label>
      </RecordSection>
      <RecordSection title="Dates & verification">
        <label>
          <span className="workspace-label">
            Credential number <small>Optional</small>
          </span>
          <input
            type="text"
            maxLength={100}
            spellCheck={false}
            value={f.credentialNumber}
            onChange={(e) => change({ credentialNumber: e.target.value })}
          />
        </label>
        <DateFields
          issued={f.issued}
          expires={f.expires}
          forever={f.forever}
          onChange={change}
        />
        <label>
          <span className="workspace-label">
            Verification link <small>Optional</small>
          </span>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            pattern="https://.*"
            maxLength={2000}
            value={f.sourceUrl}
            onChange={(e) => change({ sourceUrl: e.target.value })}
            placeholder="https://…"
          />
        </label>
      </RecordSection>
    </RecordForm>
  );
}
export function InsuranceEditor({
  company,
  record: r,
  onDone,
}: {
  company: Company;
  record?: Insurance;
  onDone?: () => void;
}) {
  const [f, set] = useState(() => ({
    coverageType: r?.coverage_type || "",
    insurer: r?.insurer || "",
    coverageLimit: r?.coverage_limit ? String(r.coverage_limit) : "",
    currency: r?.currency || "USD",
    limitBasis: r?.limit_basis || "",
    expires: r?.expires_on || "",
    verificationUrl: r?.verification_url || "",
  }));
  const [initial] = useState(JSON.stringify(f));
  const change = (v: Partial<typeof f>) => set((s) => ({ ...s, ...v }));
  const body = {
    expectedCompanyId: company.id,
    coverageType: f.coverageType,
    insurer: f.insurer,
    coverageLimit: f.coverageLimit ? Number(f.coverageLimit) : null,
    currency: f.currency,
    limitBasis: f.limitBasis,
    expiresOn: f.expires,
    verificationUrl: f.verificationUrl,
  };
  return (
    <RecordForm
      title={r ? "Edit insurance" : "Add insurance"}
      description="Add your insurance company, coverage and expiry date."
      path="insurance"
      recordId={r?.id}
      body={body}
      dirty={JSON.stringify(f) !== initial}
      onDone={onDone}
    >
      <RecordSection title="Policy details">
        <ChoiceWithOther
          label="Coverage type"
          value={f.coverageType}
          onChange={(coverageType) => change({ coverageType })}
          options={coverageTypes}
        />
        <label>
          Insurance company
          <input
            required
            minLength={2}
            maxLength={180}
            value={f.insurer}
            onChange={(e) => change({ insurer: e.target.value })}
          />
        </label>
      </RecordSection>
      <RecordSection title="Coverage & expiry">
        <div className="workspace-field-pair">
          <label>
            <span className="workspace-label">
              Coverage limit <small>Optional</small>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              max="1000000000000"
              value={f.coverageLimit}
              onChange={(e) => change({ coverageLimit: e.target.value })}
              placeholder="e.g. 1000000"
              aria-describedby="coverage-limit-help"
            />
            <small id="coverage-limit-help">
              Enter the amount without a currency symbol.
            </small>
          </label>
          <label>
            Currency
            <select
              value={f.currency}
              onChange={(e) =>
                change({ currency: e.target.value as Insurance["currency"] })
              }
            >
              <option value="USD">USD — US dollars</option>
              <option value="CAD">CAD — Canadian dollars</option>
            </select>
          </label>
        </div>
        <div className="workspace-field-pair">
          <label>
            <span className="workspace-label">
              Limit applies <small>Optional</small>
            </span>
            <select
              value={f.limitBasis}
              onChange={(e) =>
                change({
                  limitBasis: e.target.value as Insurance["limit_basis"],
                })
              }
            >
              <option value="">Not specified</option>
              <option value="per_occurrence">Per occurrence</option>
              <option value="aggregate">Total policy limit</option>
              <option value="statutory">Statutory coverage</option>
            </select>
          </label>
          <label>
            Policy expiry date
            <input
              type="date"
              required
              value={f.expires}
              onChange={(e) => change({ expires: e.target.value })}
            />
          </label>
        </div>
        <label>
          <span className="workspace-label">
            Public coverage link <small>Optional</small>
          </span>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            pattern="https://.*"
            maxLength={2000}
            value={f.verificationUrl}
            onChange={(e) => change({ verificationUrl: e.target.value })}
            placeholder="https://…"
          />
        </label>
      </RecordSection>
    </RecordForm>
  );
}
