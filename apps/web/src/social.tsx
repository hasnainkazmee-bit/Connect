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
import {
  Publisher,
  DraftsDialog,
  formats,
  RichDocument,
  type PublicationKind,
} from "./composer";

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
  kind: PublicationKind;
  title: string;
  subtitle: string;
  document: any;
  cover_media_id: string | null;
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
export function ComposerLauncher() {
  const { company, session, admin, open, signIn, createCompany } = useApp();
  if (session.user?.account_type === "individual") return null;
  const launch = (
    kind: PublicationKind = "post",
    media?: "image" | "video" | "document",
  ) => {
    if (!session.user) return signIn();
    if (!company) return createCompany();
    if (!admin) return;
    open(<Publisher initialKind={kind} initialMedia={media} />);
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
            : "What’s happening at your company?"}
        </button>
        {company && admin && (
          <button
            className="launcher-drafts"
            onClick={() => open(<DraftsDialog />)}
          >
            Drafts
          </button>
        )}
      </div>
      {(!company || admin) && (
        <div className="composer-attachments composer-formats">
          <button onClick={() => launch("post", "image")}>
            <ImageIcon size={18} />
            <span>Photo / video</span>
          </button>
          {formats.slice(1).map((f) => (
            <button key={f.value} onClick={() => launch(f.value)}>
              <f.icon size={18} />
              <span>{f.label}</span>
            </button>
          ))}
        </div>
      )}
    </section>
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
  reading = false,
  showFollow = true,
}: {
  showFollow?: boolean;
  reading?: boolean;
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
      if (session.user.account_type === "individual") {
        setError(
          "Company accounts publish and comment. You can follow this company or message them from their profile.",
        );
        return false;
      }
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
        {showFollow && (
          <FollowButton
            target={item.company}
            initialFollowing={item.following}
          />
        )}
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
      {item.kind && item.kind !== "post" ? (
        <div
          className={
            "publication-card " + (reading ? "publication-reading" : "")
          }
        >
          <span className="publication-label">
            {formats.find((f) => f.value === item.kind)?.label} ·{" "}
            {Math.max(1, Math.ceil(item.body.split(/\s+/).length / 200))} min
            read
          </span>
          <h2>
            <Link to={"/posts/" + item.id}>{item.title}</Link>
          </h2>
          {item.subtitle && (
            <p className="publication-subtitle">{item.subtitle}</p>
          )}
          {item.cover_media_id && (
            <Link to={"/posts/" + item.id}>
              <img
                className="publication-cover"
                src={item.media.find((m) => m.id === item.cover_media_id)?.url}
                alt={
                  item.media.find((m) => m.id === item.cover_media_id)?.alt ||
                  item.title
                }
              />
            </Link>
          )}
          {reading ? (
            <RichDocument
              document={
                item.document || {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: item.body }],
                    },
                  ],
                }
              }
            />
          ) : (
            <>
              <p className="publication-excerpt">
                {item.body.slice(0, 210)}
                {item.body.length > 210 ? "…" : ""}
              </p>
              <Link className="publication-read" to={"/posts/" + item.id}>
                Read{" "}
                {formats
                  .find((f) => f.value === item.kind)
                  ?.label.toLowerCase()}
                <ArrowRight size={15} />
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
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
        </>
      )}
      {item.media.length > 0 &&
        (!item.kind || item.kind === "post" || reading) && (
          <div className={"post-media media-count-" + item.media.length}>
            {item.media
              .filter(
                (m) =>
                  !item.kind ||
                  item.kind === "post" ||
                  !m.mime.startsWith("image/") ||
                  (!JSON.stringify(item.document).includes(m.id) &&
                    m.id !== item.cover_media_id),
              )
              .map((m) =>
                m.mime.startsWith("image/") ? (
                  <button
                    className="post-photo"
                    key={m.id}
                    onClick={() =>
                      open(
                        <div className="post-lightbox">
                          <img
                            src={m.url}
                            alt={
                              m.alt || "Photo shared by " + item.company.name
                            }
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
          disabled={liking || session.user?.account_type === "individual"}
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
  kind,
}: {
  kind?: PublicationKind;
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
    "/feed?scope=" +
    scope +
    (companyId ? "&companyId=" + companyId : "") +
    (kind ? "&kind=" + kind : "");
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
            showFollow={!companyId}
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
            {session.user ? (
              <Link className="button primary full" to="/messages">
                Talk to a company
              </Link>
            ) : (
              <button className="button primary full" onClick={signIn}>
                Join the conversation
              </button>
            )}
          </section>
        )}
        <nav className="feed-shortcuts" aria-label="Community shortcuts">
          <Link to="/directory">
            <Building2 size={17} />
            Discover companies
          </Link>
          {session.user?.account_type !== "individual" && (
            <Link to="/network/connections">
              <Users size={17} />
              My network
            </Link>
          )}
          <Link to="/messages">
            <MessageCircle size={17} />
            Messages
          </Link>
        </nav>
        <p className="feed-small-print">
          Connect
          <br />
          Connect. Talk. Celebrate.
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
export function CompanyUpdates({
  target,
  preview = false,
}: {
  target: Company;
  preview?: boolean;
}) {
  const { company } = useApp();
  const [kind, setKind] = useState<PublicationKind | undefined>();
  return (
    <div className="company-updates">
      {!preview && company?.id === target.id && <ComposerLauncher />}
      <div className="publication-filters" aria-label="Publication type">
        <button aria-pressed={!kind} onClick={() => setKind(undefined)}>
          All updates
        </button>
        {formats.map((f) => (
          <button
            key={f.value}
            aria-pressed={kind === f.value}
            onClick={() => setKind(f.value)}
          >
            {f.label}
            {f.value === "post" ? "s" : ""}
          </button>
        ))}
      </div>
      <Feed companyId={target.id} kind={kind} />
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
          reading
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
