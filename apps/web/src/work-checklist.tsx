import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  RotateCcw,
  Square,
} from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
import {
  AttachmentPicker,
  JobAttachments,
  attachmentError,
  type JobFile,
} from "./job-attachments";

export type WorkChecklistItem = {
  id: string;
  title: string;
  status?: "todo" | "submitted" | "approved" | "changes_requested";
  revision?: number;
  completed?: boolean;
  completedAt?: string | null;
  completedByCompanyId?: string | null;
  submissionId?: string | null;
  proofNote?: string | null;
  proofFiles?: JobFile[];
  submittedAt?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
};

type ChecklistResult = {
  workChecklist: WorkChecklistItem[];
  checklistVersion: number;
};
type ProofDraft = {
  files: File[];
  note: string;
  clientId?: string;
  submissionId?: string;
  uploaded: Record<string, true>;
  error?: string;
};
const emptyDraft = (): ProofDraft => ({ files: [], note: "", uploaded: {} });
const statusLabel = (item: WorkChecklistItem) =>
  ({
    todo: "To do",
    submitted: "Awaiting approval",
    approved: "Approved",
    changes_requested: "Changes requested",
  })[item.status || "todo"];
const dateLabel = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";

export function WorkChecklist({
  items,
  jobId,
  version = 1,
  progress = false,
  editable = false,
  reviewable = false,
  layout = "inline",
  hint,
  onChange,
  onBusyChange,
  onDraftChange,
}: {
  items: WorkChecklistItem[];
  jobId?: string;
  version?: number;
  progress?: boolean;
  editable?: boolean;
  reviewable?: boolean;
  layout?: "inline" | "workspace";
  hint?: string;
  onChange?: (items: WorkChecklistItem[], version: number) => void;
  onBusyChange?: (busy: boolean) => void;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const { company, session } = useApp();
  const contextKey = `${jobId || "preview"}:${company?.id || ""}:${session.user?.id || ""}`;
  const context = useRef(contextKey);
  context.current = contextKey;
  const alive = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const lock = useRef(false);
  const uploadIds = useRef(new WeakMap<File, string>());
  const callbacks = useRef({ onChange, onBusyChange, onDraftChange });
  callbacks.current = { onChange, onBusyChange, onDraftChange };
  const [selection, setSelection] = useState({ contextKey, id: "" });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, ProofDraft>>({});
  const draftRef = useRef(drafts);
  draftRef.current = drafts;
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [askingChanges, setAskingChanges] = useState<Record<string, boolean>>(
    {},
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [busyAction, setBusyAction] = useState<
    "send" | "review" | "release" | ""
  >("");
  const [saved, setSaved] = useState("");
  const noteFields = useRef(new Map<string, HTMLTextAreaElement>());
  const dirty =
    Object.values(drafts).some(
      (draft) => draft.files.length || draft.note.trim() || draft.clientId,
    ) || Object.values(reviewNotes).some((note) => note.trim());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requests.current.forEach((request) => request.abort());
      requests.current.clear();
      callbacks.current.onBusyChange?.(false);
      callbacks.current.onDraftChange?.(false);
    };
  }, []);
  useEffect(() => {
    requests.current.forEach((request) => request.abort());
    requests.current.clear();
    lock.current = false;
    uploadIds.current = new WeakMap();
    draftRef.current = {};
    setDrafts({});
    setReviewNotes({});
    setAskingChanges({});
    setExpanded({});
    setErrors({});
    setBusyId("");
    setBusyAction("");
    setSaved("");
    callbacks.current.onBusyChange?.(false);
    callbacks.current.onDraftChange?.(false);
  }, [contextKey]);
  useEffect(() => {
    callbacks.current.onDraftChange?.(dirty);
  }, [dirty]);

  // Keep the chosen task after refresh/review; select a useful first task only
  // for a new job/account context or when the previously selected task is gone.
  const preferredItem = () =>
    (reviewable
      ? items.find((item) => item.status === "submitted")
      : undefined) ||
    (editable
      ? items.find((item) => item.status === "changes_requested") ||
        items.find((item) => !item.status || item.status === "todo")
      : undefined) ||
    items[0];
  useEffect(() => {
    setSelection((current) => {
      if (
        current.contextKey === contextKey &&
        items.some((item) => item.id === current.id)
      )
        return current;
      const id = preferredItem()?.id || "";
      return current.contextKey === contextKey && current.id === id
        ? current
        : { contextKey, id };
    });
  }, [contextKey, items, editable, reviewable]);

  const updateDraft = (itemId: string, changes: Partial<ProofDraft>) => {
    const next = {
      ...draftRef.current,
      [itemId]: { ...(draftRef.current[itemId] || emptyDraft()), ...changes },
    };
    draftRef.current = next;
    setDrafts(next);
  };
  const clearDraft = (itemId: string) => {
    const next = { ...draftRef.current };
    delete next[itemId];
    draftRef.current = next;
    setDrafts(next);
  };
  const getUploadId = (file: File) => {
    let id = uploadIds.current.get(file);
    if (!id) {
      id = crypto.randomUUID();
      uploadIds.current.set(file, id);
    }
    return id;
  };
  const latest = async (request: AbortController) => {
    const detail = await api<{
      job: { work_checklist: WorkChecklistItem[]; checklist_version: number };
    }>(`/jobs/${jobId}`, { signal: request.signal });
    return {
      workChecklist: detail.job.work_checklist || [],
      checklistVersion: detail.job.checklist_version || 1,
    };
  };
  const releaseDraft = async (item: WorkChecklistItem, discard = false) => {
    if (!jobId || lock.current) return;
    const draft = draftRef.current[item.id];
    if (!draft) return;
    if (!draft.clientId) {
      if (discard) clearDraft(item.id);
      return;
    }
    const request = new AbortController();
    const operationContext = contextKey;
    const current = () =>
      alive.current &&
      context.current === operationContext &&
      !request.signal.aborted;
    requests.current.add(request);
    lock.current = true;
    setBusyId(item.id);
    setBusyAction("release");
    callbacks.current.onBusyChange?.(true);
    try {
      await api(`/jobs/${jobId}/checklist/${item.id}/submissions/cancel`, {
        method: "POST",
        signal: request.signal,
        body: JSON.stringify({ clientId: draft.clientId }),
      });
      if (!current()) return;
      draft.files.forEach((file) => uploadIds.current.delete(file));
      if (discard) clearDraft(item.id);
      else
        updateDraft(item.id, {
          clientId: undefined,
          submissionId: undefined,
          uploaded: {},
          error: "",
        });
      setSaved(
        discard
          ? "Unsent proof discarded."
          : "You can now change your files or note.",
      );
    } catch (error) {
      if (!current()) return;
      try {
        const result = await latest(request);
        if (!current()) return;
        callbacks.current.onChange?.(
          result.workChecklist,
          result.checklistVersion,
        );
        const updated = result.workChecklist.find(
          (task) => task.id === item.id,
        );
        if (
          draft.submissionId &&
          updated?.submissionId === draft.submissionId &&
          ["submitted", "approved", "changes_requested"].includes(
            updated.status || "",
          )
        ) {
          clearDraft(item.id);
          setSaved("This proof has already been sent for approval.");
          return;
        }
      } catch {
        if (!current()) return;
      }
      updateDraft(item.id, {
        error:
          (error as Error).message ||
          "Couldn’t release these files. Try again.",
      });
    } finally {
      requests.current.delete(request);
      if (current()) {
        lock.current = false;
        setBusyId("");
        setBusyAction("");
        callbacks.current.onBusyChange?.(false);
      }
    }
  };
  const sendProof = async (item: WorkChecklistItem) => {
    if (!jobId || !editable || lock.current) return;
    const initial = draftRef.current[item.id] || emptyDraft();
    const issue = attachmentError(initial.files);
    if (!initial.files.length || initial.files.length > 20 || issue) {
      updateDraft(item.id, {
        error:
          issue || "Add between 1 and 20 photos or PDF documents as proof.",
      });
      return;
    }
    const request = new AbortController();
    const operationContext = contextKey;
    const current = () =>
      alive.current &&
      context.current === operationContext &&
      !request.signal.aborted;
    requests.current.add(request);
    lock.current = true;
    setBusyId(item.id);
    setBusyAction("send");
    setSaved("");
    callbacks.current.onBusyChange?.(true);
    let draft = {
      ...initial,
      clientId: initial.clientId || crypto.randomUUID(),
      error: "",
    };
    updateDraft(item.id, draft);
    let published = false;
    try {
      if (!draft.submissionId) {
        const prepared = await api<{ submissionId: string }>(
          `/jobs/${jobId}/checklist/${item.id}/submissions`,
          {
            method: "POST",
            signal: request.signal,
            body: JSON.stringify({
              version,
              clientId: draft.clientId,
              note: draft.note.trim(),
              attachmentCount: draft.files.length,
            }),
          },
        );
        if (!current()) return;
        draft = { ...draft, submissionId: prepared.submissionId };
        updateDraft(item.id, { submissionId: prepared.submissionId });
      }
      for (const file of draft.files) {
        const uploadId = getUploadId(file);
        if (draft.uploaded[uploadId]) continue;
        const params = new URLSearchParams({
          updateId: draft.submissionId!,
          uploadId,
          name: file.name,
        });
        await api(`/jobs/${jobId}/files?${params}`, {
          method: "POST",
          signal: request.signal,
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        if (!current()) return;
        draft = { ...draft, uploaded: { ...draft.uploaded, [uploadId]: true } };
        updateDraft(item.id, { uploaded: draft.uploaded });
      }
      await api(`/jobs/${jobId}/updates/${draft.submissionId}/publish`, {
        method: "POST",
        signal: request.signal,
        body: JSON.stringify({}),
      });
      if (!current()) return;
      published = true;
      const result = await latest(request);
      if (!current()) return;
      callbacks.current.onChange?.(
        result.workChecklist,
        result.checklistVersion,
      );
      clearDraft(item.id);
      setSaved("Proof sent for approval.");
    } catch (error) {
      if (!current()) return;
      let delivered = published;
      try {
        const result = await latest(request);
        if (!current()) return;
        callbacks.current.onChange?.(
          result.workChecklist,
          result.checklistVersion,
        );
        const updated = result.workChecklist.find(
          (task) => task.id === item.id,
        );
        delivered ||=
          !!draft.submissionId &&
          updated?.submissionId === draft.submissionId &&
          ["submitted", "approved", "changes_requested"].includes(
            updated.status || "",
          );
      } catch {
        if (!current()) return;
      }
      if (delivered) {
        clearDraft(item.id);
        setSaved(
          "Proof sent for approval. Refresh the job if its status has not updated yet.",
        );
      } else {
        updateDraft(item.id, {
          error:
            (error as Error).message ||
            "Proof couldn’t be sent. Your files are ready to retry.",
        });
      }
    } finally {
      requests.current.delete(request);
      if (current()) {
        lock.current = false;
        setBusyId("");
        setBusyAction("");
        callbacks.current.onBusyChange?.(false);
      }
    }
  };
  const review = async (
    item: WorkChecklistItem,
    decision: "approve" | "changes",
  ) => {
    if (!jobId || !reviewable || !item.submissionId || lock.current) return;
    const note = (reviewNotes[item.id] || "").trim();
    if (decision === "changes" && !note) {
      setErrors((current) => ({
        ...current,
        [item.id]: "Tell the company what needs to change.",
      }));
      noteFields.current.get(item.id)?.focus();
      return;
    }
    const request = new AbortController();
    const operationContext = contextKey;
    const current = () =>
      alive.current &&
      context.current === operationContext &&
      !request.signal.aborted;
    requests.current.add(request);
    lock.current = true;
    setBusyId(item.id);
    setBusyAction("review");
    setSaved("");
    setErrors((current) => ({ ...current, [item.id]: "" }));
    callbacks.current.onBusyChange?.(true);
    try {
      const result = await api<ChecklistResult>(
        `/jobs/${jobId}/checklist/${item.id}/review`,
        {
          method: "POST",
          signal: request.signal,
          body: JSON.stringify({
            version,
            submissionId: item.submissionId,
            decision,
            note: decision === "changes" ? note : undefined,
          }),
        },
      );
      if (!current()) return;
      callbacks.current.onChange?.(
        result.workChecklist,
        result.checklistVersion,
      );
      setReviewNotes((current) => ({ ...current, [item.id]: "" }));
      setAskingChanges((current) => ({ ...current, [item.id]: false }));
      setSaved(
        decision === "approve"
          ? "Task approved and marked complete."
          : "Changes requested. The company can send updated proof.",
      );
    } catch (error) {
      if (!current()) return;
      try {
        const result = await latest(request);
        if (!current()) return;
        callbacks.current.onChange?.(
          result.workChecklist,
          result.checklistVersion,
        );
        const updated = result.workChecklist.find(
          (task) => task.id === item.id,
        );
        if (
          updated?.submissionId === item.submissionId &&
          updated.status ===
            (decision === "approve" ? "approved" : "changes_requested") &&
          (decision === "approve" || updated.reviewNote === note)
        ) {
          setReviewNotes((current) => ({ ...current, [item.id]: "" }));
          setAskingChanges((current) => ({ ...current, [item.id]: false }));
          setSaved(
            decision === "approve"
              ? "Task approved and marked complete."
              : "Changes requested.",
          );
          return;
        }
      } catch {
        if (!current()) return;
      }
      setErrors((current) => ({
        ...current,
        [item.id]:
          (error as Error).message ||
          "The review couldn’t be saved. Try again.",
      }));
    } finally {
      requests.current.delete(request);
      if (current()) {
        lock.current = false;
        setBusyId("");
        setBusyAction("");
        callbacks.current.onBusyChange?.(false);
      }
    }
  };

  const renderDetails = (item: WorkChecklistItem, workspace = false) => {
    const status = item.status || "todo";
    const draft = drafts[item.id] || emptyDraft();
    const canSubmit =
      editable && ["todo", "changes_requested"].includes(status);
    const canReview = reviewable && status === "submitted";
    const canAskChanges =
      reviewable && ["submitted", "approved"].includes(status);
    const hasProof = !!item.submissionId || !!item.proofFiles?.length;
    const hasDraft =
      !!draft.files.length || !!draft.note.trim() || !!draft.clientId;
    const frozen = !!draft.clientId;
    return (
      <div
        key={item.id}
        className="job-deliverable-details"
        id={`work-proof-${item.id}`}
      >
        {workspace && !hasProof && !canSubmit && !hasDraft && (
          <div className="work-checklist-waiting">
            <Clock3 size={24} aria-hidden="true" />
            <h4>Waiting for proof</h4>
            <p>
              The awarded company will add photos or documents here when this
              task is ready for approval.
            </p>
          </div>
        )}
        {hasProof && (
          <section
            className="work-proof-submission"
            aria-label="Submitted proof"
          >
            <header>
              <h4>Submitted proof</h4>
              {!workspace && dateLabel(item.submittedAt) && (
                <small>{dateLabel(item.submittedAt)}</small>
              )}
            </header>
            {item.proofNote && <p>{item.proofNote}</p>}
            <JobAttachments files={item.proofFiles || []} />
          </section>
        )}
        {status === "changes_requested" && item.reviewNote && (
          <div className="work-proof-feedback">
            <strong>Changes requested</strong>
            <p>{item.reviewNote}</p>
          </div>
        )}
        {status === "approved" && (
          <p className="work-proof-approved">
            <Check size={16} />
            Approved
            {dateLabel(item.reviewedAt)
              ? ` on ${dateLabel(item.reviewedAt)}`
              : ""}
            . This task is complete.
          </p>
        )}
        {canSubmit && (
          <div className="work-proof-form">
            <h4>
              {status === "changes_requested"
                ? "Send updated proof"
                : "Show the completed work"}
            </h4>
            <p>Add photos or documents for the hiring company to approve.</p>
            <AttachmentPicker
              files={draft.files}
              disabled={!!busyId || frozen}
              onChange={(files) => {
                if (files.length > 20)
                  updateDraft(item.id, {
                    error: "Add up to 20 files for each task.",
                  });
                else updateDraft(item.id, { files, error: "" });
              }}
              label="Add proof files or photos"
            />
            <label htmlFor={`work-proof-note-${item.id}`}>
              Note <span className="field-optional">Optional</span>
            </label>
            <textarea
              id={`work-proof-note-${item.id}`}
              rows={3}
              maxLength={3000}
              disabled={!!busyId || frozen}
              value={draft.note}
              onChange={(event) =>
                updateDraft(item.id, { note: event.target.value })
              }
              placeholder="Anything the hiring company should check?"
            />
            {frozen && (
              <p className="work-proof-upload-state">
                {Object.keys(draft.uploaded).length} of {draft.files.length}{" "}
                files uploaded.{" "}
                {busyId === item.id && busyAction === "send"
                  ? "Sending proof…"
                  : "Continue sending to finish this submission."}
              </p>
            )}
            {draft.error && (
              <p className="job-deliverables-error" role="alert">
                {draft.error}
              </p>
            )}
            <div className="work-proof-actions">
              <button
                type="button"
                className="jobs-button jobs-primary"
                disabled={!!busyId || !draft.files.length}
                onClick={() => void sendProof(item)}
              >
                {busyId === item.id && busyAction === "send"
                  ? "Sending…"
                  : frozen
                    ? "Continue sending proof"
                    : "Send for approval"}
              </button>
              {frozen && (
                <button
                  type="button"
                  className="jobs-button jobs-secondary"
                  disabled={!!busyId}
                  onClick={() => void releaseDraft(item)}
                >
                  {busyId === item.id && busyAction === "release"
                    ? "Releasing files…"
                    : "Change files or note"}
                </button>
              )}
            </div>
          </div>
        )}
        {!canSubmit && hasDraft && (
          <div className="work-proof-stale-draft">
            <p>This task has changed. Your unsent proof is still here.</p>
            {draft.error && (
              <p className="job-deliverables-error" role="alert">
                {draft.error}
              </p>
            )}
            <button
              type="button"
              className="jobs-button jobs-secondary"
              disabled={!!busyId}
              onClick={() => void releaseDraft(item, true)}
            >
              Discard unsent proof
            </button>
          </div>
        )}
        {!canAskChanges && !!reviewNotes[item.id]?.trim() && (
          <div className="work-proof-feedback">
            <strong>
              This task was reviewed. Your unsent feedback is below.
            </strong>
            <p>{reviewNotes[item.id]}</p>
            <button
              type="button"
              className="jobs-button jobs-secondary"
              disabled={!!busyId}
              onClick={() =>
                setReviewNotes((current) => ({
                  ...current,
                  [item.id]: "",
                }))
              }
            >
              Discard unsent feedback
            </button>
          </div>
        )}
        {canAskChanges && (
          <div className="work-proof-review">
            {askingChanges[item.id] ? (
              <div className="work-proof-review-note">
                <label htmlFor={`work-proof-changes-${item.id}`}>
                  What needs to change?
                </label>
                <textarea
                  id={`work-proof-changes-${item.id}`}
                  ref={(element) => {
                    if (element) noteFields.current.set(item.id, element);
                    else noteFields.current.delete(item.id);
                  }}
                  rows={3}
                  maxLength={3000}
                  value={reviewNotes[item.id] || ""}
                  disabled={!!busyId}
                  onChange={(event) =>
                    setReviewNotes((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
                  placeholder="Explain what the company should correct or add."
                />
                <div className="work-proof-actions">
                  <button
                    type="button"
                    className="jobs-button jobs-primary"
                    disabled={!!busyId}
                    onClick={() => void review(item, "changes")}
                  >
                    {busyId === item.id ? "Sending…" : "Send feedback"}
                  </button>
                  <button
                    type="button"
                    className="jobs-button jobs-secondary"
                    disabled={!!busyId}
                    onClick={() => {
                      setAskingChanges((current) => ({
                        ...current,
                        [item.id]: false,
                      }));
                      setReviewNotes((current) => ({
                        ...current,
                        [item.id]: "",
                      }));
                      setErrors((current) => ({
                        ...current,
                        [item.id]: "",
                      }));
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="work-proof-actions">
                {canReview && (
                  <button
                    type="button"
                    className="jobs-button jobs-primary"
                    disabled={!!busyId}
                    onClick={() => void review(item, "approve")}
                  >
                    {busyId === item.id
                      ? "Saving…"
                      : workspace
                        ? "Approve task"
                        : "Approve"}
                    <Check size={17} />
                  </button>
                )}
                <button
                  type="button"
                  className="jobs-button jobs-secondary"
                  disabled={!!busyId}
                  onClick={() => {
                    setAskingChanges((current) => ({
                      ...current,
                      [item.id]: true,
                    }));
                    requestAnimationFrame(() =>
                      noteFields.current.get(item.id)?.focus(),
                    );
                  }}
                >
                  Request changes
                </button>
              </div>
            )}
            {errors[item.id] && (
              <p className="job-deliverables-error" role="alert">
                {errors[item.id]}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };
  const taskIcon = (item: WorkChecklistItem) =>
    item.status === "approved" ? (
      <Check size={18} />
    ) : item.status === "submitted" ? (
      <Clock3 size={18} />
    ) : item.status === "changes_requested" ? (
      <RotateCcw size={17} />
    ) : (
      <Square size={17} />
    );

  if (!items.length) return null;
  const approved = items.filter((item) => item.status === "approved").length;
  const selectedItem =
    (selection.contextKey === contextKey &&
      items.find((item) => item.id === selection.id)) ||
    preferredItem();
  if (layout === "workspace" && progress && selectedItem) {
    const selectedDate =
      selectedItem.status === "approved"
        ? selectedItem.reviewedAt
        : selectedItem.submittedAt;
    return (
      <section className="work-checklist-workspace" aria-label="Work checklist">
        <aside className="work-checklist-rail">
          <header>
            <h3>Work checklist</h3>
          </header>
          <div className="work-checklist-progress">
            <progress
              value={approved}
              max={items.length}
              aria-label={`${approved} of ${items.length} checklist items approved`}
            />
          </div>
          <ol className="work-checklist-tasks">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`work-checklist-task is-${(item.status || "todo").replace("_", "-")}${selectedItem.id === item.id ? " is-selected" : ""}`}
                  aria-current={selectedItem.id === item.id ? true : undefined}
                  aria-controls="work-checklist-selected-detail"
                  onClick={() => setSelection({ contextKey, id: item.id })}
                >
                  <span className="work-checklist-task-icon" aria-hidden="true">
                    {taskIcon(item)}
                  </span>
                  <span className="work-checklist-task-label">
                    <strong>{item.title}</strong>
                    <small>{statusLabel(item)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <footer className="work-checklist-count">
            {approved} of {items.length} approved
          </footer>
          {hint && <p className="job-deliverables-hint">{hint}</p>}
        </aside>
        <article
          className="work-checklist-detail"
          id="work-checklist-selected-detail"
          aria-labelledby={`work-checklist-title-${selectedItem.id}`}
        >
          <header className="work-checklist-detail-heading">
            <div>
              <span className="work-checklist-task-number">
                Task{" "}
                {items.findIndex((item) => item.id === selectedItem.id) + 1} of{" "}
                {items.length}
              </span>
              <h3 id={`work-checklist-title-${selectedItem.id}`}>
                {selectedItem.title}
              </h3>
            </div>
            <span
              className={`work-proof-status status-${(selectedItem.status || "todo").replace("_", "-")}`}
            >
              {statusLabel(selectedItem)}
            </span>
            {dateLabel(selectedDate) && (
              <small className="work-checklist-date">
                {selectedItem.status === "approved" ? "Approved" : "Submitted"}{" "}
                {dateLabel(selectedDate)}
              </small>
            )}
          </header>
          {renderDetails(selectedItem, true)}
        </article>
        <p className="work-proof-save-notice" role="status">
          {saved}
        </p>
      </section>
    );
  }
  return (
    <section className="job-deliverables" aria-label="Work checklist">
      <header>
        <h3>{progress ? "Work checklist" : "What needs to be completed?"}</h3>
        {!progress && <small>{items.length} items</small>}
      </header>
      {progress && (
        <div className="job-deliverables-progress">
          <span>
            {approved} of {items.length} approved
          </span>
          <progress
            value={approved}
            max={items.length}
            aria-label={`${approved} of ${items.length} checklist items approved`}
          />
        </div>
      )}
      {hint && <p className="job-deliverables-hint">{hint}</p>}
      <ol className="job-deliverables-list">
        {items.map((item) => {
          const status = item.status || "todo";
          const draft = drafts[item.id] || emptyDraft();
          const canSubmit =
            editable && ["todo", "changes_requested"].includes(status);
          const canReview = reviewable && status === "submitted";
          const hasProof = !!item.submissionId || !!item.proofFiles?.length;
          const hasDraft =
            !!draft.files.length || !!draft.note.trim() || !!draft.clientId;
          const canExpand = progress && (canSubmit || hasProof || hasDraft);
          const isOpen = !!expanded[item.id];
          return (
            <li
              key={item.id}
              className={`job-deliverable-item${progress ? ` is-${status.replace("_", "-")}` : ""}${progress && status === "approved" ? " is-complete" : ""}`}
            >
              <div className="job-deliverable-row">
                <span className="job-deliverable-state" aria-hidden="true">
                  {progress && status === "approved" ? (
                    <Check size={18} />
                  ) : progress && status === "submitted" ? (
                    <Clock3 size={18} />
                  ) : progress && status === "changes_requested" ? (
                    <RotateCcw size={17} />
                  ) : (
                    <Square size={17} />
                  )}
                </span>
                <span className="job-deliverable-title">{item.title}</span>
                {progress && (
                  <span
                    className={`work-proof-status status-${status.replace("_", "-")}`}
                  >
                    {statusLabel(item)}
                  </span>
                )}
                {canExpand && (
                  <button
                    type="button"
                    className="work-proof-toggle"
                    aria-expanded={isOpen}
                    aria-controls={`work-proof-${item.id}`}
                    disabled={!!busyId && busyId !== item.id}
                    onClick={() =>
                      setExpanded((current) => ({
                        ...current,
                        [item.id]: !isOpen,
                      }))
                    }
                  >
                    {isOpen
                      ? "Close"
                      : canReview
                        ? "Review proof"
                        : canSubmit
                          ? status === "changes_requested"
                            ? "Update proof"
                            : "Add proof"
                          : "View proof"}
                    {isOpen ? (
                      <ChevronUp size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                  </button>
                )}
              </div>
              {canExpand && isOpen && renderDetails(item)}
            </li>
          );
        })}
      </ol>
      <p className="work-proof-save-notice" role="status">
        {saved}
      </p>
    </section>
  );
}
