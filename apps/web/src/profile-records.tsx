import { useState, type FormEvent, type ReactNode } from "react";
import {
  FileBadge,
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
import { ConfirmAction, FormError, useUnsavedChanges } from "./management";
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
const validity = (expires?: string | null, forever?: boolean) =>
  forever
    ? "Does not expire"
    : expires
      ? `${expires < new Date().toLocaleDateString("en-CA") ? "Expired" : "Expires"} ${recordDate(expires)}`
      : "";

function RecordGroup({
  title,
  description,
  add,
  children,
}: {
  title: string;
  description: string;
  add: () => void;
  children: ReactNode;
}) {
  return (
    <section className="workspace-record-group">
      <header className="workspace-section-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button type="button" className="button" onClick={add}>
          <Plus size={18} />
          Add{" "}
          {title === "Licenses"
            ? "license"
            : title === "Insurance"
              ? "insurance"
              : "certification"}
        </button>
      </header>
      {children}
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
  const { open } = useApp();
  const actions = (
    kind: string,
    id: string,
    title: string,
    editor: ReactNode,
  ) => (
    <div className="record-actions">
      <button
        className="button"
        aria-label={"Edit " + title}
        onClick={() => open(editor)}
      >
        <Pencil size={16} />
        Edit
      </button>
      <button
        className="icon-button"
        aria-label={"Remove " + title}
        onClick={() =>
          open(
            <ConfirmAction
              title={"Remove " + title + "?"}
              description="This record will be removed from your company profile."
              label="Remove"
              action={() =>
                api("/companies/current/" + kind + "/" + id, {
                  method: "DELETE",
                })
              }
            />,
          )
        }
      >
        <Trash2 size={17} />
      </button>
    </div>
  );
  return (
    <div className="profile-record-groups">
      <RecordGroup
        title="Licenses"
        description="Add each license separately, including the state or area where it applies."
        add={() => open(<LicenseEditor company={company} />)}
      >
        {profile.licenses?.map((r) => (
          <article className="workspace-record" key={r.id}>
            <FileBadge size={22} />
            <div>
              <strong>
                {r.license_type}
                {r.classification ? " · " + r.classification : ""}
              </strong>
              <p>
                {r.jurisdiction} · #{r.license_number}
              </p>
              <small>
                {[r.authority, validity(r.expires_on, r.does_not_expire)]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </div>
            {actions(
              "licenses",
              r.id,
              r.license_type,
              <LicenseEditor company={company} record={r} />,
            )}
          </article>
        ))}
        {!profile.licenses?.length && (
          <p className="record-empty">
            Your contractor, trade, or professional licenses go here.
          </p>
        )}
        {legacyLicense && (
          <details className="record-legacy">
            <summary>Previously added license information</summary>
            <p>{legacyLicense}</p>
          </details>
        )}
      </RecordGroup>
      <RecordGroup
        title="Certifications"
        description="Add certifications held by your company, your team, or a specific product."
        add={() => open(<CertificationEditor company={company} />)}
      >
        {profile.credentials?.map((r) => (
          <article className="workspace-record" key={r.id}>
            <FileBadge size={22} />
            <div>
              <small>{categories[r.category]}</small>
              <strong>{r.title}</strong>
              <p>
                {[r.organization, r.scope !== "company" ? r.scope_detail : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <small>{validity(r.valid_until, r.does_not_expire)}</small>
            </div>
            {r.catalog_key === null ? (
              actions(
                "credentials",
                r.id,
                r.title,
                <CertificationEditor company={company} record={r} />,
              )
            ) : r.source_url ? (
              <a href={r.source_url} target="_blank" rel="noreferrer">
                Source <ArrowUpRight size={15} />
              </a>
            ) : null}
          </article>
        ))}
        {!profile.credentials?.length && (
          <p className="record-empty">
            Add your first certification, such as NABCEP or a manufacturer
            training credential.
          </p>
        )}
      </RecordGroup>
      <RecordGroup
        title="Insurance"
        description="Show the coverage you carry. Policy numbers stay out of your public profile."
        add={() => open(<InsuranceEditor company={company} />)}
      >
        {profile.insurance?.map((r) => (
          <article className="workspace-record" key={r.id}>
            <ShieldCheck size={22} />
            <div>
              <strong>{r.coverage_type}</strong>
              <p>
                {r.insurer}
                {r.coverage_limit
                  ? " · " +
                    new Intl.NumberFormat(undefined, {
                      style: "currency",
                      currency: r.currency,
                      maximumFractionDigits: 0,
                    }).format(r.coverage_limit)
                  : ""}
              </p>
              <small>{validity(r.expires_on)}</small>
            </div>
            {actions(
              "insurance",
              r.id,
              r.coverage_type,
              <InsuranceEditor company={company} record={r} />,
            )}
          </article>
        ))}
        {!profile.insurance?.length && (
          <p className="record-empty">
            Add general liability, workers’ compensation, or other coverage.
          </p>
        )}
        {legacyInsurance && (
          <details className="record-legacy">
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
      {custom && (
        <input
          aria-label={"Other " + label.toLowerCase()}
          required
          minLength={2}
          maxLength={180}
          value={value === "Other" ? "" : value}
          placeholder={"Enter " + label.toLowerCase()}
          onChange={(e) => onChange(e.target.value || "Other")}
        />
      )}
    </label>
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
}: {
  title: string;
  description: string;
  path: string;
  recordId?: string;
  body: unknown;
  dirty: boolean;
  children: ReactNode;
}) {
  const { close, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useUnsavedChanges(dirty, busy);
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
      refresh();
      close(true);
      toast("Company profile updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="workspace-form record-editor" onSubmit={save}>
      <header className="workspace-section-heading">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <fieldset disabled={busy} className="record-fields">
        {children}
      </fieldset>
      <FormError error={error} />
      <footer className="workspace-save-bar">
        <button
          type="button"
          className="button"
          onClick={() => close()}
          disabled={busy}
        >
          Cancel
        </button>
        <button className="button primary" type="submit" disabled={busy}>
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
          Issue date <small>Optional</small>
          <input
            type="date"
            value={issued}
            max={expires || undefined}
            onChange={(e) => onChange({ issued: e.target.value })}
          />
        </label>
        <label>
          Expiry date <small>Optional</small>
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
        This does not expire
      </label>
    </>
  );
}
export function LicenseEditor({
  company,
  record: r,
}: {
  company: Company;
  record?: License;
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
    >
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
          Class or designation <small>Optional</small>
          <input
            maxLength={120}
            value={f.classification}
            onChange={(e) => change({ classification: e.target.value })}
            placeholder="e.g. C-10"
          />
        </label>
      </div>
      <ChoiceWithOther
        label="State or jurisdiction"
        value={f.jurisdiction}
        onChange={(jurisdiction) => change({ jurisdiction })}
        options={usStates}
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
      <DateFields
        issued={f.issued}
        expires={f.expires}
        forever={f.forever}
        onChange={change}
      />
      <label>
        Verification link <small>Optional</small>
        <input
          type="url"
          maxLength={2000}
          value={f.verificationUrl}
          onChange={(e) => change({ verificationUrl: e.target.value })}
          placeholder="https://…"
        />
        <small>A public link to the issuing authority’s license record.</small>
      </label>
    </RecordForm>
  );
}
export function CertificationEditor({
  company,
  record: r,
}: {
  company: Company;
  record?: Credential;
}) {
  const [f, set] = useState(() => ({
    category: r?.category || "certification",
    title: r?.title || "",
    organization: r?.organization || "",
    scope: r?.scope || "company",
    scopeDetail: r?.scope_detail || company.name,
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
    >
      <label>
        Certification name
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
          Issued by
          <input
            required
            minLength={2}
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
      <label>
        Credential number <small>Optional</small>
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
        Verification link <small>Optional</small>
        <input
          type="url"
          maxLength={2000}
          value={f.sourceUrl}
          onChange={(e) => change({ sourceUrl: e.target.value })}
          placeholder="https://…"
        />
      </label>
    </RecordForm>
  );
}
export function InsuranceEditor({
  company,
  record: r,
}: {
  company: Company;
  record?: Insurance;
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
      description="Share your coverage without publishing policy numbers or private documents."
      path="insurance"
      recordId={r?.id}
      body={body}
      dirty={JSON.stringify(f) !== initial}
    >
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
      <div className="workspace-field-pair">
        <label>
          Coverage limit <small>Optional</small>
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            max="1000000000000"
            value={f.coverageLimit}
            onChange={(e) => change({ coverageLimit: e.target.value })}
            placeholder="e.g. 1000000"
          />
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
          Limit applies
          <select
            value={f.limitBasis}
            onChange={(e) =>
              change({ limitBasis: e.target.value as Insurance["limit_basis"] })
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
        Public coverage link <small>Optional</small>
        <input
          type="url"
          maxLength={2000}
          value={f.verificationUrl}
          onChange={(e) => change({ verificationUrl: e.target.value })}
          placeholder="https://…"
        />
      </label>
    </RecordForm>
  );
}
