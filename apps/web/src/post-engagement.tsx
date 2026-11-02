import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Send,
  Share2,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import { Logo } from "./identity";
import { ReactionPicker } from "./reaction-picker";
import type { Company } from "./types";
import type { Post, UpdatePost } from "./social";
import "./post-engagement.css";

export type Reaction = { emoji: string; count: number; reacted: boolean };
export type PostComment = {
  id: string;
  sequence: string;
  body: string;
  company: Company;
  author_name: string;
  author_id: string;
  created_at: string;
  parent_id: string | null;
  reply_to_id: string | null;
  reply_to_name: string | null;
  reply_count: number;
  deleted_at: string | null;
  can_delete: boolean;
};
type CommentPage = { comments: PostComment[]; nextCursor: string | null };
type ReplyTarget = { id: string; rootId: string; name: string; body: string };
const combine = (old: PostComment[], incoming: PostComment[]) =>
  [
    ...new Map(
      [...old, ...incoming].map((comment) => [comment.id, comment]),
    ).values(),
  ].sort((a, b) =>
    BigInt(a.sequence) < BigInt(b.sequence)
      ? -1
      : BigInt(a.sequence) > BigInt(b.sequence)
        ? 1
        : 0,
  );
const timeAgo = (value: string) => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h`
        : new Date(value).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
};

function ReactionPeople({ item }: { item: Post }) {
  const { close, company, session } = useApp();
  const [filter, setFilter] = useState("");
  const [people, setPeople] = useState<
    {
      id: string;
      sequence: string;
      emoji: string;
      company: Company;
      user: { id: string; name: string };
      created_at: string;
    }[]
  >([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = async (after?: string) => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (filter) query.set("emoji", filter);
      if (after) query.set("after", after);
      const result = await api<{
        reactions: typeof people;
        nextCursor: string | null;
      }>(`/posts/${item.id}/reactions?${query}`);
      if (current !== generation.current) return;
      setPeople((old) =>
        after
          ? [
              ...new Map(
                [...old, ...result.reactions].map((person) => [
                  person.id,
                  person,
                ]),
              ).values(),
            ]
          : result.reactions,
      );
      setCursor(result.nextCursor);
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    setPeople([]);
    setCursor(null);
    void load();
    return () => {
      generation.current++;
    };
  }, [filter, item.id, company?.id, session.user?.id]);
  return (
    <section className="reaction-people" aria-label="Who reacted">
      <h2>Reactions</h2>
      <p>Companies joining the conversation.</p>
      <div
        className="reaction-people-filters"
        role="group"
        aria-label="Filter reactions"
      >
        <button aria-pressed={!filter} onClick={() => setFilter("")}>
          All <span>{item.reaction_count}</span>
        </button>
        {item.reactions.map((reaction) => (
          <button
            key={reaction.emoji}
            aria-pressed={filter === reaction.emoji}
            aria-label={`Show ${reaction.emoji} reactions`}
            onClick={() => setFilter(reaction.emoji)}
          >
            <span className="reaction-emoji" aria-hidden="true">
              {reaction.emoji}
            </span>{" "}
            {reaction.count}
          </button>
        ))}
      </div>
      <div className="reaction-people-list" aria-busy={loading}>
        {people.map((person) => (
          <div className="reaction-person" key={person.id}>
            <Link to={`/company/${person.company.slug}`} onClick={close}>
              <Logo company={person.company} />
            </Link>
            <div>
              <Link to={`/company/${person.company.slug}`} onClick={close}>
                {person.company.name}
              </Link>
              {person.user?.name && <span>{person.user.name}</span>}
            </div>
            <span className="reaction-emoji" aria-label={person.emoji}>
              {person.emoji}
            </span>
          </div>
        ))}
        {!loading && !error && !people.length && (
          <p className="conversation-empty">No reactions yet.</p>
        )}
      </div>
      {error && (
        <div className="conversation-error" role="alert">
          <p>{error}</p>
          <button
            onClick={() =>
              void load(people.length ? cursor || undefined : undefined)
            }
          >
            Try again
          </button>
        </div>
      )}
      {loading && (
        <p className="conversation-loading" role="status">
          <LoaderCircle className="spin" size={17} /> Loading reactions…
        </p>
      )}
      {cursor && !loading && (
        <button
          className="button reaction-people-more"
          onClick={() => void load(cursor)}
        >
          Load more reactions
        </button>
      )}
    </section>
  );
}

export function PostEngagement({
  item,
  onUpdated,
}: {
  item: Post;
  onUpdated: UpdatePost;
}) {
  const { company, session, signIn, createCompany, open, toast } = useApp();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [reacting, setReacting] = useState<string | null>(null);
  const reactionLock = useRef(false);
  const active = useRef(true);
  const reactionTrigger = useRef<HTMLElement | null>(null);
  const [error, setError] = useState("");
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const individual = session.user?.account_type === "individual";
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const ready = () => {
    if (!session.user) {
      signIn();
      return false;
    }
    if (!company) {
      if (!individual) createCompany();
      return false;
    }
    return true;
  };
  const chooseReaction = (element: HTMLElement) => {
    if (ready()) {
      reactionTrigger.current = element;
      setAnchor(element);
    }
  };
  useLayoutEffect(() => {
    if (!reacting && !anchor && reactionTrigger.current) {
      if (document.activeElement === document.body)
        reactionTrigger.current.focus({ preventScroll: true });
      reactionTrigger.current = null;
    }
  }, [reacting, anchor]);
  const react = async (emoji: string) => {
    if (!ready() || reactionLock.current) return;
    reactionLock.current = true;
    setReacting(emoji);
    setError("");
    try {
      const updated = await post<Post>(`/posts/${item.id}/reactions`, {
        emoji,
        reacted: !item.reactions.some(
          (reaction) => reaction.emoji === emoji && reaction.reacted,
        ),
      });
      if (!active.current) return;
      onUpdated(item.id, (current) => ({
        ...current,
        reactions: updated.reactions,
        reaction_count: updated.reaction_count,
        like_count: updated.like_count,
        liked: updated.liked,
      }));
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      reactionLock.current = false;
      if (active.current) setReacting(null);
    }
  };
  return (
    <>
      {(item.reactions.length > 0 || item.comment_count > 0) && (
        <div className="post-reaction-summary">
          <div
            className="post-reaction-chips"
            aria-label="Reactions"
            aria-busy={!!reacting}
          >
            {item.reactions.map((reaction) => (
              <button
                className="reaction-chip"
                key={reaction.emoji}
                aria-pressed={reaction.reacted}
                aria-label={`${reaction.reacted ? "Remove" : "Add"} ${reaction.emoji} reaction; ${reaction.count} ${reaction.count === 1 ? "company" : "companies"}`}
                title={
                  individual
                    ? "Company accounts can react"
                    : reaction.reacted
                      ? "Remove your company’s reaction"
                      : "Add your company’s reaction"
                }
                disabled={!!reacting || individual}
                onClick={() => void react(reaction.emoji)}
              >
                <span className="reaction-emoji" aria-hidden="true">
                  {reaction.emoji}
                </span>
                <span>{reaction.count}</span>
                {reacting === reaction.emoji && (
                  <LoaderCircle className="spin" size={13} />
                )}
              </button>
            ))}
            {item.reactions.length > 0 && (
              <button
                className="reaction-add"
                aria-label="Choose another reaction"
                disabled={!!reacting || individual}
                onClick={(event) => chooseReaction(event.currentTarget)}
              >
                <SmilePlus size={18} />
              </button>
            )}
          </div>
          <div className="post-conversation-counts">
            {item.reaction_count > 0 && (
              <button
                aria-label={`View ${item.reaction_count} reactions`}
                onClick={() => open(<ReactionPeople item={item} />)}
              >
                {item.reaction_count}{" "}
                {item.reaction_count === 1 ? "reaction" : "reactions"}
              </button>
            )}
            {item.comment_count > 0 && (
              <button
                aria-expanded={commentsOpen}
                aria-controls={`comments-${item.id}`}
                onClick={() => setCommentsOpen(!commentsOpen)}
              >
                {item.comment_count}{" "}
                {item.comment_count === 1 ? "comment" : "comments"}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="post-actions">
        <button
          disabled={!!reacting || individual}
          title={individual ? "Company accounts can react" : undefined}
          aria-haspopup="dialog"
          onClick={(event) => chooseReaction(event.currentTarget)}
        >
          {reacting ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <SmilePlus size={18} />
          )}
          <span>React</span>
        </button>
        <button
          aria-expanded={commentsOpen}
          aria-controls={`comments-${item.id}`}
          onClick={() => {
            setCommentsOpen(true);
            setFocusRequest((n) => n + 1);
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
      {error && (
        <p className="social-error" role="alert">
          {error}
        </p>
      )}
      {anchor && company && (
        <ReactionPicker
          anchor={anchor}
          companyName={company.name}
          onSelect={(emoji) => void react(emoji)}
          onClose={() => setAnchor(null)}
        />
      )}
      <CommentsPanel
        key={company?.id || session.user?.id || "guest"}
        item={item}
        onUpdated={onUpdated}
        expanded={commentsOpen}
        focusRequest={focusRequest}
        onClose={() => setCommentsOpen(false)}
      />
    </>
  );
}

function CommentBody({
  comment,
  rootId,
  onReply,
  onDelete,
  deleting,
  sending,
  canReply,
}: {
  comment: PostComment;
  rootId: string;
  onReply: (target: ReplyTarget) => void;
  onDelete: (comment: PostComment) => void;
  deleting: string | null;
  sending: boolean;
  canReply: boolean;
}) {
  return (
    <article
      className={
        "conversation-comment" + (comment.deleted_at ? " is-deleted" : "")
      }
      aria-label={`Comment by ${comment.company.name}`}
    >
      <Link
        className="conversation-comment-logo"
        to={`/company/${comment.company.slug}`}
      >
        <Logo company={comment.company} size="tiny" />
      </Link>
      <div className="conversation-comment-content">
        <header>
          <div>
            <Link to={`/company/${comment.company.slug}`}>
              {comment.company.name}
            </Link>
            <span>{comment.author_name}</span>
          </div>
          <time
            dateTime={comment.created_at}
            title={new Date(comment.created_at).toLocaleString()}
          >
            {timeAgo(comment.created_at)}
          </time>
          {comment.can_delete && !comment.deleted_at && (
            <details className="conversation-comment-menu">
              <summary className="icon-button" aria-label="Comment options">
                <MoreHorizontal size={18} />
              </summary>
              <div className="dropdown">
                <button
                  className="danger-text"
                  disabled={!!deleting || sending}
                  onClick={() => onDelete(comment)}
                >
                  {deleting === comment.id ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  Delete comment
                </button>
              </div>
            </details>
          )}
        </header>
        {comment.deleted_at ? (
          <p className="comment-tombstone">This comment was deleted.</p>
        ) : (
          <>
            {comment.reply_to_name && (
              <span className="comment-reply-to">
                <CornerDownRight size={13} /> Replying to{" "}
                {comment.reply_to_name}
              </span>
            )}
            <p>{comment.body}</p>
            {canReply && (
              <button
                className="conversation-reply"
                disabled={sending}
                onClick={() =>
                  onReply({
                    id: comment.id,
                    rootId,
                    name: comment.company.name,
                    body: comment.body,
                  })
                }
              >
                Reply
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function CommentThread({
  root,
  postId,
  freshReplies,
  removed,
  forcedOpen,
  onReply,
  onDelete,
  deleting,
  sending,
  canReply,
}: {
  root: PostComment;
  postId: string;
  freshReplies: PostComment[];
  removed: Set<string>;
  forcedOpen: boolean;
  onReply: (target: ReplyTarget) => void;
  onDelete: (comment: PostComment) => void;
  deleting: string | null;
  sending: boolean;
  canReply: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [replies, setReplies] = useState<PostComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = async (after?: string) => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await api<CommentPage>(
        `/posts/${postId}/comments/${root.id}/replies${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      );
      if (current !== generation.current) return;
      setReplies((old) =>
        after ? combine(old, result.comments) : result.comments,
      );
      setCursor(result.nextCursor);
      setLoaded(true);
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (forcedOpen || freshReplies.length) setExpanded(true);
  }, [forcedOpen, freshReplies.length]);
  useEffect(() => {
    if (expanded && !loaded && !loading) void load();
  }, [expanded]);
  const known = new Set(replies.map((reply) => reply.id));
  const tail = freshReplies.filter(
    (reply) => !known.has(reply.id) && !removed.has(reply.id),
  );
  const visible = (cursor ? replies : combine(replies, tail)).filter(
    (reply) => !removed.has(reply.id),
  );
  const render = (comment: PostComment) => (
    <CommentBody
      key={comment.id}
      comment={comment}
      rootId={root.id}
      onReply={onReply}
      onDelete={onDelete}
      deleting={deleting}
      sending={sending}
      canReply={canReply}
    />
  );
  return (
    <div className="conversation-thread">
      {render(root)}
      {(root.reply_count > 0 || freshReplies.length > 0) && (
        <button
          className="conversation-thread-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {expanded
            ? "Hide replies"
            : `${root.reply_count} ${root.reply_count === 1 ? "reply" : "replies"}`}
        </button>
      )}
      {expanded && (
        <div
          className="conversation-replies"
          aria-label={`Replies to ${root.company.name}`}
        >
          {visible.map(render)}
          {error && (
            <div className="conversation-error" role="alert">
              <p>{error}</p>
              <button onClick={() => void load(cursor || undefined)}>
                Try again
              </button>
            </div>
          )}
          {loading && (
            <p className="conversation-loading" role="status">
              <LoaderCircle className="spin" size={15} /> Loading replies…
            </p>
          )}
          {cursor && !loading && (
            <button
              className="conversation-load"
              onClick={() => void load(cursor)}
            >
              Load more replies
            </button>
          )}
          {cursor && tail.map(render)}
        </div>
      )}
    </div>
  );
}

