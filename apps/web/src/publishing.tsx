import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Heading2,
  Heading3,
  MoreHorizontal,
  List,
  Quote,
  Link2,
  Image,
  Video,
  FileText,
  Globe,
  Check,
  LoaderCircle,
  Eye,
  ArrowLeft,
  Plus,
  X,
  UploadCloud,
  Bookmark,
  ArrowUpRight,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import { Logo } from "./identity";
import "./publishing.css";

import {
  formats,
  RichDocument,
  publicationLabel,
  type PublicationKind,
} from "./publication-content";
type Media = {
  id: string;
  name: string;
  mime: string;
  url: string;
  alt: string;
};
type Draft = {
  id: string;
  version: number;
  status: string;
  kind: PublicationKind;
  title: string;
  subtitle: string;
  body: string;
  document: any;
  cover_media_id: string | null;
  media: Media[];
};
const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };
const documentFromText = (text: string) => ({
  type: "doc",
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  })),
});
const hasRichContent = (node: any): boolean =>
  !!node?.marks?.length ||
  (!!node?.type && !["doc", "paragraph", "text"].includes(node.type)) ||
  (node?.content || []).some(hasRichContent);
export function Publisher({
  initialKind = "post",
  initialMedia,
  publicationId,
  onPublished,
}: {
  initialKind?: PublicationKind;
  initialMedia?: "image" | "video" | "document";
  publicationId?: string;
  onPublished?: () => void;
}) {
  const { company, close, refresh, toast } = useApp();
  const [kind, setKind] = useState<PublicationKind>(initialKind),
    [title, setTitle] = useState(""),
    [subtitle, setSubtitle] = useState(""),
    [body, setBody] = useState(""),
    [doc, setDoc] = useState<any>(emptyDoc),
    [media, setMedia] = useState<Media[]>([]),
    [cover, setCover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(""),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false),
    [progress, setProgress] = useState<number | null>(null),
    [loading, setLoading] = useState(!!publicationId),
    [linkOpen, setLinkOpen] = useState(false),
    [link, setLink] = useState(""),
    [mediaKind, setMediaKind] = useState(initialMedia || "image");
  const [uploadName, setUploadName] = useState("");
  const [confirmPost, setConfirmPost] = useState(false);
  const [moreTools, setMoreTools] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [mediaDetails, setMediaDetails] = useState(false);
  const summaryInput = useRef<HTMLTextAreaElement>(null);
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const morePanel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (linkOpen) linkInput.current?.focus();
  }, [linkOpen]);
  useLayoutEffect(() => {
    if (moreTools)
      morePanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [moreTools]);
  useLayoutEffect(() => {
    const field = titleInput.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = field.scrollHeight + "px";
    }
  }, [title, kind, preview, loading]);
  useLayoutEffect(() => {
    if (summaryVisible) summaryInput.current?.focus();
  }, [summaryVisible]);
  const uploadIntent = useRef<"attachment" | "cover" | "inline">("attachment");
  const uploadAction = useRef<
    (files: File[], intent?: "attachment" | "cover" | "inline") => void
  >(() => {});
  const mediaQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingDescriptions = useRef(
    new Map<string, { media: Media; alt: string }>(),
  );
  const uploadLock = useRef(false);
  const [mediaSaving, setMediaSaving] = useState(false);
  const draft = useRef<{
      id: string;
      version: number;
      status: "draft" | "published";
    } | null>(null),
    queue = useRef<Promise<any>>(Promise.resolve()),
    published = useRef(false),
    input = useRef<HTMLInputElement>(null),
    mounted = useRef(true);
  const snapshot = {
    kind,
    title,
    subtitle,
    body,
    document: kind === "post" ? null : doc,
    coverMediaId: cover,
  };
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const fingerprint = JSON.stringify(snapshot);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, protocols: ["http", "https"] },
      }),
      ImageExtension,
      Placeholder.configure({
        placeholder: "Write your announcement…",
      }),
    ],
    content: emptyDoc,
    editorProps: {
      attributes: {
        "aria-label": "Story content",
        role: "textbox",
        "aria-multiline": "true",
        class: "story-editor",
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files || [])].filter((f) =>
          f.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        uploadAction.current(files, "inline");
        return true;
      },
      handleDrop: (_view, event) => {
        const files = [...(event.dataTransfer?.files || [])].filter((f) =>
          f.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        uploadAction.current(files, "inline");
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const document = editor.getJSON(),
        text = editor.getText({ blockSeparator: "\n" });
      setDoc(document);
      if (latest.current.kind !== "post") {
        setBody(text);
        latest.current = { ...latest.current, document, body: text };
      }
      setError("");
    },
  });
  const textStyle = useEditorState({
    editor,
    selector: ({ editor }) => ({
      heading: editor?.isActive("heading", { level: 2 }) || false,
      subheading: editor?.isActive("heading", { level: 3 }) || false,
      link: editor?.isActive("link") || false,
      bold: editor?.isActive("bold") || false,
      italic: editor?.isActive("italic") || false,
      list: editor?.isActive("bulletList") || false,
      quote: editor?.isActive("blockquote") || false,
    }),
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!publicationId) return;
    let cancelled = false;
    api<Draft>("/posts/" + publicationId)
      .then((p) => {
        if (cancelled) return;
        const loadedDocument = p.document || documentFromText(p.body);
        draft.current = {
          id: p.id,
          version: p.version,
          status: p.status as "draft" | "published",
        };
        setKind(p.kind);
        setTitle(p.title);
        setSubtitle(p.subtitle);
        setBody(p.body);
        setDoc(loadedDocument);
        setMedia(p.media || []);
        setCover(p.cover_media_id);
        editor?.commands.setContent(loadedDocument, { emitUpdate: false });
        setSaved(
          JSON.stringify({
            kind: p.kind,
            title: p.title,
            subtitle: p.subtitle,
            body: p.body,
            document: p.kind === "post" ? null : loadedDocument,
            coverMediaId: p.cover_media_id,
          }),
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicationId, editor]);
  function persist(
    status: "draft" | "published" = draft.current?.status || "draft",
  ) {
    const job = queue.current
      .catch(() => {})
      .then(async () => {
        const payload = { ...latest.current };
        if (mounted.current) {
          setSaving(true);
          setError("");
        }
        try {
          if (!draft.current) {
            const d = await post<Draft>("/publications", {
              kind: payload.kind,
            });
            draft.current = { id: d.id, version: d.version, status: "draft" };
          }
          const result = await api<Draft>("/publications/" + draft.current.id, {
            method: "PATCH",
            body: JSON.stringify({
              ...payload,
              status,
              version: draft.current.version,
            }),
          });
          draft.current = {
            id: result.id,
            version: result.version,
            status: result.status as "draft" | "published",
          };
          if (mounted.current) setSaved(JSON.stringify(payload));
          return result;
        } catch (e) {
          if (mounted.current) setError((e as Error).message);
          throw e;
        } finally {
          if (mounted.current) setSaving(false);
        }
      });
    queue.current = job;
    return job;
  }
  useEffect(() => {
    if (
      draft.current?.status === "published" ||
      loading ||
      busy ||
      published.current ||
      error ||
      fingerprint === saved ||
      (!body.trim() && !title.trim() && !subtitle.trim() && !draft.current)
    )
      return;
    const t = setTimeout(() => void persist().catch(() => {}), 1400);
    return () => clearTimeout(t);
  }, [fingerprint, saved, loading, busy, error]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (
        busy ||
        mediaSaving ||
        pendingDescriptions.current.size ||
        (fingerprint !== saved && (body || title || subtitle))
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [fingerprint, saved, body, title, subtitle, busy, mediaSaving]);
  async function upload(files: File[], intent = uploadIntent.current) {
    if (!files.length || busy || uploadLock.current) return;
    if (
      kind === "post" &&
      (media.length + files.length > 4 ||
        ((media.some((m) => !m.mime.startsWith("image/")) ||
          files.some((f) => !f.type.startsWith("image/"))) &&
          media.length + files.length > 1))
    ) {
      setError(
        "Add up to 4 photos, or one video or PDF. Choose Press release to share more.",
      );
      return;
    }
    if (media.length + files.length > 20) {
      setError("A press release can include up to 20 attachments.");
      return;
    }
    const oversized = files.find(
      (f) =>
        f.size >
        (f.type.startsWith("image/")
          ? 10
          : f.type === "application/pdf"
            ? 20
            : 100) *
          1024 *
          1024,
    );
    if (oversized) {
      setError(
        "Use photos under 10 MB, videos under 100 MB, and PDFs under 20 MB.",
      );
      return;
    }
    uploadLock.current = true;
    setBusy(true);
    setError("");
    try {
      await persist();
      for (const f of files) {
        setUploadName(f.name);
        setProgress(0);
        const form = new FormData();
        form.set("file", f);
        const m = await new Promise<Media>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/publications/" + draft.current!.id + "/media");
          xhr.timeout = 120000;
          xhr.upload.onprogress = (e) =>
            e.lengthComputable &&
            setProgress(Math.round((e.loaded / e.total) * 100));
          xhr.onload = () => {
            try {
              const d = JSON.parse(xhr.responseText);
              if (xhr.status === 401)
                window.dispatchEvent(new Event("connect:session-expired"));
              xhr.status >= 200 && xhr.status < 300
                ? resolve(d)
                : reject(new Error(d.error || "Could not upload this file."));
            } catch {
              reject(new Error("Could not upload this file."));
            }
          };
          xhr.onerror = () =>
            reject(
              new Error(
                "Upload interrupted. Your story is saved. Try this file again.",
              ),
            );
          xhr.ontimeout = () =>
            reject(
              new Error(
                "This upload is taking too long. Your draft is saved; try the file again.",
              ),
            );
          xhr.send(form);
        });
        setMedia((old) => [...old, m]);
        if (intent === "cover" && m.mime.startsWith("image/")) {
          setCover(m.id);
          latest.current = { ...latest.current, coverMediaId: m.id };
        }
        if (intent === "inline" && m.mime.startsWith("image/"))
          editor
            ?.chain()
            .focus()
            .setImage({ src: m.url, alt: m.alt })
            .createParagraphNear()
            .run();
        // Save each completed placement before attempting the next file.
        // A failed later upload must not lose an earlier cover or inline photo.
        await persist();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      uploadLock.current = false;
      setProgress(null);
      setUploadName("");
    }
  }
  uploadAction.current = (files, intent) => {
    void upload(files, intent);
  };
  const choose = (
    type: "image" | "video" | "document",
    intent: "attachment" | "cover" | "inline" = "attachment",
  ) => {
    uploadIntent.current = intent;
    setMediaKind(type);
    setTimeout(() => input.current?.click(), 0);
  };
  function changeKind(value: PublicationKind, confirmed = false) {
    if (
      value === "post" &&
      (body.length > 4000 ||
        media.length > 4 ||
        (media.some((m) => !m.mime.startsWith("image/")) && media.length > 1))
    ) {
      setError(
        "This update needs the extra room of a press release. A post allows 4,000 characters and up to 4 photos, or one video or PDF.",
      );
      return;
    }
    if (
      value === "post" &&
      kind !== "post" &&
      !confirmed &&
      (title || subtitle || hasRichContent(doc))
    ) {
      setConfirmPost(true);
      return;
    }
    setConfirmPost(false);
    setKind(value);
    latest.current = {
      ...latest.current,
      kind: value,
      document: value === "post" ? null : doc,
    };
    setError("");
    if (
      value !== "post" &&
      body &&
      body !== editor?.getText({ blockSeparator: "\n" })
    ) {
      const content = documentFromText(body);
      editor?.commands.setContent(content);
      setDoc(content);
    }
  }
  useEffect(() => {
    const closeRequest = (event: Event) => {
      if (busy || mediaSaving) {
        event.preventDefault();
        return;
      }
      if (
        pendingDescriptions.current.size ||
        ((body.trim() || title.trim() || subtitle.trim() || draft.current) &&
          fingerprint !== saved)
      ) {
        event.preventDefault();
        const finish = (event as CustomEvent).detail.close;
        void flushMediaSaves()
          .then(() => persist())
          .then(finish)
          .catch(() => {});
      }
    };
    window.addEventListener("connect:modal-close", closeRequest);
    return () =>
      window.removeEventListener("connect:modal-close", closeRequest);
  }, [busy, mediaSaving, body, title, subtitle, fingerprint, saved]);
  if (!company)
    return (
      <div className="publisher-empty">
        <h2>Publishing is for companies.</h2>
        <p>Use a company account to share updates.</p>
      </div>
    );
  if (loading)
    return (
      <div className="publisher-empty">
        <LoaderCircle className="spin" /> Opening your draft…
      </div>
    );
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  const coverPhoto = media.find((m) => m.id === cover);
  const charLimit = kind === "post" ? 4000 : 50000;
  const inlineIds = new Set<string>();
  function collectImages(node: any) {
    if (node?.type === "image") inlineIds.add(node.attrs?.src);
    node?.content?.forEach(collectImages);
  }
  collectImages(doc);
  async function saveAlt(m: Media, alt: string) {
    pendingDescriptions.current.set(m.id, { media: m, alt });
    setMediaSaving(true);
    const job = mediaQueue.current
      .catch(() => {})
      .then(async () => {
        await api("/publications/" + draft.current!.id + "/media/" + m.id, {
          method: "PATCH",
          body: JSON.stringify({ alt }),
        });
        if (editor) {
          const transaction = editor.state.tr;
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name === "image" && node.attrs.src === m.url)
              transaction.setNodeMarkup(pos, undefined, { ...node.attrs, alt });
          });
          editor.view.dispatch(transaction);
        }
        setMedia((all) => all.map((v) => (v.id === m.id ? { ...v, alt } : v)));
        if (pendingDescriptions.current.get(m.id)?.alt === alt)
          pendingDescriptions.current.delete(m.id);
      });
    mediaQueue.current = job;
    try {
      await job;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setMediaSaving(false);
    }
  }
  async function flushMediaSaves() {
    await mediaQueue.current.catch(() => {});
    for (const { media, alt } of [...pendingDescriptions.current.values()])
      await saveAlt(media, alt);
  }
  return (
    <div
      className={
        "publisher " + (kind === "post" ? "publisher-quick" : "publisher-story")
      }
    >
      <header className="publisher-top">
        <h2>
          {preview
            ? "Preview"
            : publicationId
              ? "Edit update"
              : "Create an update"}
        </h2>
        <button
          className="button primary publish-button"
          disabled={
            busy ||
            body.length > charLimit ||
            (!body.trim() && !media.length) ||
            (kind !== "post" && title.trim().length < 3)
          }
          onClick={async () => {
            setBusy(true);
            published.current = true;
            try {
              await flushMediaSaves();
              await persist("published");
              refresh();
              close();
              toast("Published. Your update is now on your company profile.");
              onPublished?.();
            } catch {
              published.current = false;
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? uploadName
              ? "Uploading…"
              : "Publishing…"
            : kind === "post"
              ? "Post"
              : "Publish"}
          <ArrowUpRight size={17} />
        </button>
        <button
          className="icon-button publisher-close"
          aria-label="Close dialog"
          type="button"
          onClick={() => {
            const request = new CustomEvent("connect:modal-close", {
              cancelable: true,
              detail: { close },
            });
            if (window.dispatchEvent(request)) close();
          }}
        >
          <X size={20} />
        </button>
      </header>
      <div
        className="publisher-formats"
        role="group"
        aria-label="Publication format"
      >
        {formats.map((f) => (
          <button
            key={f.value}
            aria-label={f.label + " format"}
            aria-pressed={
              kind === f.value ||
              (f.value === "press_release" && kind !== "post")
            }
            onClick={() => changeKind(f.value)}
            disabled={busy}
          >
            <f.icon size={17} />
            <span>
              <strong>{f.label}</strong>
            </span>
          </button>
        ))}
      </div>
      {confirmPost && (
        <div className="publisher-format-confirm" role="alert">
          <strong>Switch to a simple post?</strong>
          <p>
            Your text and attachments will stay. The headline, rich formatting,
            and photo placement won’t appear in the post.
          </p>
          <div>
            <button className="button" onClick={() => setConfirmPost(false)}>
              Keep current format
            </button>
            <button
              className="button primary"
              onClick={() => changeKind("post", true)}
            >
              Switch to Post
            </button>
          </div>
        </div>
      )}
      <div className="publisher-identity">
        <Logo company={company} />
        <div>
          <strong>{company.name}</strong>
          <span>
            <Globe size={12} />
            Public · {publicationLabel(kind)}
          </span>
        </div>
        <span className="publisher-save" role="status">
          {saving || mediaSaving ? (
            <>
              <LoaderCircle size={13} className="spin" />
              Saving…
            </>
          ) : error ? (
            <button
              onClick={() =>
                void flushMediaSaves()
                  .then(() => persist())
                  .catch(() => {})
              }
            >
              Retry saving
            </button>
          ) : saved && fingerprint === saved ? (
            <>
              <Check size={13} />
              Draft saved
            </>
          ) : (
            ""
          )}
        </span>
      </div>
      {preview ? (
        <article className="publisher-preview">
          {kind !== "post" && coverPhoto && (
            <img
              className="story-cover"
              src={coverPhoto.url}
              alt={coverPhoto.alt || "Press release cover"}
            />
          )}
          {kind !== "post" && title && <h1>{title}</h1>}
          {kind !== "post" && subtitle && (
            <p className="story-subtitle">{subtitle}</p>
          )}
          {kind === "post" ? (
            <p style={{ whiteSpace: "pre-wrap" }}>{body}</p>
          ) : (
            <RichDocument document={doc} />
          )}
          <div
            className={
              "publisher-preview-media " +
              (kind === "post" && media.length > 1 ? "preview-gallery" : "")
            }
          >
            {media
              .filter(
                (m) =>
                  kind === "post" || (m.id !== cover && !inlineIds.has(m.url)),
              )
              .map((m) =>
                m.mime.startsWith("image/") ? (
                  <img key={m.id} src={m.url} alt={m.alt || "Company photo"} />
                ) : m.mime.startsWith("video/") ? (
                  <video key={m.id} src={m.url} controls preload="metadata" />
                ) : (
                  <a
                    className="publisher-file"
                    key={m.id}
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText size={20} />
                    {m.name}
                  </a>
                ),
              )}
          </div>
        </article>
      ) : (
        <>
          {kind !== "post" && (
            <>
              <div
                className={
                  "publisher-cover-slot " +
                  (coverPhoto ? "has-cover" : "empty-cover")
                }
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void upload(
                    [...e.dataTransfer.files]
                      .filter((f) => f.type.startsWith("image/"))
                      .slice(0, 1),
                    "cover",
                  );
                }}
              >
                {coverPhoto ? (
                  <>
                    <img
                      src={coverPhoto.url}
                      alt={coverPhoto.alt || "Press release cover"}
                    />
                    <div>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => choose("image", "cover")}
                      >
                        <Image size={17} />
                        Change cover
                      </button>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => setCover(null)}
                      >
                        Remove cover
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => choose("image", "cover")}
                  >
                    <Image size={17} />
                    <span>Add a cover photo</span>
                  </button>
                )}
              </div>
              <div className="story-titles">
                <textarea
                  ref={titleInput}
                  className="story-title-input"
                  rows={1}
                  aria-label="Story title"
                  placeholder="Title"
                  value={title}
                  maxLength={180}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setError("");
                  }}
                />
                {(summaryVisible || !!subtitle) && (
                  <textarea
                    ref={summaryInput}
                    aria-label="Story subtitle"
                    placeholder="The key news in a sentence (optional)"
                    rows={2}
                    maxLength={300}
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                  />
                )}
              </div>
            </>
          )}
          {kind === "post" ? (
            <textarea
              className="quick-post-input"
              autoFocus
              aria-label="Post text"
              placeholder="What’s happening at your company?"
              value={body}
              maxLength={4000}
              onChange={(e) => {
                setBody(e.target.value);
                setError("");
              }}
            />
          ) : (
            <>
              <EditorContent editor={editor} />
            </>
          )}
        </>
      )}
      {!preview && !!media.length && kind !== "post" && (
        <button
          className="publisher-media-toggle"
          aria-expanded={mediaDetails}
          onClick={() => setMediaDetails(!mediaDetails)}
        >
          <Image size={16} /> Photos & files <span>{media.length}</span>
        </button>
      )}
      {!preview && !!media.length && (kind === "post" || mediaDetails) && (
        <div className="publisher-media">
          {media.map((m) => (
            <figure key={m.id}>
              {m.mime.startsWith("image/") ? (
                <img src={m.url} alt={m.alt || m.name} />
              ) : m.mime.startsWith("video/") ? (
                <video src={m.url} controls preload="metadata" />
              ) : (
                <div className="publisher-file">
                  <FileText />
                  <span>{m.name}</span>
                </div>
              )}
              {m.mime.startsWith("image/") && (
                <input
                  className="media-alt"
                  aria-label="Image description"
                  placeholder="Describe this photo for accessibility"
                  defaultValue={m.alt}
                  maxLength={250}
                  onBlur={(e) => {
                    if (e.target.value !== m.alt)
                      void saveAlt(m, e.target.value).catch(() => {});
                  }}
                />
              )}
              <figcaption>
                <span title={m.name}>{m.name}</span>
                {kind !== "post" && m.mime.startsWith("image/") && (
                  <>
                    <button
                      aria-pressed={cover === m.id}
                      onClick={() => setCover(cover === m.id ? null : m.id)}
                    >
                      {cover === m.id ? "Cover photo" : "Use as cover"}
                    </button>
                    <button
                      onClick={() =>
                        editor
                          ?.chain()
                          .focus()
                          .setImage({ src: m.url, alt: m.alt || m.name })
                          .run()
                      }
                    >
                      Insert in release
                    </button>
                  </>
                )}
                <button
                  aria-label={"Remove " + m.name}
                  onClick={async () => {
                    try {
                      if (cover === m.id) {
                        setCover(null);
                        latest.current = {
                          ...latest.current,
                          coverMediaId: null,
                        };
                      }
                      if (editor) {
                        const positions: { from: number; to: number }[] = [];
                        editor.state.doc.descendants((node, pos) => {
                          if (
                            node.type.name === "image" &&
                            node.attrs.src === m.url
                          )
                            positions.push({
                              from: pos,
                              to: pos + node.nodeSize,
                            });
                        });
                        const transaction = editor.state.tr;
                        for (const position of positions.reverse())
                          transaction.delete(position.from, position.to);
                        editor.view.dispatch(transaction);
                      }
                      await persist();
                      await api(
                        "/publications/" + draft.current!.id + "/media/" + m.id,
                        { method: "DELETE" },
                      );
                      pendingDescriptions.current.delete(m.id);
                      setMedia((old) => old.filter((v) => v.id !== m.id));
                      if (cover === m.id) setCover(null);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <X size={15} />
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {!preview && initialMedia && !media.length && kind === "post" && (
        <button
          className="publisher-drop"
          disabled={busy}
          onClick={() => choose(mediaKind)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void upload([...e.dataTransfer.files]);
          }}
        >
          <UploadCloud size={25} />
          <strong>
            Add{" "}
            {mediaKind === "image"
              ? "photos"
              : mediaKind === "video"
                ? "a video"
                : "a document"}
          </strong>
          <span>Choose files or drop them here</span>
        </button>
      )}
      <input
        ref={input}
        type="file"
        hidden
        multiple={mediaKind === "image" && uploadIntent.current !== "cover"}
        accept={
          mediaKind === "image"
            ? ".jpg,.jpeg,.png,.webp"
            : mediaKind === "video"
              ? ".mp4,.webm"
              : ".pdf"
        }
        onChange={(e) => {
          void upload([...(e.target.files || [])]);
          e.target.value = "";
        }}
      />
      {error && (
        <p className="publisher-error" role="alert">
          {error}
        </p>
      )}
      {progress !== null && (
        <div
          className="publisher-progress"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: progress + "%" }} />
          <small>
            {progress === 100 ? "Finishing upload" : `Uploading ${progress}%`} ·{" "}
            {uploadName}
          </small>
        </div>
      )}
      <footer className="publisher-bottom">
        {!preview && kind !== "post" && (
          <>
            {linkOpen && (
              <form
                className="editor-link"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!/^https?:\/\//i.test(link)) {
                    setError("Use a full link beginning with https://");
                    return;
                  }
                  if (
                    editor?.state.selection.empty &&
                    !editor.isActive("link")
                  ) {
                    editor
                      .chain()
                      .focus()
                      .insertContent({
                        type: "text",
                        text: link,
                        marks: [{ type: "link", attrs: { href: link } }],
                      })
                      .run();
                  } else {
                    editor
                      ?.chain()
                      .focus()
                      .extendMarkRange("link")
                      .setLink({ href: link })
                      .run();
                  }
                  setLinkOpen(false);
                  setError("");
                }}
              >
                <input
                  ref={linkInput}
                  aria-label="Link address"
                  value={link}
                  placeholder="https://example.com"
                  onChange={(e) => setLink(e.target.value)}
                />
                <button className="button small" type="submit">
                  Apply link
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close link editor"
                  onClick={() => setLinkOpen(false)}
                >
                  <X size={15} />
                </button>
              </form>
            )}

            {moreTools && (
              <div
                className="editor-more"
                ref={morePanel}
                role="group"
                aria-label="More formatting"
              >
                {[
                  [
                    "Bold",
                    Bold,
                    textStyle?.bold,
                    () => editor?.chain().focus().toggleBold().run(),
                  ],
                  [
                    "Italic",
                    Italic,
                    textStyle?.italic,
                    () => editor?.chain().focus().toggleItalic().run(),
                  ],
                  [
                    "Bulleted list",
                    List,
                    textStyle?.list,
                    () => editor?.chain().focus().toggleBulletList().run(),
                  ],
                  [
                    "Quote",
                    Quote,
                    textStyle?.quote,
                    () => editor?.chain().focus().toggleBlockquote().run(),
                  ],
                ].map(([label, Icon, active, action]: any) => (
                  <button
                    key={label}
                    title={label}
                    aria-label={label}
                    aria-pressed={!!active}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={action}
                  >
                    <Icon size={18} />
                  </button>
                ))}
                <button
                  onClick={() => {
                    setSummaryVisible(true);
                    summaryInput.current?.focus();
                    setMoreTools(false);
                  }}
                >
                  Add summary
                </button>
                <button onClick={() => choose("video")} disabled={busy}>
                  Video
                </button>
                <button onClick={() => choose("document")} disabled={busy}>
                  PDF
                </button>
              </div>
            )}
            <div
              className="editor-toolbar"
              role="toolbar"
              aria-label="Text formatting"
            >
              <button
                type="button"
                disabled={busy}
                title="Insert photo"
                aria-label="Insert photo"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose("image", "inline")}
              >
                <Image size={20} />
              </button>
              <button
                type="button"
                title="Link"
                aria-label="Link"
                aria-pressed={linkOpen || textStyle?.link || false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setLink(editor?.getAttributes("link").href || "");
                  setLinkOpen(!linkOpen);
                  setMoreTools(false);
                }}
              >
                <Link2 size={20} />
              </button>
              <button
                type="button"
                title="Heading"
                aria-label="Heading"
                aria-pressed={textStyle?.heading || false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  editor?.chain().focus().toggleHeading({ level: 2 }).run()
                }
              >
                <Heading2 size={20} />
              </button>
              <button
                type="button"
                title="Subheading"
                aria-label="Subheading"
                aria-pressed={textStyle?.subheading || false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  editor?.chain().focus().toggleHeading({ level: 3 }).run()
                }
              >
                <Heading3 size={20} />
              </button>
              <button
                type="button"
                title="More formatting"
                aria-label="More formatting"
                aria-expanded={moreTools}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMoreTools(!moreTools);
                  setLinkOpen(false);
                }}
              >
                <MoreHorizontal size={20} />
              </button>
            </div>
          </>
        )}
        {!preview && kind === "post" && (
          <div
            className="publisher-add"
            role="toolbar"
            aria-label="Add to your post"
          >
            <button onClick={() => choose("image")} disabled={busy}>
              <Image size={19} />
              <span>Photo</span>
            </button>
            <button onClick={() => choose("video")} disabled={busy}>
              <Video size={19} />
              <span>Video</span>
            </button>
            <button onClick={() => choose("document")} disabled={busy}>
              <FileText size={19} />
              <span>PDF</span>
            </button>
          </div>
        )}
        <div className="publisher-submit">
          <span
            className={
              "word-count " + (body.length > charLimit ? "over-limit" : "")
            }
            aria-live="polite"
          >
            {body.length.toLocaleString()} / {charLimit.toLocaleString()}
            {kind !== "post" && (
              <small>
                {wordCount} words · {Math.max(1, Math.ceil(wordCount / 200))}{" "}
                min read
              </small>
            )}
          </span>
          <button
            className="publisher-drafts"
            title="Save & close"
            aria-label="Save & close"
            disabled={busy || saving || mediaSaving}
            onClick={() => {
              void flushMediaSaves()
                .then(() => persist())
                .then(() => {
                  close();
                  toast("Draft saved. Find it in Drafts.");
                })
                .catch(() => {});
            }}
          >
            <Bookmark size={18} />
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              try {
                await flushMediaSaves();
                if (!preview) await persist();
                setPreview(!preview);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {preview ? <ArrowLeft size={16} /> : <Eye size={16} />}
            <span>{preview ? "Edit" : "Preview"}</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
export function DraftsDialog() {
  const { open } = useApp();
  const [items, setItems] = useState<Draft[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    api<Draft[]>("/publications")
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <section className="drafts-dialog">
      <span className="publisher-eyebrow">YOUR COMPANY NEWSROOM</span>
      <h2>Your company’s drafts</h2>
      <p>Pick up where you or a teammate left off.</p>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <LoaderCircle className="spin" />
      ) : items.length ? (
        items.map((d) => (
          <button
            key={d.id}
            className="draft-row"
            onClick={() => open(<Publisher publicationId={d.id} />)}
          >
            <FileText size={22} />
            <span>
              <strong>
                {d.title ||
                  d.body.slice(0, 65) ||
                  "Untitled " + publicationLabel(d.kind).toLowerCase()}
              </strong>
              <small>{publicationLabel(d.kind)}</small>
            </span>
            <ArrowUpRight size={18} />
          </button>
        ))
      ) : (
        <div className="drafts-empty">
          <Bookmark size={28} />
          <h3>A little room to think.</h3>
          <p>Your unfinished stories will be saved here.</p>
        </div>
      )}
      <button className="button primary" onClick={() => open(<Publisher />)}>
        <Plus size={16} />
        Create a post
      </button>
    </section>
  );
}
