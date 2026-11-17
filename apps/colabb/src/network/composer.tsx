import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Cropper, { type Area } from "react-easy-crop";
import {
  Check,
  FileText,
  Globe2,
  ImagePlus,
  Info,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useApp } from "../context";
import { usePageGuard } from "../page-navigation";
import { flushSync } from "react-dom";
import { BackButton, CompanyLogo, NetworkState } from "./common";
import {
  networkApi,
  networkDelete,
  networkError,
  networkPatch,
  networkPost,
  networkFileSize,
  networkReadDraft,
} from "./client";
import { MentionInput } from "./mentions";
import { NetworkMedia, networkFileUrl } from "./media";
import type {
  NetworkAttachment,
  NetworkBootstrap,
  NetworkCommunity,
  NetworkDraft,
  NetworkList,
  NetworkPost,
  NetworkPostInput,
  NetworkTopicField,
} from "./types";
const fresh = (communityId?: string, topicId?: string): NetworkPostInput => ({
  client_id: crypto.randomUUID(),
  community_id: communityId || undefined,
  kind: "post",
  title: "",
  body: "",
  topic_id: topicId || undefined,
  answers: [],
  file_ids: [],
  media_format: "4:5",
  comments_open: true,
});
type Upload = {
  id: string;
  file: File;
  state: "uploading" | "error";
  error?: string;
};
export function NetworkComposer({
  draftId,
  editId,
  initialCommunityId,
  initialTopicId,
  bootstrap,
  onBack,
  onPublished,
  onDraftChanged,
  onFile,
}: {
  draftId?: string;
  editId?: string;
  initialCommunityId?: string;
  initialTopicId?: string;
  bootstrap: NetworkBootstrap;
  onBack: () => void;
  onPublished: (id: string) => void;
  onDraftChanged: () => void;
  onFile: (f: NetworkAttachment) => void;
}) {
  const [input, setInput] = useState<NetworkPostInput>(() =>
      fresh(initialCommunityId, initialTopicId),
    ),
    [files, setFiles] = useState<NetworkAttachment[]>([]),
    [uploads, setUploads] = useState<Upload[]>([]),
    [community, setCommunity] = useState<NetworkCommunity | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false),
    [adjust, setAdjust] = useState<NetworkAttachment | null>(null),
    [postVersion, setPostVersion] = useState(0),
    [originalTopicLabel, setOriginalTopicLabel] = useState(""),
    [canEdit, setCanEdit] = useState(true),
    [leaving, setLeaving] = useState(false);
  const version = useRef(0),
    savePromise = useRef<Promise<void>>(Promise.resolve()),
    inputRef = useRef(input),
    ready = useRef(false),
    mounted = useRef(true),
    lastSaved = useRef(""),
    publishing = useRef(false),
    topicDrafts = useRef<Record<string, NetworkPostInput["answers"]>>({}),
    adjustAttempt = useRef("");
  const dirty =
    !loading &&
    JSON.stringify(input) !== lastSaved.current &&
    !!(
      editId ||
      input.body.trim() ||
      input.title.trim() ||
      input.file_ids.length
    );
  usePageGuard(
    !leaving && dirty,
    !leaving &&
      (busy || saving || uploads.some((u) => u.state === "uploading")),
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    ready.current = false;
    setError("");
    (async () => {
      if (editId) {
        const { post } = await networkApi<{ post: NetworkPost }>(
          `/posts/${editId}`,
          { signal: c.signal },
        );
        setCanEdit(post.can_edit);
        setOriginalTopicLabel(post.topic_label || "");
        setPostVersion(post.version);
        setFiles(post.files || []);
        setInput({
          client_id: post.id,
          mention_user_ids: post.mentions
            ?.filter((m) => m.kind === "user")
            .map((m) => m.id),
          mention_company_ids: post.mentions
            ?.filter((m) => m.kind === "company")
            .map((m) => m.id),
          community_id: post.community_id || undefined,
          kind: post.kind,
          title: post.title,
          body: post.body,
          topic_id: post.topic_id,
          topic_version: post.topic_version,
          answers: post.answers || [],
          file_ids: post.files.map((f) => f.id),
          media_format: post.media_format,
          comments_open: post.comments_open,
        });
        lastSaved.current = JSON.stringify({
          client_id: post.id,
          mention_user_ids: post.mentions
            ?.filter((m) => m.kind === "user")
            .map((m) => m.id),
          mention_company_ids: post.mentions
            ?.filter((m) => m.kind === "company")
            .map((m) => m.id),
          community_id: post.community_id || undefined,
          kind: post.kind,
          title: post.title,
          body: post.body,
          topic_id: post.topic_id,
          topic_version: post.topic_version,
          answers: post.answers || [],
          file_ids: post.files.map((f) => f.id),
          media_format: post.media_format,
          comments_open: post.comments_open,
        });
      } else if (draftId) {
        const draft = await networkReadDraft(draftId, c.signal);
        if (draft) {
          setInput(draft.body);
          setFiles(draft.files || []);
          version.current = draft.version;
          lastSaved.current = JSON.stringify(draft.body);
        } else {
          const start = fresh(initialCommunityId, initialTopicId);
          setInput(start);
          inputRef.current = start;
        }
      }
    })()
      .catch((e) => {
        if (!c.signal.aborted) setError(networkError(e));
      })
      .finally(() => {
        if (!c.signal.aborted) {
          setLoading(false);
          ready.current = true;
        }
      });
    return () => c.abort();
  }, [draftId, editId]);
  useEffect(() => {
    if (!input.community_id) {
      setCommunity(null);
      return;
    }
    const c = new AbortController();
    networkApi<{ community: NetworkCommunity }>(
      `/communities/${input.community_id}`,
      { signal: c.signal },
    )
      .then((r) => setCommunity(r.community))
      .catch((e) => {
        if (!c.signal.aborted) setError(networkError(e));
      });
    return () => c.abort();
  }, [input.community_id]);
  const save = useCallback(
    async (body: NetworkPostInput) => {
      if (
        publishing.current ||
        editId ||
        !draftId ||
        !ready.current ||
        (!body.body.trim() && !body.title.trim() && !body.file_ids.length) ||
        lastSaved.current === JSON.stringify(body)
      )
        return;
      savePromise.current = savePromise.current
        .catch(() => {})
        .then(async () => {
          if (lastSaved.current === JSON.stringify(body)) return;
          setSaving(true);
          try {
            const r = await networkApi<{ draft: NetworkDraft }>(
              `/drafts/${draftId}`,
              {
                method: "PUT",
                body: JSON.stringify({ version: version.current, body }),
              },
            );
            version.current = r.draft.version;
            lastSaved.current = JSON.stringify(body);
            if (mounted.current) {
              setSaved(true);
              onDraftChanged();
            }
          } catch (e) {
            if (mounted.current)
              setError(`Your draft couldn’t be saved. ${networkError(e)}`);
            throw e;
          } finally {
            if (mounted.current) setSaving(false);
          }
        });
      return savePromise.current;
    },
    [draftId, editId],
  );
  useEffect(() => {
    inputRef.current = input;
    if (!ready.current || loading || editId) return;
    setSaved(lastSaved.current === JSON.stringify(input));
    const timer = window.setTimeout(() => {
      void save(input).catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [input, loading, save]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (
        uploads.length ||
        (lastSaved.current !== JSON.stringify(inputRef.current) &&
          inputRef.current.body.trim())
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [uploads.length]);
  const update = (patch: Partial<NetworkPostInput>) =>
    setInput((v) => ({ ...v, ...patch }));
  const topic = community?.topics.find((t) => t.id === input.topic_id);
  const fields: NetworkTopicField[] = editId
    ? input.answers.map((answer) => {
        const current = topic?.fields.find((f) => f.id === answer.field_id);
        return {
          ...current,
          id: answer.field_id,
          label: answer.label || current?.label || "Detail",
          type:
            (answer.type as NetworkTopicField["type"]) ||
            current?.type ||
            "text",
          unit: answer.unit ?? current?.unit,
          required: current?.required || false,
          options:
            current?.type === "select"
              ? [...new Set([...(current.options || []), answer.value])]
              : current?.options,
        };
      })
    : topic?.fields || [];
  useEffect(() => {
    if (topic && input.topic_version !== topic.version && !editId)
      update({ topic_version: topic.version });
  }, [topic?.id, topic?.version]);
  async function uploadFile(file: File, id: string = crypto.randomUUID()) {
    if (
      !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
        file.type,
      ) ||
      file.size > 12 * 1024 * 1024
    ) {
      setError(`${file.name}: choose a JPG, PNG, WebP or PDF up to 12 MB.`);
      return;
    }
    setUploads((rows) => [
      ...rows.filter((r) => r.id !== id),
      { id, file, state: "uploading" },
    ]);
    try {
      const q = new URLSearchParams({
        name: file.name,
        purpose: "post",
        upload_id: id,
        ...(input.community_id ? { community_id: input.community_id } : {}),
      });
      const r = await networkApi<{ file: NetworkAttachment }>(`/files?${q}`, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      setFiles((rows) => [...rows, r.file]);
      setInput((v) => ({ ...v, file_ids: [...v.file_ids, r.file.id] }));
      setUploads((rows) => rows.filter((r) => r.id !== id));
      return r.file;
    } catch (e) {
      setUploads((rows) =>
        rows.map((r) =>
          r.id === id ? { ...r, state: "error", error: networkError(e) } : r,
        ),
      );
    }
  }
  async function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    setError("");
    const chosen = Array.from(list);
    if (chosen.length + files.length + uploads.length > 10) {
      setError("You can add up to 10 photos and documents to a post.");
      return;
    }
    for (const file of chosen) void uploadFile(file);
  }
  async function removeFile(file: NetworkAttachment) {
    setFiles((rows) => rows.filter((f) => f.id !== file.id));
    setInput((v) => ({
      ...v,
      file_ids: v.file_ids.filter((id) => id !== file.id),
    }));
  }
  async function close() {
    if (editId) {
      onBack();
      return;
    }
    setError("");
    try {
      await save(inputRef.current);
      await savePromise.current;
      flushSync(() => setLeaving(true));
      onBack();
    } catch {
      /* Leave the written draft on screen so it can be retried. */
    }
  }
  async function publish(e: FormEvent) {
    e.preventDefault();
    if (uploads.length) return;
    publishing.current = true;
    setBusy(true);
    setError("");
    try {
      await savePromise.current;
      const payload = {
        ...input,
        body: input.body.trim(),
        title: input.title.trim(),
        draft_id: draftId,
        draft_version: version.current,
      };
      const r = editId
        ? await networkPatch<{ post: NetworkPost }>(`/posts/${editId}`, {
            ...payload,
            file_ids: undefined,
            version: postVersion,
          })
        : await networkPost<{ post: NetworkPost }>("/posts", payload);
      lastSaved.current = JSON.stringify(input);
      flushSync(() => setLeaving(true));
      onDraftChanged();
      onPublished(r.post.id);
    } catch (e) {
      publishing.current = false;
      setError(networkError(e));
    } finally {
      setBusy(false);
    }
  }
  const permitted = editId
    ? canEdit
    : input.community_id
      ? community?.can_post
      : bootstrap.viewer.can_publish;
  if (adjust)
    return (
      <ImageAdjustment
        file={adjust}
        format={input.media_format}
        onBack={() => setAdjust(null)}
        onSave={async (blob) => {
          const replacement = new File(
            [blob],
            adjust.name.replace(/\.[^.]+$/, ".jpg"),
            { type: "image/jpeg" },
          );
          const uploaded = await uploadFile(
            replacement,
            adjustAttempt.current || crypto.randomUUID(),
          );
          if (!uploaded)
            throw new Error(
              "The adjusted photo could not be uploaded. Your original photo is safe. Please try again.",
            );
          await removeFile(adjust);
          setAdjust(null);
        }}
      />
    );
  if (loading)
    return (
      <div className="nw-task-page">
        <NetworkState loading />
      </div>
    );
  return (
    <div className="nw-task-page nw-compose-page">
      <BackButton onClick={close} />
      <div className="nw-section-heading">
        <h1>
          {editId
            ? "Edit post"
            : input.community_id
              ? "New discussion"
              : "New post"}
        </h1>
      </div>
      {!permitted ? (
        <NetworkState
          title={
            input.community_id
              ? "Join this community to post"
              : "Company publishing access needed"
          }
        >
          <p>
            {input.community_id
              ? "Your draft stays saved. Join the community to take part."
              : "A company owner or administrator can publish on behalf of your company."}
          </p>
          {input.community_id && (
            <button className="nw-button" onClick={onBack}>
              Back to community
            </button>
          )}
          {error && <p className="nw-error">{error}</p>}
        </NetworkState>
      ) : (
        <form
          className="nw-compose-card"
          onSubmit={publish}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!editId) void addFiles(e.dataTransfer.files);
          }}
          onPaste={(e) => {
            if (!editId && e.clipboardData.files.length) {
              e.preventDefault();
              void addFiles(e.clipboardData.files);
            }
          }}
        >
          <header className="nw-compose-identity">
            <CompanyLogo company={bootstrap.viewer.company} size={46} />
            <div>
              <strong>{bootstrap.viewer.company?.name}</strong>
              <small>
                {bootstrap.viewer.name} ·{" "}
                {community?.visibility === "private"
                  ? "Members only"
                  : "Public"}
              </small>
            </div>
            {!editId && (
              <label>
                Posting to
                <select
                  value={input.community_id || ""}
                  disabled={files.length > 0 || uploads.length > 0}
                  onChange={(e) => {
                    update({
                      community_id: e.target.value || undefined,
                      topic_id: undefined,
                      topic_version: undefined,
                      answers: [],
                    });
                  }}
                >
                  {bootstrap.viewer.can_publish && (
                    <option value="">Company profile</option>
                  )}
                  {bootstrap.communities
                    .filter((c) => c.can_post)
                    .map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </header>
          <div className="nw-compose-write">
            {input.community_id && (
              <label className="nw-field">
                <span className="nw-sr">Discussion title</span>
                <input
                  required
                  maxLength={140}
                  placeholder="Give your discussion a title"
                  value={input.title}
                  onChange={(e) => update({ title: e.target.value })}
                />
              </label>
            )}
            <label className="nw-sr" htmlFor="network-compose-body">
              {input.community_id ? "Discussion details" : "Post caption"}
            </label>
            <MentionInput
              id="network-compose-body"
              value={input.body}
              onChange={(body) => update({ body })}
              onMention={(id, kind) =>
                update(
                  kind === "user"
                    ? {
                        mention_user_ids: [
                          ...new Set([...(input.mention_user_ids || []), id]),
                        ],
                      }
                    : {
                        mention_company_ids: [
                          ...new Set([
                            ...(input.mention_company_ids || []),
                            id,
                          ]),
                        ],
                      },
                )
              }
              communityId={input.community_id}
              placeholder={
                input.community_id
                  ? "Ask a question, share a need or start a conversation…"
                  : "What would you like to share?"
              }
              rows={5}
              required
              maxLength={10000}
            />
          </div>
          {files.length > 0 && (
            <div className="nw-compose-media">
              <NetworkMedia
                files={files}
                format={input.media_format}
                onOpen={(file) => {
                  if (editId) {
                    onFile(file);
                    return;
                  }
                  void save(inputRef.current)
                    .then(() => {
                      flushSync(() => setLeaving(true));
                      onFile(file);
                    })
                    .catch(() => {});
                }}
              />
              {!editId && (
                <>
                  <div className="nw-format-control">
                    <label>
                      Photo format
                      <select
                        value={input.media_format}
                        onChange={(e) =>
                          update({
                            media_format: e.target
                              .value as NetworkPostInput["media_format"],
                          })
                        }
                      >
                        <option value="4:5">Portrait · 4:5</option>
                        <option value="1:1">Square · 1:1</option>
                        <option value="1.91:1">Landscape · 1.91:1</option>
                        <option value="3:4">Tall portrait · 3:4</option>
                      </select>
                    </label>
                  </div>
                  <div className="nw-attachment-manager">
                    {files.map((file) => (
                      <div key={file.id}>
                        <span>
                          {file.name}
                          <small>{networkFileSize(file.size_bytes)}</small>
                        </span>
                        {file.mime_type.startsWith("image/") && (
                          <button
                            type="button"
                            className="nw-text"
                            onClick={() => {
                              adjustAttempt.current = crypto.randomUUID();
                              setAdjust(file);
                            }}
                          >
                            <Pencil size={14} />
                            Adjust
                          </button>
                        )}
                        <button
                          type="button"
                          className="nw-icon"
                          onClick={() => removeFile(file)}
                          aria-label={`Remove ${file.name}`}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {uploads.map((upload) => (
            <div className="nw-upload-state" key={upload.id}>
              {upload.state === "uploading" ? (
                <LoaderCircle size={18} className="nw-spin" />
              ) : (
                <Info size={18} />
              )}
              <span>
                {upload.file.name}
                <small>
                  {upload.state === "uploading" ? "Uploading…" : upload.error}
                </small>
              </span>
              {upload.state === "error" && (
                <>
                  <button
                    type="button"
                    className="nw-text"
                    onClick={() => uploadFile(upload.file, upload.id)}
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    className="nw-icon"
                    aria-label="Remove failed upload"
                    onClick={() =>
                      setUploads((p) => p.filter((u) => u.id !== upload.id))
                    }
                  >
                    <X size={16} />
                  </button>
                </>
              )}
            </div>
          ))}
          {!editId ? (
            <div className="nw-compose-add">
              <label className="nw-upload">
                <ImagePlus size={20} />
                <span>Add photos or documents</span>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <details>
                <summary>
                  <Info size={15} />
                  Image guide
                </summary>
                <p>
                  Portrait: 1080 × 1350 px. Square: 1080 × 1080 px. Landscape:
                  1080 × 566 px. Tall portrait: 1080 × 1440 px.
                </p>
                <p>
                  Choose one frame for your album. Adjust each photo before
                  posting. JPG, PNG, WebP or PDF · 12 MB per file · Up to 10
                  files.
                </p>
              </details>
            </div>
          ) : (
            <p className="nw-edit-boundary">
              Your attached files stay unchanged when editing this post.
            </p>
          )}
          {community && (
            <div className="nw-compose-topic">
              <div className="nw-field-grid">
                <label className="nw-field">
                  Post type
                  <select
                    disabled={!!editId}
                    value={input.kind}
                    onChange={(e) =>
                      update({
                        kind: e.target.value as NetworkPostInput["kind"],
                      })
                    }
                  >
                    <option value="post">Discussion</option>
                    <option value="question">Question</option>
                    <option value="sourcing">Looking for equipment</option>
                    <option value="available">Equipment available</option>
                  </select>
                </label>
                <label className="nw-field">
                  Topic {community.require_topic ? "" : "(optional)"}
                  <select
                    disabled={!!editId}
                    required={community.require_topic}
                    value={input.topic_id || ""}
                    onChange={(e) => {
                      if (input.topic_id)
                        topicDrafts.current[input.topic_id] = input.answers;
                      const t = community.topics.find(
                        (t) => t.id === e.target.value,
                      );
                      update({
                        topic_id: t?.id,
                        topic_version: t?.version,
                        answers: t ? topicDrafts.current[t.id] || [] : [],
                      });
                    }}
                  >
                    <option value="">Choose a topic</option>
                    {editId && input.topic_id && !topic && (
                      <option value={input.topic_id}>
                        {originalTopicLabel || "Original topic"}
                      </option>
                    )}
                    {community.topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {fields.length > 0 && (
                <section className="nw-topic-fields">
                  <header>
                    <h2>
                      {editId
                        ? originalTopicLabel || topic?.label
                        : topic?.label}{" "}
                      details
                    </h2>
                    <small>
                      Help people respond with the right information.
                    </small>
                  </header>
                  <div className="nw-field-grid">
                    {fields.map((field) => (
                      <TopicInput
                        key={field.id}
                        field={field}
                        value={
                          input.answers.find((a) => a.field_id === field.id)
                            ?.value || ""
                        }
                        onChange={(value) =>
                          update({
                            answers: [
                              ...input.answers.filter(
                                (a) => a.field_id !== field.id,
                              ),
                              {
                                ...input.answers.find(
                                  (a) => a.field_id === field.id,
                                ),
                                field_id: field.id,
                                value,
                              },
                            ],
                          })
                        }
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="nw-error">
              {error}
            </p>
          )}
          <footer className="nw-compose-footer">
            <div>
              <span>
                {community?.visibility === "private" ? (
                  <LockKeyhole size={15} />
                ) : (
                  <Globe2 size={15} />
                )}{" "}
                {community
                  ? `In ${community.name}`
                  : "On your company profile and in Network"}
              </span>
              <small>
                {editId
                  ? "Your changes update the existing post."
                  : saving
                    ? "Saving draft…"
                    : saved
                      ? "Draft saved"
                      : "Your draft saves as you write."}
              </small>
            </div>
            <div className="nw-actions">
              <button
                type="button"
                className="nw-button nw-quiet"
                disabled={busy || saving}
                onClick={close}
              >
                Close
              </button>
              <button
                className="nw-button nw-primary"
                disabled={
                  busy ||
                  uploads.length > 0 ||
                  !input.body.trim() ||
                  (!!input.community_id && !input.title.trim())
                }
              >
                {busy ? "Posting…" : editId ? "Save changes" : "Post"}
              </button>
            </div>
          </footer>
        </form>
      )}
    </div>
  );
}
function TopicInput({
  field,
  value,
  onChange,
}: {
  field: NetworkTopicField;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="nw-field">
      <span>
        {field.label}
        {!field.required && <small>Optional</small>}
      </span>
      {field.type === "select" ? (
        <select
          required={field.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose an option</option>
          {(field.options || []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <div className={field.unit ? "nw-unit-field" : ""}>
          <input
            required={field.required}
            type={field.type}
            min={field.min}
            step={field.step || "any"}
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.unit && <span>{field.unit}</span>}
        </div>
      )}
    </label>
  );
}
function ImageAdjustment({
  file,
  format,
  onBack,
  onSave,
}: {
  file: NetworkAttachment;
  format: NetworkPost["media_format"];
  onBack: () => void;
  onSave: (blob: Blob) => Promise<void>;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 }),
    [zoom, setZoom] = useState(1),
    [area, setArea] = useState<Area | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [mode, setMode] = useState<"crop" | "fit">("crop");
  const [a, b] = format.split(":").map(Number);
  async function save() {
    if (!area && mode === "crop") return;
    setBusy(true);
    setError("");
    try {
      const img = new Image();
      img.src = networkFileUrl(file);
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = Math.round(1080 / (a / b));
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("Your browser couldn’t prepare this image.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (mode === "fit") {
        const scale = Math.min(
            canvas.width / img.naturalWidth,
            canvas.height / img.naturalHeight,
          ),
          w = img.naturalWidth * scale,
          h = img.naturalHeight * scale;
        context.drawImage(
          img,
          (canvas.width - w) / 2,
          (canvas.height - h) / 2,
          w,
          h,
        );
      } else if (area)
        context.drawImage(
          img,
          area.x,
          area.y,
          area.width,
          area.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.94),
      );
      if (!blob) throw new Error("Your browser couldn’t save this image.");
      await onSave(blob);
    } catch (e) {
      setError(networkError(e));
      setBusy(false);
    }
  }
  return (
    <div className="nw-task-page nw-adjust-page">
      <BackButton onClick={onBack}>Back to post</BackButton>
      <div className="nw-section-heading">
        <h1>Adjust photo</h1>
        <p>Move the photo to choose what stays in the frame.</p>
      </div>
      <div className="nw-image-modes">
        <label>
          <input
            type="radio"
            checked={mode === "crop"}
            onChange={() => setMode("crop")}
          />
          Crop to frame
        </label>
        <label>
          <input
            type="radio"
            checked={mode === "fit"}
            onChange={() => setMode("fit")}
          />
          Fit whole photo
        </label>
      </div>
      <div className="nw-crop-stage">
        {mode === "fit" ? (
          <img
            className="nw-fit-preview"
            src={networkFileUrl(file)}
            alt={file.name}
          />
        ) : (
          <Cropper
            image={networkFileUrl(file)}
            crop={crop}
            zoom={zoom}
            aspect={a / b}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, pixels) => setArea(pixels)}
            showGrid
          />
        )}
      </div>
      <label className="nw-zoom">
        Zoom
        <input
          type="range"
          min="1"
          max="3"
          step="0.05"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
      </label>
      {error && <p className="nw-error">{error}</p>}
      <div className="nw-actions">
        <button className="nw-button" disabled={busy} onClick={onBack}>
          Cancel
        </button>
        <button
          className="nw-button nw-primary"
          disabled={busy || (!area && mode === "crop")}
          onClick={save}
        >
          {busy ? "Saving photo…" : "Use this photo"}
          <Check size={17} />
        </button>
      </div>
    </div>
  );
}