function CommentsPanel({
  item,
  onUpdated,
  expanded,
  focusRequest,
  onClose,
}: {
  item: Post;
  onUpdated: UpdatePost;
  expanded: boolean;
  focusRequest: number;
  onClose: () => void;
}) {
  const { company, session, signIn, createCompany } = useApp();
  const [comments, setComments] = useState<PostComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const mutationLock = useRef(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reply, setReply] = useState<ReplyTarget | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [freshReplies, setFreshReplies] = useState<
    Record<string, PostComment[]>
  >({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const field = useRef<HTMLTextAreaElement>(null);
  const generation = useRef(0);
  const active = useRef(true);
  const draftKey = reply?.id || "root";
  const body = drafts[draftKey] || "";
  const allowed = !!session.user && !!company;
  const load = async (before?: string) => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await api<CommentPage>(
        `/posts/${item.id}/comments${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      );
      if (current !== generation.current) return;
      setComments((old) => combine(old, result.comments));
      setCursor(result.nextCursor);
      setLoaded(true);
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (expanded && !loaded && !loading) void load();
  }, [expanded]);
  useLayoutEffect(() => {
    if (expanded && focusRequest)
      field.current?.focus({ preventScroll: false });
  }, [expanded, focusRequest, loaded]);
  useLayoutEffect(() => {
    if (!field.current) return;
    field.current.style.height = "auto";
    field.current.style.height =
      Math.min(field.current.scrollHeight, 180) + "px";
  }, [body, expanded, reply]);
  const startReply = (target: ReplyTarget) => {
    setReply(target);
    setError("");
  };
  useLayoutEffect(() => {
    if (reply && expanded) field.current?.focus();
  }, [reply]);
  const send = async () => {
    if (!body.trim() || mutationLock.current || !allowed) return;
    mutationLock.current = true;
    setSending(true);
    setError("");
    const target = reply,
      key = draftKey;
    try {
      const updated = await post<Post & { created_comment: PostComment }>(
        `/posts/${item.id}/comments`,
        { body: body.trim(), ...(target ? { parentId: target.id } : {}) },
      );
      if (!active.current) return;
      onUpdated(item.id, (current) => ({
        ...current,
        comment_count: updated.comment_count,
      }));
      const created = updated.created_comment;
      if (created?.parent_id) {
        setFreshReplies((old) => ({
          ...old,
          [created.parent_id!]: combine(old[created.parent_id!] || [], [
            created,
          ]),
        }));
        setComments((old) =>
          old.map((comment) =>
            comment.id === created.parent_id
              ? { ...comment, reply_count: comment.reply_count + 1 }
              : comment,
          ),
        );
      } else if (created) setComments((old) => combine(old, [created]));
      else await load();
      setDrafts((old) => ({ ...old, [key]: "" }));
      setReply(null);
      field.current?.focus({ preventScroll: true });
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      mutationLock.current = false;
      if (active.current) setSending(false);
    }
  };
  const remove = async (comment: PostComment) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setDeleting(comment.id);
    setError("");
    try {
      const updated = await api<Post>(
        `/posts/${item.id}/comments/${comment.id}`,
        { method: "DELETE" },
      );
      if (!active.current) return;
      onUpdated(item.id, (current) => ({
        ...current,
        comment_count: updated.comment_count,
      }));
      if (comment.parent_id) {
        setRemoved((old) => new Set([...old, comment.id]));
        setComments((old) =>
          old
            .map((root) =>
              root.id === comment.parent_id
                ? { ...root, reply_count: Math.max(0, root.reply_count - 1) }
                : root,
            )
            .filter((root) => !root.deleted_at || root.reply_count > 0),
        );
      } else if (comment.reply_count)
        setComments((old) =>
          old.map((root) =>
            root.id === comment.id
              ? {
                  ...root,
                  body: "",
                  deleted_at: new Date().toISOString(),
                  can_delete: false,
                }
              : root,
          ),
        );
      else setComments((old) => old.filter((root) => root.id !== comment.id));
      if (reply?.id === comment.id) setReply(null);
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      mutationLock.current = false;
      if (active.current) setDeleting(null);
    }
  };
  return (
    <section
      className="post-conversation"
      id={`comments-${item.id}`}
      aria-label="Comments"
      hidden={!expanded}
    >
      <header className="conversation-heading">
        <h3>Conversation</h3>
        <button
          className="icon-button"
          aria-label="Hide comments"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      {cursor && (
        <button
          className="conversation-load"
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          View earlier comments
        </button>
      )}
      <div className="conversation-threads" aria-busy={loading}>
        {comments.map((comment) => (
          <CommentThread
            key={comment.id}
            root={comment}
            postId={item.id}
            freshReplies={freshReplies[comment.id] || []}
            removed={removed}
            forcedOpen={reply?.rootId === comment.id}
            onReply={startReply}
            onDelete={(value) => void remove(value)}
            deleting={deleting}
            sending={sending}
            canReply={allowed}
          />
        ))}
        {!comments.length && !loading && loaded && !error && (
          <p className="conversation-empty">
            Start the conversation. Ask a question or share a thought.
          </p>
        )}
        {loading && (
          <p className="conversation-loading" role="status">
            <LoaderCircle className="spin" size={17} /> Loading comments…
          </p>
        )}
      </div>
      {error && (
        <div className="conversation-error" role="alert">
          <p>{error}</p>
          {!loaded && <button onClick={() => void load()}>Try again</button>}
        </div>
      )}
      {allowed ? (
        <form
          className="conversation-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="conversation-writing-as">
            <Logo company={company!} size="tiny" />
            <span>
              Writing as <strong>{company!.name}</strong>
            </span>
          </div>
          {reply && (
            <div className="conversation-reply-context">
              <div>
                <span>
                  Replying to <strong>{reply.name}</strong>
                </span>
                <p>{reply.body}</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Cancel reply"
                disabled={sending}
                onClick={() => {
                  setReply(null);
                  field.current?.focus();
                }}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <textarea
            ref={field}
            aria-label={reply ? "Write a reply" : "Write a comment"}
            placeholder={
              reply ? "Write your reply…" : "Add to the conversation…"
            }
            rows={2}
            maxLength={1500}
            readOnly={sending}
            value={body}
            onChange={(event) =>
              setDrafts((old) => ({ ...old, [draftKey]: event.target.value }))
            }
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <footer>
            <span>{body.length > 1200 ? `${body.length}/1,500` : ""}</span>
            <button
              className="button primary"
              aria-label={reply ? "Send reply" : "Send comment"}
              disabled={sending || !!deleting || !body.trim()}
            >
              {sending ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Send size={16} />
              )}
              <span>{reply ? "Reply" : "Send"}</span>
            </button>
          </footer>
        </form>
      ) : session.user?.account_type === "individual" ? (
        <p className="conversation-join-note">
          Comments and reactions are shared by companies. You can{" "}
          <Link to={`/company/${item.company.slug}`}>
            follow or message {item.company.name}
          </Link>
          .
        </p>
      ) : (
        <button
          className="conversation-join"
          onClick={() => (session.user ? createCompany() : signIn())}
        >
          Sign in with your company to join the conversation
        </button>
      )}
    </section>
  );
}
