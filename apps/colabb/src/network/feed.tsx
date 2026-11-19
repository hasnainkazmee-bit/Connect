import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Bookmark,
  Heart,
  ThumbsUp,
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Flag,
  EyeOff,
  Trash2,
  Check,
  RotateCcw,
  FilePlus2,
} from "lucide-react";
import { useApp } from "../context";
import { networkApi, networkError, networkPost, networkTime } from "./client";
import { CompanyLogo, NetworkState, companyPath } from "./common";
import { MentionText } from "./mentions";
import { NetworkMedia } from "./media";
import type {
  NetworkAttachment,
  NetworkBootstrap,
  NetworkList,
  NetworkPost as Post,
} from "./types";
export type PostActions = {
  onPost: (id: string) => void;
  onFile: (file: NetworkAttachment) => void;
  onNavigate: (path: string) => void;
  onChanged?: () => void;
  // Optional adapters let public product examples use the real UI without API writes.
  onState?: (id: string, action: string, value: boolean | string) => Promise<void>;
  fileUrl?: (file: NetworkAttachment) => string;
};
export function NetworkPostCard({
  post: initial,
  actions,
  detail = false,
  onUpdated,
}: {
  post: Post;
  actions: PostActions;
  detail?: boolean;
  onUpdated?: (post: Post) => void;
}) {
  const [post, setPost] = useState(initial),
    [menu, setMenu] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [hidden, setHidden] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => setPost(initial), [initial]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);
  async function state(action: string, value: boolean | string) {
    setBusy(action);
    setError("");
    try {
      if (actions.onState) await actions.onState(post.id, action, value);
      else await networkPost(`/posts/${post.id}/state`, { action, value });
      if (action === "hide") setHidden(!!value);
      let next = post;
      if (action === "like")
        next = {
          ...post,
          liked: !!value,
          reaction_count: Math.max(0, post.reaction_count + (value ? 1 : -1)),
        };
      if (action === "save") next = { ...post, saved: !!value };
      if (action === "comments")
        next = {
          ...post,
          comments_open: !!value,
          can_comment: !!value,
          version: post.version + 1,
        };
      if (action === "sourcing")
        next = {
          ...post,
          sourcing_status: value as Post["sourcing_status"],
          version: post.version + 1,
        };
      setPost(next);
      onUpdated?.(next);
      setMenu(false);
    } catch (e) {
      setError(networkError(e));
    } finally {
      setBusy("");
    }
  }
  if (hidden)
    return (
      <div className="nw-hidden">
        <span>Post hidden from your feed.</span>
        <button onClick={() => state("hide", false)} disabled={!!busy}>
          Undo
        </button>
      </div>
    );
  return (
    <article
      className={`nw-post ${detail ? "nw-post-detail" : ""}`}
      aria-label={`Post from ${post.company?.name || post.author.name}`}
    >
      <header className="nw-post-author">
        <Link
          to={companyPath(post.company)}
          aria-label={`Open ${post.company.name}`}
        >
          <CompanyLogo company={post.company} />
        </Link>
        <div>
          <Link className="nw-author" to={companyPath(post.company)}>
            {post.company.name}
          </Link>
          <p>
            {post.author.name}
            <span> · </span>
            <time dateTime={post.created_at}>
              {networkTime(post.created_at)}
            </time>
            {post.updated_at && post.updated_at !== post.created_at && (
              <span> · Edited</span>
            )}
          </p>
        </div>
        <div className="nw-post-menu" ref={menuRef}>
          <button
            className="nw-icon"
            onClick={() => setMenu((v) => !v)}
            aria-label="Post options"
            aria-expanded={menu}
          >
            <MoreHorizontal size={20} />
          </button>
          {menu && (
            <div className="nw-menu" role="menu">
              {post.can_edit && (
                <>
                  <button
                    role="menuitem"
                    onClick={() => actions.onNavigate(`/posts/${post.id}/edit`)}
                  >
                    <Pencil size={16} />
                    Edit post
                  </button>
                  <button
                    role="menuitem"
                    disabled={!!busy}
                    onClick={() => state("comments", !post.comments_open)}
                  >
                    <MessageCircle size={16} />
                    {post.comments_open
                      ? "Turn off comments"
                      : "Turn on comments"}
                  </button>
                  {["sourcing", "available"].includes(post.kind) && (
                    <button
                      role="menuitem"
                      disabled={!!busy}
                      onClick={() =>
                        state(
                          "sourcing",
                          post.sourcing_status === "open"
                            ? post.kind === "sourcing"
                              ? "sourced"
                              : "unavailable"
                            : "open",
                        )
                      }
                    >
                      <Check size={16} />
                      {post.sourcing_status === "open"
                        ? post.kind === "sourcing"
                          ? "Mark as sourced"
                          : "Mark unavailable"
                        : "Reopen request"}
                    </button>
                  )}
                </>
              )}
              {post.can_delete && (
                <button
                  role="menuitem"
                  onClick={() => actions.onNavigate(`/posts/${post.id}/delete`)}
                >
                  <Trash2 size={16} />
                  Delete post
                </button>
              )}
              {!post.can_edit && (
                <>
                  <button
                    role="menuitem"
                    disabled={!!busy}
                    onClick={() => state("hide", true)}
                  >
                    <EyeOff size={16} />
                    Hide this post
                  </button>
                  <button
                    role="menuitem"
                    onClick={() =>
                      actions.onNavigate(`/posts/${post.id}/report`)
                    }
                  >
                    <Flag size={16} />
                    Report post
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </header>
      <div className="nw-post-copy">
        {post.community_id && (
          <button
            className="nw-community-label"
            onClick={() =>
              actions.onNavigate(`/communities/${post.community_id}`)
            }
          >
            {post.community_name}
            {post.topic_label ? ` · ${post.topic_label}` : ""}
            <ArrowUpRight size={13} />
          </button>
        )}
        {post.post_type_label && (
          <span className="nw-badge">{post.post_type_label}</span>
        )}
        {post.title &&
          (detail ? (
            <h1>{post.title}</h1>
          ) : (
            <button
              className="nw-post-title"
              onClick={() => actions.onPost(post.id)}
            >
              {post.title}
            </button>
          ))}
        <p className="nw-post-body">
          <MentionText text={post.body} mentions={post.mentions} />
        </p>
        {post.answers?.length > 0 && (
          <dl className="nw-post-facts">
            {post.answers
              .filter((a) => String(a.value).trim())
              .map((a) => (
                <div key={a.field_id}>
                  <dt>{a.label}</dt>
                  <dd>
                    {a.value}
                    {a.unit ? ` ${a.unit}` : ""}
                  </dd>
                </div>
              ))}
          </dl>
        )}
        {post.sourcing_status !== "open" && (
          <span className="nw-badge">
            <Check size={13} />
            {post.sourcing_status === "sourced"
              ? "Sourced"
              : "No longer available"}
          </span>
        )}
      </div>
      <NetworkMedia
        files={post.files || []}
        format={post.media_format}
        onOpen={actions.onFile}
        fileUrl={actions.fileUrl}
        onOpenPost={detail ? undefined : () => actions.onPost(post.id)}
      />
      <footer className="nw-post-footer">
        <div className={`nw-reactions${detail && post.community_id ? " nw-community-reactions" : ""}`}>
          <button
            aria-label={post.liked ? "Unlike post" : "Like post"}
            aria-pressed={post.liked}
            disabled={!!busy}
            onClick={() => state("like", !post.liked)}
          >
            {detail && post.community_id ? <><ThumbsUp size={18} /><span>{post.liked ? "Liked" : "Like"}</span></> : <Heart size={23} />}
          </button>
          <button
            aria-label={
              post.comment_count > 0
                ? `Read ${post.comment_count} ${post.comment_count === 1 ? "comment" : "comments"}`
                : "Read comments"
            }
            onClick={() => actions.onPost(post.id)}
          >
            <MessageCircle size={detail && post.community_id ? 18 : 23} />
            {detail && post.community_id && <span>Comment</span>}
            {post.comment_count > 0 && (
              <span className="nw-comment-total" aria-hidden="true">
                {post.comment_count}
              </span>
            )}
          </button>
          <button
            aria-label={post.saved ? "Unsave post" : "Save post"}
            aria-pressed={post.saved}
            disabled={!!busy}
            onClick={() => state("save", !post.saved)}
          >
            <Bookmark size={detail && post.community_id ? 18 : 23} />
            {detail && post.community_id && <span>{post.saved ? "Saved" : "Save"}</span>}
          </button>
        </div>
        {post.reaction_count > 0 && (
          <strong className="nw-reaction-count">
            {post.reaction_count} {post.reaction_count === 1 ? "like" : "likes"}
          </strong>
        )}
        {!detail && (
          <button
            className="nw-comment-count"
            onClick={() => actions.onPost(post.id)}
          >
            {post.comment_count
              ? `View ${post.comment_count === 1 ? "1 comment" : `all ${post.comment_count} comments`}`
              : post.comments_open
                ? "Be the first to comment"
                : "Comments are turned off"}
          </button>
        )}
        {error && (
          <p className="nw-error" role="alert">
            {error}
          </p>
        )}
      </footer>
    </article>
  );
}
export function NetworkFeed({
  bootstrap,
  mode = "all",
  companyId,
  revision,
  actions,
  onCompose,
}: {
  bootstrap: NetworkBootstrap;
  mode?: "all" | "saved";
  companyId?: string;
  revision: number;
  actions: PostActions;
  onCompose: () => void;
}) {
  const [posts, setPosts] = useState<Post[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false),
    [error, setError] = useState("");
  const query = new URLSearchParams({
    limit: "20",
    ...(mode === "saved" ? { saved: "true" } : {}),
    ...(companyId ? { company_id: companyId } : {}),
  }).toString();
  const load = async (append = false, signal?: AbortSignal) => {
    append ? setMore(true) : setLoading(true);
    setError("");
    try {
      const data = await networkApi<NetworkList<Post>>(
        `/posts?${query}${append && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { signal },
      );
      setPosts((p) =>
        append
          ? [...p, ...data.items.filter((v) => !p.some((i) => i.id === v.id))]
          : data.items,
      );
      setCursor(data.next_cursor);
    } catch (e) {
      if (!signal?.aborted) setError(networkError(e));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setMore(false);
      }
    }
  };
  useEffect(() => {
    const c = new AbortController();
    void load(false, c.signal);
    return () => c.abort();
  }, [query, revision]);
  return (
    <div className="nw-feed-stream">
      {mode !== "saved" &&
        (!companyId || bootstrap.viewer.company?.id === companyId) &&
        bootstrap.viewer.can_publish && (
          <div className="nw-composer-prompt nw-panel">
            <CompanyLogo company={bootstrap.viewer.company} />
            <button onClick={onCompose}>
              Share something from {bootstrap.viewer.company?.name}…
            </button>
            <button
              className="nw-icon"
              aria-label="Create a photo post"
              onClick={onCompose}
            >
              <ImagePlus size={21} />
            </button>
          </div>
        )}
      {mode === "saved" && (
        <div className="nw-section-heading">
          <h1>Saved posts</h1>
          <p>Useful ideas and conversations, kept together.</p>
        </div>
      )}
      {loading ? (
        <NetworkState loading />
      ) : error && !posts.length ? (
        <NetworkState error={error} retry={() => load()} />
      ) : !posts.length ? (
        <NetworkState
          title={
            mode === "saved"
              ? "Keep something worth coming back to"
              : "Your network starts here"
          }
        >
          <p>
            {mode === "saved"
              ? "Save a post using its bookmark. It’ll be here when you need it."
              : "Follow companies to see their news, work and ideas. Join a community to start a conversation."}
          </p>
          {mode !== "saved" && (
            <button
              className="nw-button"
              onClick={() => actions.onNavigate("/communities")}
            >
              Explore communities
              <ArrowUpRight size={16} />
            </button>
          )}
        </NetworkState>
      ) : (
        posts.map((post) => (
          <NetworkPostCard key={post.id} post={post} actions={actions} />
        ))
      )}
      {error && posts.length > 0 && (
        <p className="nw-error" role="alert">
          {error}
          <button className="nw-text" onClick={() => load(true)}>
            Try again
          </button>
        </p>
      )}
      {cursor && (
        <div className="nw-load-more">
          <button
            className="nw-button"
            disabled={more}
            onClick={() => load(true)}
          >
            {more ? "Loading…" : "More posts"}
          </button>
        </div>
      )}
    </div>
  );
}
export function CompanySuggestions({
  bootstrap,
  onRefresh,
}: {
  bootstrap: NetworkBootstrap;
  onRefresh: () => void;
}) {
  const [following, setFollowing] = useState<string[]>(
      bootstrap.following_company_ids || [],
    ),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  useEffect(
    () => setFollowing(bootstrap.following_company_ids || []),
    [bootstrap.following_company_ids],
  );
  async function toggle(id: string) {
    setBusy(id);
    setError("");
    try {
      const follow = !following.includes(id);
      await networkPost(`/companies/${id}/follow`, { following: follow });
      setFollowing((p) => (follow ? [...p, id] : p.filter((v) => v !== id)));
      onRefresh();
    } catch (e) {
      setError(networkError(e));
    } finally {
      setBusy("");
    }
  }
  const suggestions = bootstrap.suggested_companies
    .filter(
      (c) => c.id !== bootstrap.viewer.company?.id && !following.includes(c.id),
    )
    .slice(0, 3);
  return (
    <section className="nw-panel nw-suggestions">
      <h2>Companies to follow</h2>
      <p className="nw-muted">Stay close to the work happening in solar.</p>
      {suggestions.length ? (
        suggestions.map((company) => (
          <div className="nw-suggestion" key={company.id}>
            <Link to={companyPath(company)} className="nw-company-identity">
              <CompanyLogo company={company} />
              <strong>{company.name}</strong>
            </Link>
            {company.tagline && <p>{company.tagline}</p>}
            {company.location && <small>{company.location}</small>}
            <button
              className="nw-button"
              disabled={busy === company.id}
              aria-pressed={following.includes(company.id)}
              onClick={() => toggle(company.id)}
            >
              {following.includes(company.id) ? (
                <>
                  <Check size={15} />
                  Following
                </>
              ) : (
                "+ Follow"
              )}
            </button>
          </div>
        ))
      ) : (
        <p className="nw-muted">
          Find companies in the directory and follow their work.
        </p>
      )}
      <Link to="/providers" className="nw-text">
        Find a company
        <ArrowUpRight size={15} />
      </Link>
      {error && (
        <p className="nw-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
