import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TextSelection } from "@tiptap/pm/state";
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
  Bookmark,
  ArrowUpRight,
  MessageSquare,
  Newspaper,
} from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
import { Logo } from "./identity";
import { RichDocument, type PublicationKind } from "./publication-content";
import { POST_PHOTO_ASPECTS, usePhotoAdjuster } from "./photo-adjuster";
import { MediaGallery } from "./publication-media";
import {
  editableDocument,
  writingHeadline,
  writingText,
  inlineImageUrls,
} from "./publication-writing";
import "./publishing.css";

type Media = {
  id: string;
  name: string;
  mime: string;
  url: string;
  alt: string;
  size?: number;
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
export function Publisher({
  initialKind: _initialKind = "post",
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
  const { adjustPhoto, photoAdjuster } = usePhotoAdjuster();
  // A generous draft keeps every format open. The public format is chosen at Publish.
  const [kind, setKind] = useState<PublicationKind>("press_release");
  const [body, setBody] = useState(""),
    [doc, setDoc] = useState<any>(emptyDoc);
  const [media, setMedia] = useState<Media[]>([]),
    [cover, setCover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState("");
  const [error, setError] = useState(""),
    [preview, setPreview] = useState(false),
    [choosingFormat, setChoosingFormat] = useState(false);
  const [progress, setProgress] = useState<number | null>(null),
    [loading, setLoading] = useState(!!publicationId);
  const [linkOpen, setLinkOpen] = useState(false),
    [link, setLink] = useState(""),
    [mediaKind, setMediaKind] = useState(initialMedia || "image");
  const [uploadName, setUploadName] = useState(""),
    [moreTools, setMoreTools] = useState(false),
    [mediaDetails, setMediaDetails] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null),
    morePanel = useRef<HTMLDivElement>(null),
    formatPanel = useRef<HTMLDivElement>(null);
  const uploadIntent = useRef<"attachment" | "cover" | "inline">("inline");
  const uploadAction = useRef<
    (files: File[], intent?: "attachment" | "cover" | "inline") => void
  >(() => {});
  const mediaQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingDescriptions = useRef(
    new Map<string, { media: Media; alt: string }>(),
  );
  const uploadLock = useRef(false),
    [mediaSaving, setMediaSaving] = useState(false);
  const closing = useRef(false),
    operations = useRef(new AbortController()),
    activeUpload = useRef<XMLHttpRequest | null>(null);
  const draft = useRef<{
    id: string;
    version: number;
    status: "draft" | "published";
  } | null>(null);
  const queue = useRef<Promise<any>>(Promise.resolve()),
    published = useRef(false),
    input = useRef<HTMLInputElement>(null),
    mounted = useRef(true);
  const snapshot = {
    kind,
    title:
      draft.current?.status === "published" && kind !== "post"
        ? writingHeadline(doc)
        : "",
    subtitle: "",
    body,
    document: doc,
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
        placeholder: "What’s happening at your company?",
      }),
    ],
    content: emptyDoc,
    editorProps: {
      attributes: {
        "aria-label": "Update content",
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
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files || [])].filter((f) =>
          f.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        const position = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (position)
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.near(view.state.doc.resolve(position.pos)),
            ),
          );
        uploadAction.current(files, "inline");
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const document = editor.getJSON(),
        text = editor.getText({ blockSeparator: "\n" });
      setDoc(document);
      setBody(text);
      latest.current = { ...latest.current, document, body: text };
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
  useLayoutEffect(() => {
    if (linkOpen) linkInput.current?.focus();
  }, [linkOpen]);
  useLayoutEffect(() => {
    if (moreTools)
      morePanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [moreTools]);
  useLayoutEffect(() => {
    if (choosingFormat)
      formatPanel.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus();
  }, [choosingFormat]);
  useEffect(() => {
    mounted.current = true;
    operations.current = new AbortController();
    return () => {
      mounted.current = false;
      operations.current.abort();
      activeUpload.current?.abort();
      activeUpload.current = null;
    };
  }, []);
  useEffect(() => {
    editor?.setEditable(!busy && !choosingFormat && !closing.current, false);
  }, [editor, busy, choosingFormat]);
  useEffect(() => {
    if (!publicationId || !editor) return;
    let cancelled = false;
    api<Draft>("/posts/" + publicationId)
      .then((p) => {
        if (cancelled) return;
        const loadedDocument = editableDocument(
          p.document,
          p.body,
          p.title,
          p.subtitle,
        );
        const loadedMedia = p.media || [],
          existingCover = loadedMedia.find((m) => m.id === p.cover_media_id);
        if (
          existingCover &&
          !inlineImageUrls(loadedDocument).has(existingCover.url)
        )
          loadedDocument.content.unshift({
            type: "image",
            attrs: { src: existingCover.url, alt: existingCover.alt },
          });
        draft.current = {
          id: p.id,
          version: p.version,
          status: p.status as "draft" | "published",
        };
        const loadedKind = p.status === "published" ? p.kind : "press_release";
        setKind(loadedKind);
        setDoc(loadedDocument);
        setBody(writingText(loadedDocument));
        setMedia(loadedMedia);
        setCover(p.cover_media_id);
        editor.commands.setContent(loadedDocument, { emitUpdate: false });
        setSaved(
          JSON.stringify({
            kind: loadedKind,
            title:
              p.status === "published" && loadedKind !== "post"
                ? writingHeadline(loadedDocument)
                : "",
            subtitle: "",
            body: writingText(loadedDocument),
            document: loadedDocument,
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
    overrides: Partial<typeof snapshot> = {},
  ) {
    const owner = operations.current;
    const job = queue.current
      .catch(() => {})
      .then(async () => {
        assertOwner(owner);
        const payload = { ...latest.current, ...overrides };
        if (mounted.current) {
          setSaving(true);
          setError("");
        }
        try {
          if (!draft.current) {
            const d = await api<Draft>("/publications", {
              method: "POST",
              body: JSON.stringify({ kind: payload.kind }),
              signal: owner.signal,
            });
            assertOwner(owner);
            draft.current = { id: d.id, version: d.version, status: "draft" };
          }
          const result = await api<Draft>("/publications/" + draft.current.id, {
            method: "PATCH",
            signal: owner.signal,
            body: JSON.stringify({
              ...payload,
              status,
              version: draft.current.version,
            }),
          });
          assertOwner(owner);
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
      (!body.trim() && !draft.current)
    )
      return;
    const timer = setTimeout(() => {
      if (!closing.current && !published.current && mounted.current)
        void persist().catch(() => {});
    }, 1400);
    return () => clearTimeout(timer);
  }, [fingerprint, saved, loading, busy, error]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (
        busy ||
        mediaSaving ||
        pendingDescriptions.current.size ||
        (fingerprint !== saved && body)
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [fingerprint, saved, body, busy, mediaSaving]);
  function assertOwner(owner: AbortController) {
    if (
      !mounted.current ||
      operations.current !== owner ||
      owner.signal.aborted
    )
      throw new DOMException("This editor has closed.", "AbortError");
  }
  async function upload(files: File[], intent = uploadIntent.current) {
    if (
      !files.length ||
      busy ||
      closing.current ||
      uploadLock.current ||
      !mounted.current
    )
      return;
    const owner = operations.current;
    if (media.length + files.length > 20) {
      setError("You can attach up to 20 photos, videos, or files.");
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
      for (const selected of files) {
        assertOwner(owner);
        const f = selected.type.startsWith("image/")
          ? await adjustPhoto(selected, {
              title:
                files.length > 1
                  ? `Adjust photo ${files.indexOf(selected) + 1} of ${files.length}`
                  : "Adjust photo",
              aspects: POST_PHOTO_ASPECTS,
              initialAspect: "original",
            })
          : selected;
        assertOwner(owner);
        if (!f) continue;
        await persist();
        assertOwner(owner);
        setUploadName(f.name);
        setProgress(0);
        const form = new FormData();
        form.set("file", f);
        const m = await new Promise<Media>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          activeUpload.current = xhr;
          xhr.open("POST", "/api/publications/" + draft.current!.id + "/media");
          xhr.timeout = 120000;
          xhr.upload.onprogress = (e) =>
            mounted.current &&
            !owner.signal.aborted &&
            e.lengthComputable &&
            setProgress(Math.round((e.loaded / e.total) * 100));
          xhr.onload = () => {
            try {
              assertOwner(owner);
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
          xhr.onabort = () =>
            reject(
              new DOMException(
                "Upload cancelled because this editor closed.",
                "AbortError",
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
        activeUpload.current = null;
        assertOwner(owner);
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
        assertOwner(owner);
      }
    } catch (e) {
      if (mounted.current && !owner.signal.aborted)
        setError((e as Error).message);
    } finally {
      activeUpload.current = null;
      uploadLock.current = false;
      if (mounted.current && !owner.signal.aborted) {
        setBusy(false);
        setProgress(null);
        setUploadName("");
      }
    }
  }
  uploadAction.current = (files, intent) => {
    void upload(files, intent);
  };
  const choose = (
    type: "image" | "video" | "document",
    intent: "attachment" | "cover" | "inline" = "inline",
  ) => {
    uploadIntent.current = intent;
    setMediaKind(type);
    setTimeout(() => input.current?.click(), 0);
  };
  async function saveAlt(m: Media, alt: string) {
    const owner = operations.current;
    assertOwner(owner);
    pendingDescriptions.current.set(m.id, { media: m, alt });
    setMediaSaving(true);
    const job = mediaQueue.current
      .catch(() => {})
      .then(async () => {
        assertOwner(owner);
        await api("/publications/" + draft.current!.id + "/media/" + m.id, {
          method: "PATCH",
          body: JSON.stringify({ alt }),
          signal: owner.signal,
        });
        assertOwner(owner);
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
      if (mounted.current && !owner.signal.aborted)
        setError((e as Error).message);
      throw e;
    } finally {
      if (mounted.current && !owner.signal.aborted) setMediaSaving(false);
    }
  }
  async function flushMediaSaves() {
    const owner = operations.current;
    await mediaQueue.current.catch(() => {});
    assertOwner(owner);
    for (const { media, alt } of [...pendingDescriptions.current.values()])
      await saveAlt(media, alt);
  }

  async function saveAndClose(finish = close, notify = false) {
    if (closing.current || busy || !mounted.current) return;
    const owner = operations.current;
    closing.current = true;
    setBusy(true);
    // Lock synchronously before the async flush, including keystrokes arriving
    // before React commits the busy state. Alt text is flushed into that snapshot.
    editor?.setEditable(false, false);
    setLinkOpen(false);
    setMoreTools(false);
    try {
      await flushMediaSaves();
      await persist();
      assertOwner(owner);
      finish();
      if (notify) toast("Draft saved. Find it in Drafts.");
    } catch (e) {
      if (mounted.current && !owner.signal.aborted)
        setError((e as Error).message);
    } finally {
      closing.current = false;
      if (mounted.current && !owner.signal.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    const closeRequest = (event: Event) => {
      if (busy || closing.current) {
        event.preventDefault();
        return;
      }
      if (choosingFormat) {
        event.preventDefault();
        setChoosingFormat(false);
        return;
      }
      if (
        mediaSaving ||
        pendingDescriptions.current.size ||
        ((body.trim() || draft.current) && fingerprint !== saved)
      ) {
        event.preventDefault();
        const finish = (event as CustomEvent).detail.close;
        void saveAndClose(finish);
      }
    };
    window.addEventListener("connect:modal-close", closeRequest);
    return () =>
      window.removeEventListener("connect:modal-close", closeRequest);
  }, [busy, mediaSaving, body, fingerprint, saved, choosingFormat]);
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
  const inlineIds = inlineImageUrls(doc),
    headline = writingHeadline(doc);
  const remainingMedia = media.filter((m) => !inlineIds.has(m.url));
  const updateAllowed =
    body.length <= 4000 &&
    media.length <= 4 &&
    (!media.some((m) => !m.mime.startsWith("image/")) || media.length <= 1);
  const releaseAllowed =
    headline.length >= 3 && body.trim().length >= 20 && body.length <= 50000;
  async function publishAs(value: "post" | "press_release") {
    setBusy(true);
    published.current = true;
    setError("");
    try {
      await flushMediaSaves();
      await persist("published", {
        kind: value,
        title: value === "post" ? "" : writingHeadline(latest.current.document),
        subtitle: "",
        coverMediaId:
          value === "post"
            ? null
            : cover ||
              media.find((m) => m.mime.startsWith("image/"))?.id ||
              null,
      });
      refresh();
      close();
      toast("Published. Your update is now on your company profile.");
      onPublished?.();
    } catch {
      published.current = false;
    } finally {
      setBusy(false);
    }
  }
  async function removeMedia(m: Media) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (cover === m.id) {
        setCover(null);
        latest.current = { ...latest.current, coverMediaId: null };
      }
      if (editor) {
        const positions: { from: number; to: number }[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "image" && node.attrs.src === m.url)
            positions.push({ from: pos, to: pos + node.nodeSize });
        });
        const transaction = editor.state.tr;
        for (const position of positions.reverse())
          transaction.delete(position.from, position.to);
        editor.view.dispatch(transaction);
      }
      await persist();
      await api("/publications/" + draft.current!.id + "/media/" + m.id, {
        method: "DELETE",
      });
      pendingDescriptions.current.delete(m.id);
      setMedia((old) => old.filter((v) => v.id !== m.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="publisher publisher-onebox">
      {photoAdjuster}
      <header className="publisher-top">
        <button
          className="icon-button publisher-close"
          aria-label="Close dialog"
          type="button"
          disabled={busy}
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
            busy || body.length > 50000 || (!body.trim() && !media.length)
          }
          onClick={() => {
            setChoosingFormat(true);
            setMoreTools(false);
            setLinkOpen(false);
            setError("");
          }}
        >
          {busy
            ? closing.current
              ? "Saving…"
              : uploadLock.current
                ? uploadName
                  ? "Uploading…"
                  : "Preparing…"
                : "Publishing…"
            : "Publish"}
          <ArrowUpRight size={17} />
        </button>
      </header>
      <div className="publisher-identity">
        <Logo company={company} />
        <div>
          <strong>{company.name}</strong>
          <span>
            <Globe size={12} />
            Public
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
      {choosingFormat && (
        <div
          className="publisher-choice"
          ref={formatPanel}
          role="group"
          aria-labelledby="publish-choice-title"
        >
          <div className="publisher-choice-heading">
            <h3 id="publish-choice-title">How would you like to publish?</h3>
            <button
              className="icon-button"
              aria-label="Close publishing choices"
              disabled={busy}
              onClick={() => setChoosingFormat(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="publisher-choice-options">
            <button
              aria-label="Update"
              disabled={busy || !updateAllowed}
              onClick={() => void publishAs("post")}
            >
              <MessageSquare size={24} />
              <span>
                <strong>Update</strong>
                <small>
                  {updateAllowed
                    ? "Share a moment, project, or company news."
                    : "Up to 4,000 characters and 4 photos, or one video or PDF."}
                </small>
              </span>
              <ArrowUpRight size={18} />
            </button>
            <button
              aria-label="Press release"
              disabled={busy || !releaseAllowed}
              onClick={() => void publishAs("press_release")}
            >
              <Newspaper size={24} />
              <span>
                <strong>Press release</strong>
                <small>
                  {releaseAllowed
                    ? "Your first line becomes the headline."
                    : "Start with a headline and add at least 20 characters."}
                </small>
              </span>
              <ArrowUpRight size={18} />
            </button>
          </div>
          <button
            className="publisher-keep-writing"
            disabled={busy}
            onClick={() => setChoosingFormat(false)}
          >
            Keep writing
          </button>
        </div>
      )}
      {preview ? (
        <article className="publisher-preview">
          <RichDocument document={doc} />
          <MediaGallery
            media={remainingMedia}
            companyName={company.name}
            preview
          />
        </article>
      ) : (
        <div className="publisher-canvas">
          <EditorContent editor={editor} />
          {!!remainingMedia.length && (
            <MediaGallery
              media={remainingMedia}
              companyName={company.name}
              preview
            />
          )}
        </div>
      )}
      {!preview && !!media.length && (
        <button
          className="publisher-media-toggle"
          aria-expanded={mediaDetails}
          onClick={() => setMediaDetails(!mediaDetails)}
        >
          <Image size={16} />
          Photos & files <span>{media.length}</span>
        </button>
      )}
      {!preview && mediaDetails && !!media.length && (
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
                  placeholder="Describe this photo"
                  defaultValue={m.alt}
                  maxLength={250}
                  disabled={busy}
                  onBlur={(event) => {
                    if (event.target.value !== m.alt)
                      void saveAlt(m, event.target.value).catch(() => {});
                  }}
                />
              )}
              <figcaption>
                <span title={m.name}>{m.name}</span>
                <button
                  disabled={busy}
                  aria-label={"Remove " + m.name}
                  onClick={() => void removeMedia(m)}
                >
                  <X size={15} />
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <input
        ref={input}
        type="file"
        hidden
        multiple={mediaKind === "image"}
        accept={
          mediaKind === "image"
            ? ".jpg,.jpeg,.png,.webp"
            : mediaKind === "video"
              ? ".mp4,.webm"
              : ".pdf"
        }
        onChange={(event) => {
          void upload([...(event.target.files || [])]);
          event.target.value = "";
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
        {!preview && (
          <>
            {linkOpen && (
              <form
                className="editor-link"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!/^https?:\/\//i.test(link)) {
                    setError("Use a full link beginning with https://");
                    return;
                  }
                  if (editor?.state.selection.empty && !editor.isActive("link"))
                    editor
                      .chain()
                      .focus()
                      .insertContent({
                        type: "text",
                        text: link,
                        marks: [{ type: "link", attrs: { href: link } }],
                      })
                      .run();
                  else
                    editor
                      ?.chain()
                      .focus()
                      .extendMarkRange("link")
                      .setLink({ href: link })
                      .run();
                  setLinkOpen(false);
                  setError("");
                }}
              >
                <input
                  ref={linkInput}
                  aria-label="Link address"
                  value={link}
                  placeholder="https://example.com"
                  onChange={(event) => setLink(event.target.value)}
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
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={action}
                  >
                    <Icon size={18} />
                  </button>
                ))}
                <button
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose("image", "inline")}
                  disabled={busy}
                >
                  Insert photo
                </button>
                <button
                  onClick={() => choose("video", "attachment")}
                  disabled={busy}
                >
                  Video
                </button>
                <button
                  onClick={() => choose("document", "attachment")}
                  disabled={busy}
                >
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
                disabled={busy || choosingFormat}
                title="Add photo"
                aria-label="Add photo"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose("image", "inline")}
              >
                <Image size={20} />
              </button>
              <button
                type="button"
                disabled={busy || choosingFormat}
                title="Link"
                aria-label="Link"
                aria-pressed={linkOpen || textStyle?.link || false}
                onMouseDown={(event) => event.preventDefault()}
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
                disabled={busy || choosingFormat}
                title="Heading"
                aria-label="Heading"
                aria-pressed={textStyle?.heading || false}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  editor?.chain().focus().toggleHeading({ level: 2 }).run()
                }
              >
                <Heading2 size={20} />
              </button>
              <button
                type="button"
                disabled={busy || choosingFormat}
                title="Subheading"
                aria-label="Subheading"
                aria-pressed={textStyle?.subheading || false}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  editor?.chain().focus().toggleHeading({ level: 3 }).run()
                }
              >
                <Heading3 size={20} />
              </button>
              <button
                type="button"
                disabled={busy || choosingFormat}
                title="More formatting"
                aria-label="More formatting"
                aria-expanded={moreTools}
                onMouseDown={(event) => event.preventDefault()}
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
        <div className="publisher-submit">
          <span
            className={
              "word-count " + (body.length > 50000 ? "over-limit" : "")
            }
          >
            {body.length > 3500
              ? body.length.toLocaleString() + " characters"
              : ""}
          </span>
          <button
            className="publisher-drafts"
            title="Save & close"
            aria-label="Save & close"
            disabled={busy}
            onClick={() => void saveAndClose(close, true)}
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
                setChoosingFormat(false);
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
                {d.title || d.body.slice(0, 65) || "Untitled update"}
              </strong>
              <small>Unpublished draft</small>
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
