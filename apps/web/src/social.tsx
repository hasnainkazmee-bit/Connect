import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Image as ImageIcon,
  Video,
  FileText,
  Globe,
  ThumbsUp,
  MessageCircle,
  Share2,
  Plus,
  Check,
  MoreHorizontal,
  Trash2,
  X,
  ArrowLeft,
  ArrowRight,
  Users,
  LoaderCircle,
  Send,
  RefreshCw,
  Building2,
} from "lucide-react";
import { useApp } from "./context";
import { Logo } from "./identity";
import { api, post } from "./api";
import type { Company } from "./types";

type Media = {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  alt: string;
};
type Post = {
  id: string;
  sequence: string;
  body: string;
  company: Company;
  company_id: string;
  author_name: string;
  created_at: string;
  is_demo: boolean;
  like_count: number;
  comment_count: number;
  liked: boolean;
  following: boolean;
  media: Media[];
};
type Comment = {
  id: string;
  body: string;
  company: Company;
  author_name: string;
  author_id: string;
  created_at: string;
};
type Stats = {
  followers: number;
  following_count: number;
  post_count: number;
  following: boolean;
  blocked: boolean;
};
const relative = (date: string) => {
  const n = Math.max(
    0,
    Math.floor((Date.now() - new Date(date).getTime()) / 60000),
  );
  return n < 1
    ? "Just now"
    : n < 60
      ? n + "m"
      : n < 1440
        ? Math.floor(n / 60) + "h"
        : n < 10080
          ? Math.floor(n / 1440) + "d"
          : new Date(date).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
};
const ErrorNote = ({ error }: { error: string }) =>
  error ? (
    <p className="social-error" role="alert">
      {error}
    </p>
  ) : null;

