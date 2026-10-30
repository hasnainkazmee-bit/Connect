import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Underline,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Link2,
  Minus,
  Undo2,
  Redo2,
  Image,
  Video,
  FileText,
  Newspaper,
  BookOpen,
  BriefcaseBusiness,
  MessageSquare,
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
  const { company, session, close, refresh, toast } = useApp();
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
        placeholder:
          "Tell the story. Add a heading, a quote, or an image when you need one.",
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
    },
    onUpdate: ({ editor }) => {
      setDoc(editor.getJSON());
      setBody(editor.getText({ blockSeparator: "\n" }));
      setError("");
    },
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
        draft.current = {
          id: p.id,
          version: p.version,
          status: p.status as "draft" | "published",
        };
        setKind(p.kind);
        setTitle(p.title);
        setSubtitle(p.subtitle);
        setBody(p.body);
        setDoc(p.document || emptyDoc);
        setMedia(p.media || []);
        setCover(p.cover_media_id);
        editor?.commands.setContent(
          p.document || {
            type: "doc",
            content: p.body
              .split("\n")
              .map((t) => ({
                type: "paragraph",
                content: t ? [{ type: "text", text: t }] : [],
              })),
          },
          { emitUpdate: false },
        );
        setSaved(
          JSON.stringify({
            kind: p.kind,
            title: p.title,
            subtitle: p.subtitle,
            body: p.body,
            document: p.kind === "post" ? null : p.document || emptyDoc,
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
      (!body.trim() && !title.trim() && !draft.current)
    )
      return;
    const t = setTimeout(() => void persist().catch(() => {}), 1400);
    return () => clearTimeout(t);
  }, [fingerprint, saved, loading, busy, error]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (fingerprint !== saved && (body || title)) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [fingerprint, saved, body, title]);
  async function upload(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    setError("");
    try {
      await persist();
      for (const f of files) {
        const form = new FormData();
        form.set("file", f);
        const m = await new Promise<Media>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/publications/" + draft.current!.id + "/media");
          xhr.upload.onprogress = (e) =>
            e.lengthComputable &&
            setProgress(Math.round((e.loaded / e.total) * 100));
          xhr.onload = () => {
            try {
              const d = JSON.parse(xhr.responseText);
              xhr.status < 300
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
          xhr.send(form);
        });
        setMedia((old) => [...old, m]);
        if (kind !== "post" && !cover && m.mime.startsWith("image/"))
          setCover(m.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  const choose = (type: "image" | "video" | "document") => {
    setMediaKind(type);
    setTimeout(() => input.current?.click(), 0);
  };
  function changeKind(value: PublicationKind) {
    setKind(value);
    setError("");
    if (
      value !== "post" &&
      body &&
      !doc.content?.some((n: any) => n.content?.length)
    ) {
      const content = {
        type: "doc",
        content: body
          .split("\n")
          .map((t) => ({
            type: "paragraph",
            content: t ? [{ type: "text", text: t }] : [],
          })),
      };
      editor?.commands.setContent(content);
      setDoc(content);
    }
  }
  useEffect(() => {
    const closeRequest = (event: Event) => {
      if (busy) {
        event.preventDefault();
        return;
      }
      if (
        (body.trim() || title.trim() || draft.current) &&
        fingerprint !== saved
      ) {
        event.preventDefault();
        const finish = (event as CustomEvent).detail.close;
        void persist()
          .then(finish)
          .catch(() => {});
      }
    };
    window.addEventListener("connect:modal-close", closeRequest);
    return () =>
      window.removeEventListener("connect:modal-close", closeRequest);
  }, [busy, body, title, fingerprint, saved]);
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
  return (
    <div
      className={
        "publisher " + (kind === "post" ? "publisher-quick" : "publisher-story")
      }
    >
      <header className="publisher-top">
        <div>
          <span className="publisher-eyebrow">YOUR COMPANY’S VOICE</span>
          <h2>
            {preview
              ? "Preview"
              : publicationId
                ? "Edit your story"
                : "Create a post"}
          </h2>
        </div>
        <button
          className="publisher-drafts"
          onClick={() => {
            void persist()
              .then(() => {
                close();
                toast("Draft saved. Find it in Drafts.");
              })
              .catch(() => {});
          }}
          disabled={busy || saving}
        >
          <Bookmark size={16} />
          Save & close
        </button>
      </header>
      <div
        className="publisher-formats"
        role="tablist"
        aria-label="Publication format"
      >
        {formats.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={kind === f.value}
            onClick={() => changeKind(f.value)}
            disabled={busy}
          >
            <f.icon size={17} />
            <span>{f.label}</span>
          </button>
        ))}
      </div>
      <div className="publisher-identity">
        <Logo company={company} />
        <div>
          <strong>{company.name}</strong>
          <span>
            <Globe size={12} />
            Public · {formats.find((f) => f.value === kind)?.label}
          </span>
        </div>
        <span className="publisher-save" role="status">
          {saving ? (
            <>
              <LoaderCircle size={13} className="spin" />
              Saving…
            </>
          ) : error ? (
            <button onClick={() => void persist().catch(() => {})}>
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
          {cover && (
            <img
              className="story-cover"
              src={media.find((m) => m.id === cover)?.url}
              alt="Story cover"
            />
          )}
          {title && <h1>{title}</h1>}
          {subtitle && <p className="story-subtitle">{subtitle}</p>}
          {kind === "post" ? (
            <p style={{ whiteSpace: "pre-wrap" }}>{body}</p>
          ) : (
            <RichDocument document={doc} />
          )}
        </article>
      ) : (
        <>
          {kind !== "post" && (
            <div className="story-titles">
              <input
                aria-label="Story title"
                placeholder={
                  kind === "press_release"
                    ? "Your headline"
                    : "Give your story a title"
                }
                value={title}
                maxLength={180}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setError("");
                }}
              />
              <textarea
                aria-label="Story subtitle"
                placeholder="A short introduction (optional)"
                rows={2}
                maxLength={300}
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
              />
            </div>
          )}
          {kind === "post" ? (
            <textarea
              className="quick-post-input"
              autoFocus
              aria-label="Post text"
              placeholder="What would you like to share?"
              value={body}
              maxLength={4000}
              onChange={(e) => {
                setBody(e.target.value);
                setError("");
              }}
            />
          ) : (
            <>
              <div
                className="editor-toolbar"
                role="toolbar"
                aria-label="Text formatting"
              >
                {[
                  [
                    "Bold",
                    Bold,
                    () => editor?.chain().focus().toggleBold().run(),
                    "bold",
                  ],
                  [
                    "Italic",
                    Italic,
                    () => editor?.chain().focus().toggleItalic().run(),
                    "italic",
                  ],
                  [
                    "Underline",
                    Underline,
                    () => editor?.chain().focus().toggleUnderline().run(),
                    "underline",
                  ],
                  [
                    "Heading",
                    Heading2,
                    () =>
                      editor?.chain().focus().toggleHeading({ level: 2 }).run(),
                    "heading",
                  ],
                  [
                    "Bulleted list",
                    List,
                    () => editor?.chain().focus().toggleBulletList().run(),
                    "bulletList",
                  ],
                  [
                    "Numbered list",
                    ListOrdered,
                    () => editor?.chain().focus().toggleOrderedList().run(),
                    "orderedList",
                  ],
                  [
                    "Quote",
                    Quote,
                    () => editor?.chain().focus().toggleBlockquote().run(),
                    "blockquote",
                  ],
                  [
                    "Divider",
                    Minus,
                    () => editor?.chain().focus().setHorizontalRule().run(),
                    "horizontalRule",
                  ],
                  [
                    "Link",
                    Link2,
                    () => {
                      setLink(editor?.getAttributes("link").href || "");
                      setLinkOpen(!linkOpen);
                    },
                    "link",
                  ],
                  [
                    "Undo",
                    Undo2,
                    () => editor?.chain().focus().undo().run(),
                    "",
                  ],
                  [
                    "Redo",
                    Redo2,
                    () => editor?.chain().focus().redo().run(),
                    "",
                  ],
                ].map(([label, Icon, action, active]: any) => (
                  <button
                    key={label}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={editor?.isActive(active) || false}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={action}
                  >
                    <Icon size={17} />
                  </button>
                ))}
              </div>
              {linkOpen && (
                <form
                  className="editor-link"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!/^https?:\/\//i.test(link)) {
                      setError("Use a full link beginning with https://");
                      return;
                    }
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
              <EditorContent editor={editor} />
            </>
          )}
        </>
      )}
      {!!media.length && (
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
                  onBlur={async (e) => {
                    const alt = e.target.value;
                    try {
                      await api(
                        "/publications/" + draft.current!.id + "/media/" + m.id,
                        { method: "PATCH", body: JSON.stringify({ alt }) },
                      );
                      setMedia((all) =>
                        all.map((v) => (v.id === m.id ? { ...v, alt } : v)),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
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
                      Insert in story
                    </button>
                  </>
                )}
                <button
                  aria-label={"Remove " + m.name}
                  onClick={async () => {
                    try {
                      await persist();
                      await api(
                        "/publications/" + draft.current!.id + "/media/" + m.id,
                        { method: "DELETE" },
                      );
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
      {initialMedia && !media.length && (
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
        multiple={mediaKind === "image"}
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
          <small>Uploading {progress}%</small>
        </div>
      )}
      <footer className="publisher-bottom">
        <div className="publisher-add">
          <button onClick={() => choose("image")} disabled={busy}>
            <Image size={18} />
            <span>Photo</span>
          </button>
          <button onClick={() => choose("video")} disabled={busy}>
            <Video size={18} />
            <span>Video</span>
          </button>
          <button onClick={() => choose("document")} disabled={busy}>
            <FileText size={18} />
            <span>Document</span>
          </button>
        </div>
        <div className="publisher-submit">
          {kind !== "post" && (
            <span className="word-count">
              {wordCount} words · {Math.max(1, Math.ceil(wordCount / 200))} min
              read
            </span>
          )}
          <button
            className="button"
            disabled={busy}
            onClick={() => setPreview(!preview)}
          >
            {preview ? <ArrowLeft size={16} /> : <Eye size={16} />}
            <span>{preview ? "Edit" : "Preview"}</span>
          </button>
          <button
            className="button primary publish-button"
            disabled={
              busy ||
              (!body.trim() && !media.length) ||
              (kind !== "post" && title.trim().length < 3)
            }
            onClick={async () => {
              setBusy(true);
              published.current = true;
              try {
                await persist("published");
                refresh();
                close();
                toast("Published. Your story is now on your company profile.");
                onPublished?.();
              } catch {
                published.current = false;
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Publishing…" : kind === "post" ? "Post" : "Publish"}
            <ArrowUpRight size={17} />
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
      <span className="publisher-eyebrow">ROOM FOR YOUR NEXT IDEA</span>
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
                  "Untitled " +
                    formats
                      .find((f) => f.value === d.kind)
                      ?.label.toLowerCase()}
              </strong>
              <small>{formats.find((f) => f.value === d.kind)?.label}</small>
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
