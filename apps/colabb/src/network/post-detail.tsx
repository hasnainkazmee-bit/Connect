import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CornerDownRight,
  ArrowUp,
  MessageCircle,
  X,
  LockKeyhole,
} from "lucide-react";
import { BackButton, NetworkState, useNetworkResource } from "./common";
import {
  networkApi,
  networkDelete,
  networkError,
  networkPatch,
  networkPost,
  networkTime,
} from "./client";
import { NetworkPostCard, type PostActions } from "./feed";
import { MentionInput, MentionText } from "./mentions";
import type {
  NetworkBootstrap,
  NetworkComment,
  NetworkList,
  NetworkPost,
} from "./types";
export function PostDetail({
  id,
  actions,
  bootstrap,
  onBack,
}: {
  id: string;
  actions: PostActions;
  bootstrap: NetworkBootstrap;
  onBack: () => void;
}) {
  const resource = useNetworkResource<{ post: NetworkPost }>(`/posts/${id}`),
    comments = useNetworkResource<NetworkList<NetworkComment>>(
      `/posts/${id}/comments?limit=50`,
    );
  const [body, setBody] = useState(""),
    [reply, setReply] = useState<NetworkComment | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [mentions, setMentions] = useState<string[]>([]),
    [companyMentions, setCompanyMentions] = useState<string[]>([]),
    [loadMore, setLoadMore] = useState(false),
    [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>(
      {},
    ),
    [newCommentId, setNewCommentId] = useState("");
  const commentsPane = useRef<HTMLDivElement>(null);
  function focusComment() {
    const input = document.getElementById("network-comment");
    if (input) {
      input.focus({ preventScroll: true });
      if (window.matchMedia("(max-width: 800px)").matches)
        input.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      document
        .querySelector(".nw-comment-gate")
        ?.scrollIntoView({ block: "nearest" });
    }
  }
  function startReply(comment: NetworkComment) {
    setReply(comment);
    focusComment();
  }
  useEffect(() => {
    if (!newCommentId) return;
    const element = document.getElementById(`network-comment-${newCommentId}`);
    const pane = commentsPane.current;
    if (element && pane) {
      pane.scrollTop +=
        element.getBoundingClientRect().bottom -
        pane.getBoundingClientRect().bottom +
        20;
    }
  }, [newCommentId]);
  useEffect(() => {
    const input = document.getElementById(
      "network-comment",
    ) as HTMLTextAreaElement | null;
    if (!input) return;
    input.style.height = "auto";
    const style = getComputedStyle(input);
    input.style.height = `${Math.min(parseFloat(style.maxHeight) || 116, Math.max(parseFloat(style.minHeight) || 44, input.scrollHeight))}px`;
  }, [body, resource.data?.post.id]);
  useEffect(() => {
    const key = `colabb-network-comment:${bootstrap.viewer.id}:${bootstrap.viewer.company?.id || "none"}:${id}`;
    try {
      setBody(sessionStorage.getItem(key) || "");
    } catch {}
  }, [id]);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        `colabb-network-comment:${bootstrap.viewer.id}:${bootstrap.viewer.company?.id || "none"}:${id}`,
        body,
      );
    } catch {}
  }, [body, id]);
  const attempt = useRef<{ body: string; id: string } | null>(null);
  function updateComment(updated: NetworkComment) {
    const previous = comments.data?.items.find((c) => c.id === updated.id);
    comments.setData((data) =>
      data
        ? {
            ...data,
            items: data.items.map((c) => (c.id === updated.id ? updated : c)),
          }
        : data,
    );
    if (previous && !previous.deleted_at && updated.deleted_at) {
      resource.setData((data) =>
        data
          ? {
              post: {
                ...data.post,
                comment_count: Math.max(0, data.post.comment_count - 1),
              },
            }
          : data,
      );
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        body: body.trim(),
        parent_id: reply?.parent_id || reply?.id,
        mention_user_ids: mentions,
        mention_company_ids: companyMentions,
      };
      const encoded = JSON.stringify(payload);
      if (attempt.current?.body !== encoded)
        attempt.current = { body: encoded, id: crypto.randomUUID() };
      const result = await networkPost<{ comment: NetworkComment }>(
        `/posts/${id}/comments`,
        { client_id: attempt.current.id, ...payload },
      );
      attempt.current = null;
      comments.setData((d) => ({
        items: [...(d?.items || []), result.comment],
        next_cursor: d?.next_cursor || null,
      }));
      if (result.comment.parent_id)
        setExpandedReplies((current) => ({
          ...current,
          [result.comment.parent_id!]: true,
        }));
      setNewCommentId(result.comment.id);
      setBody("");
      setReply(null);
      setMentions([]);
      setCompanyMentions([]);
      resource.setData((d) =>
        d
          ? { post: { ...d.post, comment_count: d.post.comment_count + 1 } }
          : d,
      );
    } catch (e) {
      setError(networkError(e));
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    if (!comments.data?.next_cursor) return;
    setLoadMore(true);
    try {
      const page = await networkApi<NetworkList<NetworkComment>>(
        `/posts/${id}/comments?limit=50&cursor=${encodeURIComponent(comments.data.next_cursor)}`,
      );
      comments.setData((d) => ({
        items: [...(d?.items || []), ...page.items],
        next_cursor: page.next_cursor,
      }));
    } catch (e) {
      setError(networkError(e));
    } finally {
      setLoadMore(false);
    }
  }
  const post = resource.data?.post,
    canWrite = !!post?.can_comment;
  const commentItems = comments.data?.items || [];
  return (
    <div
      className={`nw-task-page nw-discussion-page ${post?.community_id ? "nw-discussion-community" : "nw-discussion-company"}`}
    >
      <div className="nw-detail-backbar">
        <BackButton
          onClick={
            post?.community_id
              ? () => actions.onNavigate(`/communities/${post.community_id}`)
              : onBack
          }
        >
          Back to {post?.community_name || "Network"}
        </BackButton>
      </div>
      {resource.loading || resource.error ? (
        <NetworkState
          loading={resource.loading}
          error={resource.error}
          retry={resource.retry}
        />
      ) : (
        post && (
          <div className="nw-discussion-layout">
            <section
              className="nw-discussion-story nw-panel"
              tabIndex={0}
              aria-label="Selected post"
            >
              <NetworkPostCard
                post={post}
                detail
                actions={{ ...actions, onPost: focusComment }}
                onUpdated={(post) => resource.setData({ post })}
              />
              {post.author_id === bootstrap.viewer.id &&
                ["sourcing", "available"].includes(post.kind) && (
                  <div className="nw-source-cta">
                    {post.source_job_id ? (
                      <Link
                        className="nw-button"
                        to={`/jobs/${post.source_job_id}/edit`}
                      >
                        Continue job draft <ArrowRight size={16} />
                      </Link>
                    ) : (
                      <button
                        className="nw-button"
                        onClick={() =>
                          actions.onNavigate(`/posts/${post.id}/job-draft`)
                        }
                      >
                        Create a job from this post <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                )}
            </section>
            <section
              className="nw-panel nw-comments"
              aria-labelledby="network-comments-heading"
            >
              <header className="nw-comments-heading">
                <h2 id="network-comments-heading">
                  Comments <span>{post.comment_count}</span>
                </h2>
                <span className="nw-comment-order">Oldest first</span>
              </header>
              <div
                className="nw-comments-scroll"
                ref={commentsPane}
                tabIndex={0}
                role="region"
                aria-label="Comments"
              >
                {comments.loading || comments.error ? (
                  <NetworkState
                    loading={comments.loading}
                    error={comments.error}
                    retry={comments.retry}
                  />
                ) : (
                  <>
                    {!commentItems.length && (
                      <div className="nw-comments-empty">
                        <MessageCircle size={25} />
                        <strong>Start the conversation.</strong>
                        <p>
                          {canWrite
                            ? "Share a useful detail or ask a question."
                            : "There are no comments on this post yet."}
                        </p>
                      </div>
                    )}
                    {commentItems
                      .filter((comment) => !comment.parent_id)
                      .map((comment) => {
                        const children = commentItems.filter(
                          (child) => child.parent_id === comment.id,
                        );
                        const expanded = !!expandedReplies[comment.id];
                        return (
                          <div className="nw-comment-thread" key={comment.id}>
                            <CommentRow
                              comment={comment}
                              canReply={canWrite}
                              onReply={startReply}
                              onUpdated={updateComment}
                            />
                            {children.length > 0 && (
                              <>
                                <button
                                  className="nw-replies-toggle"
                                  aria-expanded={expanded}
                                  aria-controls={`network-replies-${comment.id}`}
                                  onClick={() =>
                                    setExpandedReplies((current) => ({
                                      ...current,
                                      [comment.id]: !expanded,
                                    }))
                                  }
                                >
                                  {expanded
                                    ? "Hide"
                                    : `View ${children.length}`}{" "}
                                  {children.length === 1 ? "reply" : "replies"}
                                </button>
                                <div
                                  className="nw-comment-child"
                                  id={`network-replies-${comment.id}`}
                                  hidden={!expanded}
                                >
                                  {expanded &&
                                    children.map((child) => (
                                      <CommentRow
                                        key={child.id}
                                        comment={child}
                                        canReply={canWrite}
                                        onReply={startReply}
                                        onUpdated={updateComment}
                                      />
                                    ))}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    {comments.data?.next_cursor && (
                      <button
                        className="nw-button nw-more-comments"
                        disabled={loadMore}
                        onClick={more}
                      >
                        {loadMore ? "Loading…" : "More comments"}
                      </button>
                    )}
                  </>
                )}
              </div>
              {canWrite ? (
                <form className="nw-comment-form" onSubmit={submit}>
                  {reply && (
                    <div className="nw-replying">
                      <CornerDownRight size={15} />
                      <span>
                        Replying to <strong>{reply.author.name}</strong>
                      </span>
                      <button
                        type="button"
                        aria-label="Cancel reply"
                        onClick={() => {
                          setReply(null);
                          focusComment();
                        }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                  <label htmlFor="network-comment">
                    {reply ? "Reply" : "Comment"} as {bootstrap.viewer.name}
                    {bootstrap.viewer.company?.name
                      ? ` · ${bootstrap.viewer.company.name}`
                      : ""}
                  </label>
                  <div className="nw-comment-entry">
                    <MentionInput
                      id="network-comment"
                      value={body}
                      onChange={setBody}
                      onMention={(id, kind) =>
                        kind === "user"
                          ? setMentions((current) => [
                              ...new Set([...current, id]),
                            ])
                          : setCompanyMentions((current) => [
                              ...new Set([...current, id]),
                            ])
                      }
                      communityId={post.community_id}
                      placeholder={
                        reply
                          ? `Reply to ${reply.author.name.split(" ")[0]}…`
                          : "Add a comment…"
                      }
                      rows={1}
                      maxLength={5000}
                    />
                    <button
                      className="nw-button nw-primary nw-comment-send"
                      aria-label={
                        busy
                          ? "Sending comment"
                          : reply
                            ? "Post reply"
                            : "Post comment"
                      }
                      disabled={busy || !body.trim()}
                    >
                      <ArrowUp size={19} />
                    </button>
                  </div>
                  {error && (
                    <p className="nw-error" role="alert">
                      {error}
                    </p>
                  )}
                </form>
              ) : (
                <div className="nw-comment-gate">
                  <LockKeyhole size={17} />
                  <p>
                    {!post.comments_open
                      ? "Comments are turned off for this post. You can still read the discussion."
                      : !bootstrap.viewer.email_verified
                        ? "Verify your email to join the conversation."
                        : post.community_id
                          ? "Join this community to take part in the discussion."
                          : "Join or create your company to take part."}
                  </p>
                  {post.community_id &&
                    post.comments_open &&
                    bootstrap.viewer.email_verified && (
                      <button
                        className="nw-text"
                        onClick={() =>
                          actions.onNavigate(
                            `/communities/${post.community_id}`,
                          )
                        }
                      >
                        Open community <ArrowRight size={15} />
                      </button>
                    )}
                  {error && (
                    <p className="nw-error" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>
        )
      )}
    </div>
  );
}

function CommentRow({
  comment,
  onReply,
  onUpdated,
  canReply,
}: {
  comment: NetworkComment;
  onReply: (c: NetworkComment) => void;
  onUpdated: (c: NetworkComment) => void;
  canReply: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [deleting, setDeleting] = useState(false),
    [body, setBody] = useState(comment.body),
    [mentions, setMentions] = useState({
      users:
        comment.mentions?.filter((m) => m.kind === "user").map((m) => m.id) ||
        [],
      companies:
        comment.mentions
          ?.filter((m) => m.kind === "company")
          .map((m) => m.id) || [],
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await networkPatch<{ comment: NetworkComment }>(
        `/comments/${comment.id}`,
        {
          version: comment.version,
          body: body.trim(),
          mention_user_ids: mentions.users,
          mention_company_ids: mentions.companies,
        },
      );
      onUpdated(r.comment);
      setEditing(false);
    } catch (e) {
      setError(networkError(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await networkDelete(`/comments/${comment.id}`, {
        version: comment.version,
      });
      onUpdated({
        ...comment,
        body: "",
        deleted_at: new Date().toISOString(),
        can_edit: false,
      });
      setDeleting(false);
    } catch (e) {
      setError(networkError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="nw-comment" id={`network-comment-${comment.id}`}>
      <span className="nw-comment-avatar" aria-hidden="true">
        {comment.author.name
          .trim()
          .split(/\s+/)
          .map((part) => part[0])
          .filter(Boolean)
          .slice(0, 2)
          .join("")
          .toUpperCase()}
      </span>
      <div className="nw-comment-main">
        <div className="nw-comment-by">
          <strong>{comment.author.name}</strong>
        </div>
        {comment.company && (
          <small className="nw-muted">{comment.company.name}</small>
        )}
        {editing ? (
          <form onSubmit={save}>
            <label className="nw-sr" htmlFor={`edit-${comment.id}`}>
              Edit comment
            </label>
            <MentionInput
              id={`edit-${comment.id}`}
              value={body}
              onChange={setBody}
              rows={3}
              maxLength={5000}
              onMention={(id, kind) =>
                setMentions((v) => ({
                  ...v,
                  [kind === "user" ? "users" : "companies"]: [
                    ...new Set([
                      ...(kind === "user" ? v.users : v.companies),
                      id,
                    ]),
                  ],
                }))
              }
            />
            <div className="nw-actions">
              <button
                className="nw-button nw-primary"
                disabled={busy || !body.trim()}
              >
                Save changes
              </button>
              <button
                type="button"
                className="nw-button"
                onClick={() => {
                  setEditing(false);
                  setBody(comment.body);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <p className={comment.deleted_at ? "nw-muted" : ""}>
            {comment.deleted_at ? (
              "This comment was deleted."
            ) : (
              <MentionText text={comment.body} mentions={comment.mentions} />
            )}
          </p>
        )}
        {!comment.deleted_at && !editing && (
          <div className="nw-comment-actions">
            <time dateTime={comment.created_at}>
              {networkTime(comment.created_at)}
              {comment.updated_at && comment.updated_at !== comment.created_at
                ? " · Edited"
                : ""}
            </time>
            {canReply && (
              <button onClick={() => onReply(comment)}>Reply</button>
            )}
            {comment.can_edit && (
              <>
                <button onClick={() => setEditing(true)}>Edit</button>
                <button onClick={() => setDeleting(true)}>Delete</button>
              </>
            )}
          </div>
        )}
        {deleting && (
          <div className="nw-inline-confirm">
            <p>Delete your comment? Replies will remain.</p>
            <div className="nw-actions">
              <button className="nw-button" disabled={busy} onClick={remove}>
                Delete comment
              </button>
              <button
                className="nw-button nw-quiet"
                onClick={() => setDeleting(false)}
              >
                Keep comment
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="nw-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
