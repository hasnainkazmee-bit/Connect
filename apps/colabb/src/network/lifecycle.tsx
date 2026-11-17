import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  FileText,
  Flag,
  LockKeyhole,
  Trash2,
} from "lucide-react";
import { BackButton, NetworkState, useNetworkResource } from "./common";
import { networkDelete, networkError, networkPost } from "./client";
import type { NetworkPost, NetworkList } from "./types";
export function PostLifecycle({
  id,
  mode,
  onBack,
  onDone,
}: {
  id: string;
  mode: "delete" | "report";
  onBack: () => void;
  onDone: () => void;
}) {
  const r = useNetworkResource<{ post: NetworkPost }>(`/posts/${id}`),
    [reason, setReason] = useState(""),
    [details, setDetails] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!r.data) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "delete") {
        await networkDelete(`/posts/${id}`, { version: r.data.post.version });
        onDone();
      } else {
        await networkPost(`/posts/${id}/report`, { reason, details });
        setDone(true);
      }
    } catch (e) {
      setError(networkError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="nw-task-page nw-small-task">
      <BackButton onClick={onBack} />
      {r.loading || r.error ? (
        <NetworkState loading={r.loading} error={r.error} retry={r.retry} />
      ) : done ? (
        <div className="nw-panel nw-state">
          <Check size={28} />
          <h1>Report received</h1>
          <p>Moderators will review the post. Your report is private.</p>
          <button className="nw-button" onClick={onBack}>
            Back to post
          </button>
        </div>
      ) : (
        r.data && (
          <form className="nw-panel" onSubmit={submit}>
            {mode === "delete" ? <Trash2 size={28} /> : <Flag size={28} />}
            <h1>
              {mode === "delete" ? "Delete this post?" : "Report this post"}
            </h1>
            <p>
              {mode === "delete"
                ? "This post will be removed from Network. This action cannot be undone."
                : "Help us keep Network useful and respectful. Tell us what needs a closer look."}
            </p>
            <blockquote className="nw-post-quote">
              <strong>{r.data.post.title || r.data.post.company.name}</strong>
              <p>{r.data.post.body}</p>
            </blockquote>
            {mode === "report" && (
              <>
                <label className="nw-field">
                  What’s the issue?
                  <select
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    <option value="">Choose a reason</option>
                    <option>Spam or irrelevant promotion</option>
                    <option>Misleading or inaccurate information</option>
                    <option>Harassment or abusive content</option>
                    <option>Unsafe or illegal activity</option>
                    <option>Another issue</option>
                  </select>
                </label>
                <label className="nw-field">
                  More details (optional)
                  <textarea
                    rows={4}
                    maxLength={2000}
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="Tell the moderator what to look for."
                  />
                </label>
              </>
            )}
            {error && (
              <p className="nw-error" role="alert">
                {error}
              </p>
            )}
            <div className="nw-actions">
              <button type="button" className="nw-button" onClick={onBack}>
                Cancel
              </button>
              <button
                className="nw-button nw-primary"
                disabled={
                  busy || (mode === "delete" && !r.data.post.can_delete)
                }
              >
                {busy
                  ? "Working…"
                  : mode === "delete"
                    ? "Delete post"
                    : "Send report"}
              </button>
            </div>
          </form>
        )
      )}
    </div>
  );
}
export function SourcingJobDraft({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const r = useNetworkResource<{ post: NetworkPost }>(`/posts/${id}`),
    [title, setTitle] = useState<string | null>(null),
    [description, setDescription] = useState<string | null>(null),
    [location, setLocation] = useState(""),
    [start, setStart] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<{ job_id: string; url: string } | null>(null);
  const post = r.data?.post;
  const descriptionValue =
    description ??
    (post
      ? `${post.body}${post.answers?.length ? `\n\n${post.answers.map((a) => `${a.label}: ${a.value}${a.unit ? ` ${a.unit}` : ""}`).join("\n")}` : ""}`
      : "");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!post) return;
    setBusy(true);
    setError("");
    try {
      setSaved(
        await networkPost(`/posts/${id}/job-draft`, {
          title: title ?? post.title,
          description: descriptionValue,
          location,
          start_window: start,
          file_ids: selected,
        }),
      );
    } catch (e) {
      setError(networkError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="nw-task-page">
      <BackButton onClick={onBack}>Back to discussion</BackButton>
      {r.loading || r.error ? (
        <NetworkState loading={r.loading} error={r.error} retry={r.retry} />
      ) : saved ? (
        <div className="nw-panel nw-small-task nw-state">
          <Check size={32} />
          <h1>Your job draft is ready</h1>
          <p>
            Review it in the job editor and add any remaining details. Nothing
            has been published.
          </p>
          <div className="nw-actions">
            <Link className="nw-button nw-primary" to={saved.url}>
              Continue job draft
              <ArrowRight size={17} />
            </Link>
            <button className="nw-button" onClick={onBack}>
              Back to discussion
            </button>
          </div>
        </div>
      ) : (
        post && (
          <>
            <div className="nw-section-heading">
              <h1>Turn this request into a job</h1>
              <p>
                Bring the useful details with you, then review everything before
                publishing.
              </p>
            </div>
            <div className="nw-sourcing-layout">
              <form className="nw-panel nw-form" onSubmit={submit}>
                <label className="nw-field">
                  Job title
                  <input
                    required
                    maxLength={140}
                    value={title ?? post.title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label className="nw-field">
                  Describe what you need
                  <textarea
                    required
                    rows={9}
                    value={descriptionValue}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <div className="nw-field-grid">
                  <label className="nw-field">
                    Location
                    <input
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="City, state or remote"
                    />
                  </label>
                  <label className="nw-field">
                    When do you need it?
                    <input
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                      placeholder="e.g. Within 2 weeks"
                    />
                  </label>
                </div>
                {post.files.length > 0 && (
                  <section>
                    <h2>Choose files to bring across</h2>
                    <p className="nw-muted">
                      Only selected files will be copied into the job draft.
                    </p>
                    {post.files.map((file) => (
                      <label className="nw-file-choice" key={file.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(file.id)}
                          onChange={(e) =>
                            setSelected((v) =>
                              e.target.checked
                                ? [...v, file.id]
                                : v.filter((id) => id !== file.id),
                            )
                          }
                        />
                        <FileText size={19} />
                        <span>{file.name}</span>
                      </label>
                    ))}
                  </section>
                )}
                <div className="nw-inline-notice">
                  <LockKeyhole size={18} />
                  <span>
                    Jobs can become public when published. Make sure selected
                    files are appropriate to share outside this community.
                  </span>
                </div>
                {error && <p className="nw-error">{error}</p>}
                <button className="nw-button nw-primary" disabled={busy}>
                  {busy ? "Creating draft…" : "Create job draft"}
                  <ArrowRight size={17} />
                </button>
              </form>
              <aside className="nw-panel">
                <h2>From this discussion</h2>
                <strong>{post.title}</strong>
                <p>{post.community_name}</p>
                <hr />
                <h3>What happens next</h3>
                <ol>
                  <li>Review the draft in the job editor.</li>
                  <li>Add your budget, requirements and questions.</li>
                  <li>Publish when you’re ready to receive proposals.</li>
                </ol>
                <p className="nw-muted">
                  Your original discussion stays in its community.
                </p>
              </aside>
            </div>
          </>
        )
      )}
    </div>
  );
}
export function PlatformReports({ onPost }: { onPost: (id: string) => void }) {
  type Report = {
    id: string;
    post_id: string;
    post_title: string;
    reason: string;
    details: string;
    reporter_name: string;
    status: string;
    resolution_reason?: string;
    created_at: string;
  };
  const [status, setStatus] = useState("open"),
    [revision, setRevision] = useState(0),
    [reasons, setReasons] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const r = useNetworkResource<NetworkList<Report>>(
    `/admin/reports?status=${status}`,
    revision,
  );
  async function resolve(id: string, decision: string) {
    if (!reasons[id]?.trim()) return;
    setBusy(id);
    setError("");
    try {
      await networkPost(`/reports/${id}/resolve`, {
        decision,
        reason: reasons[id],
      });
      setRevision((n) => n + 1);
    } catch (e) {
      setError(networkError(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="nw-section-heading">
        <h1>Reported company posts</h1>
        <p>Review the context and record a reason for every decision.</p>
      </div>
      <div className="nw-tabs">
        {["open", "resolved"].map((s) => (
          <button
            key={s}
            aria-current={status === s ? "page" : undefined}
            onClick={() => setStatus(s)}
          >
            {s === "open" ? "Needs review" : "History"}
          </button>
        ))}
      </div>
      {r.loading || r.error ? (
        <NetworkState loading={r.loading} error={r.error} retry={r.retry} />
      ) : !r.data?.items.length ? (
        <NetworkState title="No reports to review">
          <p>Reports on company posts appear here.</p>
        </NetworkState>
      ) : (
        r.data.items.map((report) => (
          <article className="nw-panel nw-report" key={report.id}>
            <h2>{report.post_title || "Company post"}</h2>
            <p>
              <strong>{report.reason}</strong>
            </p>
            <p>{report.details}</p>
            <button className="nw-text" onClick={() => onPost(report.post_id)}>
              Read post
              <ArrowRight size={15} />
            </button>
            {status === "open" ? (
              <>
                <label className="nw-field">
                  Reason for your decision
                  <textarea
                    rows={2}
                    required
                    value={reasons[report.id] || ""}
                    onChange={(e) =>
                      setReasons((v) => ({ ...v, [report.id]: e.target.value }))
                    }
                  />
                </label>
                <div className="nw-actions">
                  <button
                    className="nw-button"
                    disabled={busy === report.id || !reasons[report.id]?.trim()}
                    onClick={() => resolve(report.id, "keep")}
                  >
                    Keep post
                  </button>
                  <button
                    className="nw-button"
                    disabled={busy === report.id || !reasons[report.id]?.trim()}
                    onClick={() => resolve(report.id, "remove")}
                  >
                    Remove post
                  </button>
                </div>
              </>
            ) : (
              <p className="nw-inline-notice">
                {report.status}: {report.resolution_reason}
              </p>
            )}
          </article>
        ))
      )}
      {error && <p className="nw-error">{error}</p>}
    </>
  );
}
