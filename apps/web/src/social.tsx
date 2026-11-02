import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Image as ImageIcon,
  FileText,
  Globe,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MessageCircle,
  Plus,
  Check,
  MoreHorizontal,
  Trash2,
  X,
  ArrowLeft,
  ArrowRight,
  LoaderCircle,
  RefreshCw,
  Building2,
} from "lucide-react";
import { useApp } from "./context";
import { Logo } from "./identity";
import { api, post } from "./api";
import type { Company } from "./types";
import { PostEngagement, type Reaction } from "./post-engagement";
import {
  Publisher,
  DraftsDialog,
  formats,
  RichDocument,
  publicationLabel,
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
export type Post = {
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
  reactions: Reaction[];
  reaction_count: number;
  following: boolean;
  media: Media[];
};
export type UpdatePost = (id: string, update: (current: Post) => Post) => void;
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
        The post, its attachments, reactions, and comments will be removed.
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
function MediaGallery({
  media,
  companyName,
}: {
  media: Media[];
  companyName: string;
}) {
  const { open } = useApp();
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [ratio, setRatio] = useState("1 / 1");
  const photos = media.filter((m) => m.mime.startsWith("image/"));
  const go = (index: number, moveFocus = false) => {
    const el = track.current;
    if (!el) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (moveFocus)
      (el.children[index] as HTMLElement | undefined)?.focus({
        preventScroll: true,
      });
    el.scrollTo({
      left: index * el.clientWidth,
      behavior: reduced ? "instant" : "smooth",
    });
  };
  return (
    <div className="post-media">
      {photos.length > 0 && (
        <div
          className="photo-gallery"
          role="region"
          aria-roledescription="carousel"
          aria-label={`Photos from ${companyName}`}
        >
          <div
            className="photo-track"
            ref={track}
            style={{ aspectRatio: ratio }}
            onScroll={(event) => {
              const el = event.currentTarget;
              setActive(
                Math.round(el.scrollLeft / Math.max(1, el.clientWidth)),
              );
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                go(
                  Math.min(
                    photos.length - 1,
                    Math.max(0, active + (event.key === "ArrowRight" ? 1 : -1)),
                  ),
                  true,
                );
              }
            }}
          >
            {photos.map((m, index) => (
              <button
                className="post-photo"
                key={m.id}
                tabIndex={active === index ? 0 : -1}
                aria-label={
                  "View " + (m.alt || `photo ${index + 1} from ${companyName}`)
                }
                onClick={() =>
                  open(
                    <div className="post-lightbox">
                      <img
                        src={m.url}
                        alt={m.alt || "Photo shared by " + companyName}
                      />
                      {m.alt && <p>{m.alt}</p>}
                    </div>,
                  )
                }
              >
                <img
                  src={m.url}
                  alt={m.alt || "Photo shared by " + companyName}
                  loading="lazy"
                  decoding="async"
                  onLoad={(event) => {
                    if (index === 0) {
                      const img = event.currentTarget;
                      const r =
                        img.naturalWidth / Math.max(1, img.naturalHeight);
                      setRatio(
                        r < 0.9 ? "4 / 5" : r > 1.3 ? "16 / 9" : "1 / 1",
                      );
                    }
                  }}
                />
              </button>
            ))}
          </div>
          {photos.length > 1 && (
            <div className="photo-pagination">
              <button
                className="icon-button"
                aria-label="Previous photo"
                disabled={active === 0}
                onClick={() => go(active - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <span role="status" aria-live="polite">
                {active + 1} / {photos.length}
              </span>
              <div className="photo-dots" aria-hidden="true">
                {photos.map((m, index) => (
                  <i key={m.id} className={active === index ? "active" : ""} />
                ))}
              </div>
              <button
                className="icon-button"
                aria-label="Next photo"
                disabled={active === photos.length - 1}
                onClick={() => go(active + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>
      )}
      {media
        .filter((m) => !m.mime.startsWith("image/"))
        .map((m) =>
          m.mime.startsWith("video/") ? (
            <video
              key={m.id}
              src={m.url}
              controls
              playsInline
              preload="metadata"
              aria-label={"Video from " + companyName}
            />
          ) : (
            <a key={m.id} href={m.url} className="post-document">
              <FileText size={28} />
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
  onUpdated: UpdatePost;
  onDeleted: () => void;
}) {
  const { company, session, admin, open } = useApp();
  const [expanded, setExpanded] = useState(false);
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
            <FileText size={14} /> {publicationLabel(item.kind)}
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
                loading="lazy"
                decoding="async"
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
                Read {publicationLabel(item.kind).toLowerCase()}
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
      {item.media.length > 0 && (item.kind === "post" || reading) && (
        <MediaGallery
          companyName={item.company.name}
          media={item.media.filter(
            (m) =>
              item.kind === "post" ||
              !m.mime.startsWith("image/") ||
              (!JSON.stringify(item.document).includes(m.id) &&
                m.id !== item.cover_media_id),
          )}
        />
      )}
      <PostEngagement
        key={`${item.id}:${company?.id || session.user?.id || "guest"}`}
        item={item}
        onUpdated={onUpdated}
      />
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
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{ posts: Post[]; nextCursor: string | null }>(query, {
      signal: controller.signal,
    })
      .then((r) => {
        if (generation.current === current && !controller.signal.aborted) {
          setPosts(r.posts);
          setNext(r.nextCursor);
        }
      })
      .catch((e) => {
        if (generation.current === current && !controller.signal.aborted)
          setError(e.message);
      })
      .finally(() => {
        if (generation.current === current && !controller.signal.aborted)
          setLoading(false);
      });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [query, revision, company?.id]);
  const update: UpdatePost = (id, change) =>
    setPosts((items) =>
      items.map((item) => (item.id === id ? change(item) : item)),
    );
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
            const current = generation.current;
            try {
              const r = await api<{ posts: Post[]; nextCursor: string | null }>(
                query + "&before=" + next,
              );
              if (current !== generation.current) return;
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
      <p>Meet the teams moving solar forward.</p>
      {list.slice(0, 3).map((c) => (
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
  const { company, session, signIn, refresh, admin, open } = useApp();
  const [scope, setScope] = useState<"all" | "following">("all");
  const [kind, setKind] = useState<PublicationKind | undefined>();
  useEffect(() => {
    if (!session.user) setScope("all");
  }, [session.user?.id]);
  return (
    <div className="newsroom">
      <header className="newsroom-heading">
        <div>
          <span className="newsroom-eyebrow">
            <i /> CONNECT. TALK. CELEBRATE.
          </span>
          <h1>The industry, in motion.</h1>
          <p>Project progress. Company news. Work worth celebrating.</p>
        </div>
        <Link className="newsroom-directory" to="/directory">
          Discover companies <ArrowRight size={17} />
        </Link>
      </header>
      <div className="feed-layout">
        <section className="feed-stream" aria-label="Company feed">
          <ComposerLauncher />
          <div className="feed-controls">
            <div className="feed-tabs">
              <div
                role="tablist"
                aria-label="Feed"
                onKeyDown={(event) => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  )
                    return;
                  event.preventDefault();
                  if (!session.user) return signIn();
                  const nextScope =
                    event.key === "Home"
                      ? "all"
                      : event.key === "End"
                        ? "following"
                        : scope === "all"
                          ? "following"
                          : "all";
                  setScope(nextScope);
                  document.getElementById(`feed-tab-${nextScope}`)?.focus();
                }}
              >
                <button
                  role="tab"
                  id="feed-tab-all"
                  aria-controls="feed-results"
                  tabIndex={scope === "all" ? 0 : -1}
                  aria-selected={scope === "all"}
                  onClick={() => setScope("all")}
                >
                  All posts
                </button>
                <button
                  role="tab"
                  id="feed-tab-following"
                  aria-controls="feed-results"
                  tabIndex={scope === "following" ? 0 : -1}
                  aria-selected={scope === "following"}
                  onClick={() => {
                    if (!session.user) return signIn();
                    setScope("following");
                  }}
                >
                  Following
                </button>
              </div>
            </div>
            <label className="feed-type-select">
              <span className="sr-only">Feed publication type</span>
              <select
                value={kind || ""}
                title={
                  kind === "press_release"
                    ? "Press releases"
                    : kind === "post"
                      ? "Posts"
                      : "All types"
                }
                onChange={(event) =>
                  setKind(
                    (event.target.value || undefined) as
                      PublicationKind | undefined,
                  )
                }
              >
                <option value="">All types</option>
                <option value="post">Posts</option>
                <option value="press_release">Press releases</option>
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </label>
            <button
              className="icon-button feed-refresh"
              aria-label="Refresh feed"
              title="Refresh feed"
              onClick={refresh}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          <div
            id="feed-results"
            role="tabpanel"
            aria-labelledby={`feed-tab-${scope}`}
          >
            <Feed
              key={`${scope}:${kind || "all"}:${company?.id || "guest"}`}
              scope={scope}
              kind={kind}
            />
          </div>
        </section>
        <aside className="feed-right-rail" aria-label="Around Connect">
          {company && (
            <section className="newsroom-workspace">
              <span className="rail-eyebrow">YOUR COMPANY</span>
              <Link
                className="workspace-identity"
                to={"/company/" + company.slug}
              >
                <Logo company={company} />
                <div>
                  <strong>{company.name}</strong>
                  <span>
                    View your public profile <ArrowRight size={14} />
                  </span>
                </div>
              </Link>
              {admin && (
                <button
                  className="workspace-drafts"
                  onClick={() => open(<DraftsDialog />)}
                >
                  <FileText size={17} />
                  Your drafts
                  <ArrowRight size={15} />
                </button>
              )}
            </section>
          )}
          <Suggestions />
          <p className="feed-small-print">
            A place for the people and companies
            <br />
            building what’s next in solar.
          </p>
        </aside>
      </div>
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
            {f.label}s
          </button>
        ))}
      </div>
      <Feed
        key={`${target.id}:${kind || "all"}`}
        companyId={target.id}
        kind={kind}
      />
    </div>
  );
}
export function PostPage() {
  const { id } = useParams();
  const { company, session } = useApp();
  const [data, setData] = useState<Post | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    api<Post>("/posts/" + id, { signal: controller.signal })
      .then((post) => {
        if (!controller.signal.aborted) setData(post);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [id, company?.id, session.user?.id]);
  return (
    <div className="single-post">
      <Link className="back-link" to="/">
        <ArrowLeft size={15} />
        Back to feed
      </Link>
      <ErrorNote error={error} />
      {data ? (
        <PostCard
          key={`${data.id}:${company?.id || session.user?.id || "guest"}`}
          item={data}
          reading
          onUpdated={(postId, change) =>
            setData((current) =>
              current?.id === postId ? change(current) : current,
            )
          }
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