export function FollowButton({
  target,
  initialFollowing,
}: {
  target: Company;
  initialFollowing?: boolean;
}) {
  const { company, session, admin, signIn, createCompany, revision, refresh } =
    useApp();
  const [following, setFollowing] = useState(initialFollowing || false),
    [blocked, setBlocked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let cancel = false;
    if (initialFollowing !== undefined) {
      setFollowing(initialFollowing);
      return;
    }
    api<Stats>("/social/companies/" + target.id)
      .then((s) => {
        if (!cancel) {
          setFollowing(s.following);
          setBlocked(s.blocked);
        }
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [target.id, company?.id, revision, initialFollowing]);
  if (company?.id === target.id || blocked) return null;
  return (
    <span className="follow-control">
      <button
        className={"follow-button " + (following ? "is-following" : "")}
        disabled={busy || (!!company && !admin)}
        title={
          company && !admin
            ? "Only company administrators can manage follows."
            : following
              ? "Unfollow " + target.name
              : "Follow " + target.name
        }
        aria-label={(following ? "Unfollow " : "Follow ") + target.name}
        aria-pressed={following}
        onClick={async () => {
          if (!session.user) {
            signIn();
            return;
          }
          if (!company) {
            createCompany();
            return;
          }
          setBusy(true);
          setError("");
          try {
            await post("/social/companies/" + target.id + "/follow", {
              following: !following,
            });
            setFollowing(!following);
            refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <LoaderCircle size={15} className="spin" />
        ) : following ? (
          <Check size={15} />
        ) : (
          <Plus size={15} />
        )}
        <span>{following ? "Following" : "Follow"}</span>
      </button>
      <ErrorNote error={error} />
    </span>
  );
}
export function SocialStats({ companyId }: { companyId: string }) {
  const { revision, company } = useApp();
  const [data, setData] = useState<Stats | null>(null);
  useEffect(() => {
    let cancel = false;
    api<Stats>("/social/companies/" + companyId)
      .then((d) => {
        if (!cancel) setData(d);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [companyId, company?.id, revision]);
  return data ? (
    <div className="social-stats">
      <span>
        <strong>{data.followers.toLocaleString()}</strong> followers
      </span>
      <span>
        <strong>{data.following_count.toLocaleString()}</strong> following
      </span>
      <span>
        <strong>{data.post_count.toLocaleString()}</strong> posts
      </span>
    </div>
  ) : null;
}
function ComposerLauncher({
  onPublished,
}: {
  onPublished?: (p: Post) => void;
}) {
  const { company, session, admin, open, signIn, createCompany } = useApp();
  const launch = (kind?: "image" | "video" | "document") => {
    if (!session.user) {
      signIn();
      return;
    }
    if (!company) {
      createCompany();
      return;
    }
    if (!admin) return;
    open(<PostComposer initialKind={kind} onPublished={onPublished} />);
  };
  return (
    <section className="feed-composer" aria-label="Create a post">
      <div className="composer-prompt">
        {company ? (
          <Logo company={company} />
        ) : (
          <span className="guest-company">
            <Building2 size={23} />
          </span>
        )}
        <button disabled={!!company && !admin} onClick={() => launch()}>
          {company && !admin
            ? "Your company’s updates appear here"
            : company
              ? "Share an update, a project, an idea…"
              : "Share what’s happening at your company"}
        </button>
      </div>
      {(!company || admin) && (
        <div className="composer-attachments">
          <button onClick={() => launch("image")}>
            <ImageIcon size={18} />
            <span>Photo</span>
          </button>
          <button onClick={() => launch("video")}>
            <Video size={19} />
            <span>Video</span>
          </button>
          <button onClick={() => launch("document")}>
            <FileText size={18} />
            <span>Document</span>
          </button>
        </div>
      )}
    </section>
  );
}
function PostComposer({
  initialKind,
  onPublished,
}: {
  initialKind?: "image" | "video" | "document";
  onPublished?: (p: Post) => void;
}) {
  const { company, session, close, toast, refresh } = useApp();
  const draftKey = "post-draft:" + session.user!.id + ":" + company!.id;
  const [body, setBody] = useState(
      () => sessionStorage.getItem(draftKey) || "",
    ),
    [files, setFiles] = useState<File[]>([]),
    [urls, setUrls] = useState<string[]>([]),
    [alts, setAlts] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0);
  const [kind, setKind] = useState(initialKind || "image");
  const input = useRef<HTMLInputElement>(null);
  const publishing = useRef(false);
  useEffect(() => {
    sessionStorage.setItem(draftKey, body);
  }, [body, draftKey]);
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls(next);
    return () => next.forEach(URL.revokeObjectURL);
  }, [files]);
  const choose = (k: "image" | "video" | "document") => {
    setKind(k);
    setTimeout(() => input.current?.click(), 0);
  };
  const add = (incoming: File[]) => {
    const all =
      files.length &&
      files.every((f) => f.type.startsWith("image/")) &&
      incoming.every((f) => f.type.startsWith("image/"))
        ? [...files, ...incoming]
        : incoming;
    if (
      all.length > 4 ||
      (all.some((f) => !f.type.startsWith("image/")) && all.length > 1)
    ) {
      setError("Choose up to 4 photos, or one video or PDF.");
      return;
    }
    for (const f of all) {
      if (
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
          "video/mp4",
          "video/webm",
          "application/pdf",
        ].includes(f.type)
      ) {
        setError("Use JPG, PNG, WebP, MP4, WebM, or PDF.");
        return;
      }
      const limit = f.type.startsWith("image/")
        ? 10
        : f.type.startsWith("video/")
          ? 100
          : 20;
      if (f.size > limit * 1024 * 1024) {
        setError(f.name + " is too large. Maximum " + limit + " MB.");
        return;
      }
    }
    setError("");
    setFiles(all);
    setAlts(all.map((_, i) => (all !== incoming ? alts[i] || "" : "")));
  };
  return (
    <div className="post-composer-dialog">
      <h2>Create a post</h2>
      <div className="post-publisher">
        <Logo company={company!} />
        <div>
          <strong>{company!.name}</strong>
          <span>
            <Globe size={12} />
            Public · Posted by {session.user!.name}
          </span>
        </div>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (publishing.current) return;
          publishing.current = true;
          setBusy(true);
          setError("");
          try {
            const form = new FormData();
            form.set("body", body);
            form.set("alts", JSON.stringify(alts));
            files.forEach((f) => form.append("files", f));
            const result = await new Promise<Post>((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open("POST", "/api/posts");
              xhr.upload.onprogress = (e) => {
                if (e.lengthComputable)
                  setProgress(Math.round((e.loaded / e.total) * 100));
              };
              xhr.onload = () => {
                try {
                  const data = JSON.parse(xhr.responseText);
                  xhr.status >= 200 && xhr.status < 300
                    ? resolve(data)
                    : reject(
                        new Error(data.error || "Could not publish your post."),
                      );
                } catch {
                  reject(new Error("Could not publish your post."));
                }
              };
              xhr.onerror = () =>
                reject(
                  new Error(
                    "Upload interrupted. Your draft is saved; try again.",
                  ),
                );
              xhr.send(form);
            });
            sessionStorage.removeItem(draftKey);
            onPublished?.(result);
            refresh();
            close();
            toast("Your post is live.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            publishing.current = false;
            setBusy(false);
          }
        }}
      >
        <textarea
          autoFocus
          aria-label="Post text"
          placeholder="What’s happening at your company?"
          maxLength={4000}
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={busy}
        />
        <div className={"upload-previews media-count-" + files.length}>
          {files.map((f, i) => (
            <div className="upload-preview" key={f.name + i}>
              {f.type.startsWith("image/") ? (
                <>
                  <img src={urls[i]} alt={alts[i] || f.name} />
                  <input
                    aria-label={"Image description " + (i + 1)}
                    placeholder="Add an image description"
                    maxLength={250}
                    value={alts[i] || ""}
                    disabled={busy}
                    onChange={(e) =>
                      setAlts(
                        alts.map((v, n) => (n === i ? e.target.value : v)),
                      )
                    }
                  />
                </>
              ) : f.type.startsWith("video/") ? (
                <video src={urls[i]} controls preload="metadata" />
              ) : (
                <div className="document-preview">
                  <FileText size={30} />
                  <span>
                    {f.name}
                    <small>{(f.size / 1024 / 1024).toFixed(1)} MB · PDF</small>
                  </span>
                </div>
              )}
              <button
                type="button"
                className="remove-media"
                aria-label={"Remove " + f.name}
                disabled={busy}
                onClick={() => {
                  setFiles(files.filter((_, n) => n !== i));
                  setAlts(alts.filter((_, n) => n !== i));
                }}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <ErrorNote error={error} />
        <input
          ref={input}
          hidden
          type="file"
          accept={
            kind === "image"
              ? ".jpg,.jpeg,.png,.webp"
              : kind === "video"
                ? ".mp4,.webm"
                : ".pdf"
          }
          multiple={kind === "image"}
          onChange={(e) => {
            add(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        {initialKind && !files.length && (
          <button
            className="upload-dropzone"
            type="button"
            disabled={busy}
            onClick={() => choose(kind)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              add(Array.from(e.dataTransfer.files));
            }}
          >
            {kind === "image" ? (
              <ImageIcon size={27} />
            ) : kind === "video" ? (
              <Video size={27} />
            ) : (
              <FileText size={27} />
            )}
            <strong>
              Choose{" "}
              {kind === "image"
                ? "photos"
                : kind === "video"
                  ? "a video"
                  : "a PDF"}
            </strong>
            <span>or drag and drop here</span>
          </button>
        )}
        <div className="post-upload-help">
          Up to 4 photos · 10 MB each. One video · 100 MB. One PDF · 20 MB.
        </div>
        <div className="post-compose-footer">
          <div className="compose-media-buttons">
            <button
              title="Add photos"
              aria-label="Add photos"
              type="button"
              disabled={busy}
              onClick={() => choose("image")}
            >
              <ImageIcon size={21} />
            </button>
            <button
              title="Add video"
              aria-label="Add video"
              type="button"
              disabled={busy}
              onClick={() => choose("video")}
            >
              <Video size={21} />
            </button>
            <button
              title="Add document"
              aria-label="Add document"
              type="button"
              disabled={busy}
              onClick={() => choose("document")}
            >
              <FileText size={20} />
            </button>
          </div>
          <span className="post-character-count">{body.length}/4,000</span>
          <button
            className="button primary"
            disabled={busy || (!body.trim() && !files.length)}
          >
            {busy ? (
              <>
                <LoaderCircle className="spin" size={15} />
                {files.length && progress < 100
                  ? `Uploading ${progress}%`
                  : "Publishing…"}
              </>
            ) : (
              "Post"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
function DeletePost({
  item,
  onDeleted,
}: {
  item: Post;
  onDeleted: () => void;
}) {
  const { close, toast, refresh } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <h2>Delete this post?</h2>
      <p className="modal-description">
        The post, its attachments, likes, and comments will be removed.
      </p>
      <ErrorNote error={error} />
      <div className="row">
        <button className="button" onClick={close}>
          Keep post
        </button>
        <button
          className="button danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/posts/" + item.id, { method: "DELETE" });
              onDeleted();
              refresh();
              close();
              toast("Post deleted.");
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          Delete post
        </button>
      </div>
    </>
  );
}
function PostCard({
  item,
  onUpdated,
  onDeleted,
}: {
  item: Post;
  onUpdated: (p: Post) => void;
  onDeleted: () => void;
}) {
  const { company, session, admin, signIn, createCompany, open, toast } =
    useApp();
  const [expanded, setExpanded] = useState(false),
    [commentsOpen, setCommentsOpen] = useState(false),
    [comments, setComments] = useState<Comment[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [comment, setComment] = useState(""),
    [busy, setBusy] = useState(false),
    [liking, setLiking] = useState(false),
    [error, setError] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const ready = () => {
    if (!session.user) {
      signIn();
      return false;
    }
    if (!company) {
      createCompany();
      return false;
    }
    return true;
  };
  const loadComments = async (before?: string) => {
    try {
      const r = await api<{ comments: Comment[]; nextCursor: string | null }>(
        "/posts/" + item.id + "/comments" + (before ? "?before=" + before : ""),
      );
      setComments((old) => (before ? [...r.comments, ...old] : r.comments));
      setCursor(r.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (commentsOpen) void loadComments();
  }, [commentsOpen, item.comment_count]);
  return (
    <article className="feed-post" id={"post-" + item.id}>
      <header className="post-header">
        <Link to={"/company/" + item.company.slug}>
          <Logo company={item.company} />
        </Link>
        <div className="post-identity">
          <Link to={"/company/" + item.company.slug}>{item.company.name}</Link>
          <span>
            {item.company.type}
            {item.company.location ? " · " + item.company.location : ""}
          </span>
          <Link
            className="post-timestamp"
            to={"/posts/" + item.id}
            title={new Date(item.created_at).toLocaleString()}
          >
            {relative(item.created_at)} · <Globe size={11} />
            {item.is_demo && <span className="demo-post-tag">Demo</span>}
          </Link>
        </div>
        <FollowButton target={item.company} initialFollowing={item.following} />
        {company?.id === item.company_id && admin && (
          <details className="post-menu">
            <summary aria-label="Post options" className="icon-button">
              <MoreHorizontal size={19} />
            </summary>
            <div className="dropdown">
              <button
                className="danger-text"
                onClick={() =>
                  open(<DeletePost item={item} onDeleted={onDeleted} />)
                }
              >
                <Trash2 size={15} />
                Delete post
              </button>
            </div>
          </details>
        )}
      </header>
      {item.body && (
        <div
          className={
            "post-body " +
            (!expanded && item.body.length > 400 ? "is-collapsed" : "")
          }
        >
          <p>
            {!expanded && item.body.length > 400
              ? item.body.slice(0, 400) + "…"
              : item.body}
          </p>
          {item.body.length > 400 && (
            <button onClick={() => setExpanded(!expanded)}>
              {expanded ? "Show less" : "…see more"}
            </button>
          )}
        </div>
      )}
      {item.media.length > 0 && (
        <div className={"post-media media-count-" + item.media.length}>
          {item.media.map((m) =>
            m.mime.startsWith("image/") ? (
              <button
                className="post-photo"
                key={m.id}
                onClick={() =>
                  open(
                    <div className="post-lightbox">
                      <img
                        src={m.url}
                        alt={m.alt || "Photo shared by " + item.company.name}
                      />
                      {m.alt && <p>{m.alt}</p>}
                    </div>,
                  )
                }
                aria-label={
                  "View " + (m.alt || "photo from " + item.company.name)
                }
              >
                <img
                  src={m.url}
                  alt={m.alt || "Photo shared by " + item.company.name}
                  loading="lazy"
                />
              </button>
            ) : m.mime.startsWith("video/") ? (
              <video
                key={m.id}
                src={m.url}
                controls
                playsInline
                preload="metadata"
                aria-label={"Video from " + item.company.name}
              />
            ) : (
              <a key={m.id} href={m.url} className="post-document">
                <span>
                  <FileText size={28} />
                </span>
                <div>
                  <strong>{m.name}</strong>
                  <small>
                    PDF · {(m.size / 1024 / 1024).toFixed(1)} MB · Download
                  </small>
                </div>
                <ArrowRight size={19} />
              </a>
            ),
          )}
        </div>
      )}
      <div className="post-engagement">
        <span>
          {item.like_count > 0 ? (
            <>
              <span className="like-dot">
                <ThumbsUp size={10} />
              </span>
              {item.like_count} {item.like_count === 1 ? "like" : "likes"}
            </>
          ) : (
            "Be the first to like this"
          )}
        </span>
        <button onClick={() => setCommentsOpen(!commentsOpen)}>
          {item.comment_count}{" "}
          {item.comment_count === 1 ? "comment" : "comments"}
        </button>
      </div>
      <div className="post-actions">
        <button
          className={item.liked ? "is-liked" : ""}
          aria-pressed={item.liked}
          disabled={liking}
          onClick={async () => {
            if (!ready()) return;
            setLiking(true);
            setError("");
            try {
              onUpdated(
                await post("/posts/" + item.id + "/like", {
                  liked: !item.liked,
                }),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setLiking(false);
            }
          }}
        >
          <ThumbsUp size={18} />
          <span>{item.liked ? "Liked" : "Like"}</span>
        </button>
        <button
          onClick={() => {
            setCommentsOpen(true);
            setTimeout(() => field.current?.focus(), 0);
          }}
        >
          <MessageCircle size={18} />
          <span>Comment</span>
        </button>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                location.origin + "/posts/" + item.id,
              );
              toast("Post link copied.");
            } catch {
              open(
                <>
                  <h2>Share this post</h2>
                  <p className="modal-description">Copy the link below.</p>
                  <input
                    className="share-link-input"
                    readOnly
                    value={location.origin + "/posts/" + item.id}
                    onFocus={(e) => e.target.select()}
                  />
                </>,
              );
            }
          }}
        >
          <Share2 size={17} />
          <span>Share</span>
        </button>
      </div>
      <ErrorNote error={error} />
      {commentsOpen && (
        <section className="post-comments" aria-label="Comments">
          {session.user && company ? (
            <form
              className="comment-composer"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!comment.trim() || busy) return;
                setBusy(true);
                setError("");
                try {
                  onUpdated(
                    await post("/posts/" + item.id + "/comments", {
                      body: comment,
                    }),
                  );
                  setComment("");
                  await loadComments();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Logo company={company} size="tiny" />
              <input
                ref={field}
                aria-label="Write a comment"
                placeholder={"Comment as " + company.name + "…"}
                maxLength={1500}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button
                className="icon-button"
                aria-label="Send comment"
                disabled={busy || !comment.trim()}
              >
                <Send size={17} />
              </button>
            </form>
          ) : (
            <button className="comment-sign-in" onClick={() => ready()}>
              Sign in with your company to join the conversation
            </button>
          )}
          {cursor && (
            <button
              className="text-button earlier-comments"
              onClick={() => void loadComments(cursor)}
            >
              View earlier comments
            </button>
          )}
          {comments.map((c) => (
            <div className="post-comment" key={c.id}>
              <Link to={"/company/" + c.company.slug}>
                <Logo company={c.company} size="tiny" />
              </Link>
              <div>
                <div className="comment-byline">
                  <Link to={"/company/" + c.company.slug}>
                    {c.company.name}
                  </Link>
                  <time>{relative(c.created_at)}</time>
                </div>
                <small>{c.author_name}</small>
                <p>{c.body}</p>
              </div>
              {company &&
                ((c.author_id === session.user?.id &&
                  c.company.id === company.id) ||
                  (admin &&
                    (c.company.id === company.id ||
                      item.company_id === company.id))) && (
                  <button
                    className="icon-button delete-comment"
                    aria-label="Delete comment"
                    onClick={async () => {
                      try {
                        onUpdated(
                          await api("/posts/" + item.id + "/comments/" + c.id, {
                            method: "DELETE",
                          }),
                        );
                        await loadComments();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
            </div>
          ))}
        </section>
      )}
    </article>
  );
}
function Feed({
  scope = "all",
  companyId,
}: {
  scope?: "all" | "following";
  companyId?: string;
}) {
  const { revision, company } = useApp();
  const [posts, setPosts] = useState<Post[]>([]),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false),
    [error, setError] = useState("");
  const query =
    "/feed?scope=" + scope + (companyId ? "&companyId=" + companyId : "");
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError("");
    api<{ posts: Post[]; nextCursor: string | null }>(query)
      .then((r) => {
        if (!cancel) {
          setPosts(r.posts);
          setNext(r.nextCursor);
        }
      })
      .catch((e) => {
        if (!cancel) setError(e.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [query, revision, company?.id]);
  const update = (p: Post) =>
    setPosts((items) => items.map((x) => (x.id === p.id ? p : x)));
  return (
    <>
      <ErrorNote error={error} />
      {loading && !posts.length ? (
        <div className="feed-loading">
          <LoaderCircle className="spin" size={21} />
          Loading posts…
        </div>
      ) : !posts.length && !error ? (
        <div className="feed-empty">
          <MessageCircle size={30} />
          <h2>
            {scope === "following"
              ? "Your feed starts with a follow."
              : "No posts yet."}
          </h2>
          <p>
            {scope === "following"
              ? "Follow companies you’re interested in. Their updates will appear here alongside your own."
              : "Project milestones, new ideas, or a question for the industry — share the first update."}
          </p>
          {scope === "following" && (
            <Link className="button" to="/directory">
              Find companies
            </Link>
          )}
        </div>
      ) : (
        posts.map((p) => (
          <PostCard
            key={p.id}
            item={p}
            onUpdated={update}
            onDeleted={() =>
              setPosts((items) => items.filter((x) => x.id !== p.id))
            }
          />
        ))
      )}
      {next && (
        <button
          className="load-feed button"
          disabled={more}
          onClick={async () => {
            setMore(true);
            try {
              const r = await api<{ posts: Post[]; nextCursor: string | null }>(
                query + "&before=" + next,
              );
              setPosts((old) => [
                ...old,
                ...r.posts.filter((p) => !old.some((x) => x.id === p.id)),
              ]);
              setNext(r.nextCursor);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setMore(false);
            }
          }}
        >
          {more ? "Loading…" : "Show more posts"}
        </button>
      )}
    </>
  );
}
function Suggestions() {
  const { revision, company } = useApp();
  const [list, setList] = useState<(Company & { followers: number })[]>([]);
  useEffect(() => {
    let cancel = false;
    api<(Company & { followers: number })[]>("/social/suggestions")
      .then((d) => {
        if (!cancel) setList(d);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [revision, company?.id]);
  return (
    <section className="feed-suggestions">
      <h2>Companies to follow</h2>
      <p>Find your people in solar.</p>
      {list.map((c) => (
        <div className="suggested-company" key={c.id}>
          <Link to={"/company/" + c.slug}>
            <Logo company={c} />
          </Link>
          <div>
            <Link to={"/company/" + c.slug}>{c.name}</Link>
            <small>
              {c.type}
              {c.location ? " · " + c.location : ""}
            </small>
            <FollowButton target={c} initialFollowing={false} />
          </div>
        </div>
      ))}
      {!list.length && (
        <p>
          You’re following all the available companies. More will appear as the
          community grows.
        </p>
      )}
      <Link className="explore-feed-companies" to="/directory">
        Explore the directory
        <ArrowRight size={15} />
      </Link>
    </section>
  );
}
export function HomeFeed() {
  const { company, session, signIn, refresh } = useApp();
  const [scope, setScope] = useState<"all" | "following">("all");
  useEffect(() => {
    if (!session.user) setScope("all");
  }, [session.user?.id]);
  return (
    <div className="feed-layout">
      <aside className="feed-left-rail">
        {company ? (
          <section className="feed-company-card">
            <div className="feed-company-cover" />
            <Link to={"/company/" + company.slug}>
              <Logo company={company} />
              <h2>{company.name}</h2>
            </Link>
            <p>{company.tagline || company.type}</p>
            <SocialStats companyId={company.id} />
            <Link
              className="feed-company-profile"
              to={"/company/" + company.slug}
            >
              View company profile
              <ArrowRight size={14} />
            </Link>
          </section>
        ) : (
          <section className="feed-welcome">
            <img src="/assets/connect-icon.png" alt="" />
            <h2>
              Your industry.
              <br />
              Your community.
            </h2>
            <p>Meet the teams building what’s next in solar.</p>
            <button className="button primary full" onClick={signIn}>
              Join the conversation
            </button>
          </section>
        )}
        <nav className="feed-shortcuts" aria-label="Community shortcuts">
          <Link to="/directory">
            <Building2 size={17} />
            Discover companies
          </Link>
          <Link to="/network/connections">
            <Users size={17} />
            My network
          </Link>
          <Link to="/messages">
            <MessageCircle size={17} />
            Messages
          </Link>
        </nav>
        <p className="feed-small-print">
          Connect
          <br />
          Built around the companies moving solar forward.
        </p>
      </aside>
      <section className="feed-stream" aria-label="Company feed">
        <ComposerLauncher />
        <div className="feed-tabs">
          <div role="tablist" aria-label="Feed">
            <button
              role="tab"
              aria-selected={scope === "all"}
              onClick={() => setScope("all")}
            >
              All posts
            </button>
            <button
              role="tab"
              aria-selected={scope === "following"}
              onClick={() => {
                if (!session.user) {
                  signIn();
                  return;
                }
                setScope("following");
              }}
            >
              Following
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="Refresh feed"
            title="Refresh feed"
            onClick={refresh}
          >
            <RefreshCw size={15} />
          </button>
        </div>
        <Feed key={scope} scope={scope} />
      </section>
      <aside className="feed-right-rail">
        <Suggestions />
        <div className="feed-follow-note">
          <Globe size={16} />
          <p>
            Follow for updates.
            <br />
            Connect to start a conversation.
          </p>
        </div>
      </aside>
    </div>
  );
}
export function CompanyUpdates({ target }: { target: Company }) {
  const { company } = useApp();
  return (
    <div className="company-updates">
      {company?.id === target.id && <ComposerLauncher />}
      <Feed companyId={target.id} />
    </div>
  );
}
export function PostPage() {
  const { id } = useParams();
  const { company } = useApp();
  const [data, setData] = useState<Post | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setError("");
    api<Post>("/posts/" + id)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id, company?.id]);
  return (
    <div className="single-post">
      <Link className="back-link" to="/">
        <ArrowLeft size={15} />
        Back to feed
      </Link>
      <ErrorNote error={error} />
      {data ? (
        <PostCard
          item={data}
          onUpdated={setData}
          onDeleted={() => {
            setData(null);
            setError("This post has been deleted.");
          }}
        />
      ) : (
        !error && <div className="feed-loading">Loading post…</div>
      )}
    </div>
  );
}
