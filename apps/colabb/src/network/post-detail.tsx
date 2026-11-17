import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CornerDownRight,
  Send,
  Pencil,
  Trash2,
  LockKeyhole,
} from "lucide-react";
import { useApp } from "../context";
import {
  BackButton,
  CompanyLogo,
  NetworkState,
  companyPath,
  useNetworkResource,
} from "./common";
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
    [loadMore, setLoadMore] = useState(false);
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
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
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
  return (
    <div className="nw-task-page nw-discussion-page">
      <BackButton onClick={onBack}>Back to Network</BackButton>
      {resource.loading || resource.error ? (
        <NetworkState
          loading={resource.loading}
          error={resource.error}
          retry={resource.retry}
        />
      ) : (
        post && (
          <div className="nw-discussion-layout">
            <div>
              <NetworkPostCard
                post={post}
                detail
                actions={actions}
                onUpdated={(post) => resource.setData({ post })}
              />
              <section className="nw-panel nw-comments" aria-label="Comments">
                <header>
                  <h2>
                    Comments <span>{post.comment_count}</span>
                  </h2>
                </header>
                {comments.loading || comments.error ? (
                  <NetworkState
                    loading={comments.loading}
                    error={comments.error}
                    retry={comments.retry}
                  />
                ) : (
                  <>
                    {!comments.data?.items.length && (
                      <p className="nw-muted">
                        No comments yet. Start the conversation.
                      </p>
                    )}
                    {comments.data?.items
                      .filter((c) => !c.parent_id)
                      .map((comment) => (
                        <div key={comment.id}>
                          <CommentRow
                            comment={comment}
                            canReply={canWrite}
                            onReply={setReply}
                            onUpdated={(updated) =>
                              comments.setData((d) =>
                                d
                                  ? {
                                      ...d,
                                      items: d.items.map((c) =>
                                        c.id === updated.id ? updated : c,
                                      ),
                                    }
                                  : d,
                              )
                            }
                          />
                          {comments.data?.items
                            .filter((c) => c.parent_id === comment.id)
                            .map((child) => (
                              <div className="nw-comment-child" key={child.id}>
                                <CommentRow
                                  comment={child}
                                  canReply={canWrite}
                                  onReply={() => setReply(comment)}
                                  onUpdated={(updated) =>
                                    comments.setData((d) =>
                                      d
                                        ? {
                                            ...d,
                                            items: d.items.map((c) =>
                                              c.id === updated.id ? updated : c,
                                            ),
                                          }
                                        : d,
                                    )
                                  }
                                />
                              </div>
                            ))}
                        </div>
                      ))}
                    {comments.data?.next_cursor && (
                      <button
                        className="nw-button"
                        disabled={loadMore}
                        onClick={more}
                      >
                        {loadMore ? "Loading…" : "More comments"}
                      </button>
                    )}
                  </>
                )}
                {canWrite ? (
                  <form className="nw-comment-form" onSubmit={submit}>
                    {reply && (
                      <div className="nw-replying">
                        <CornerDownRight size={15} />
                        Replying to {reply.author.name}
                        <button type="button" onClick={() => setReply(null)}>
                          Cancel
                        </button>
                      </div>
                    )}
                    <label htmlFor="network-comment">
                      {reply ? "Your reply" : "Add a comment"}
                    </label>
                    <MentionInput
                      id="network-comment"
                      value={body}
                      onChange={setBody}
                      onMention={(id, kind) =>
                        kind === "user"
                          ? setMentions((p) => [...new Set([...p, id])])
                          : setCompanyMentions((p) => [...new Set([...p, id])])
                      }
                      communityId={post.community_id}
                      placeholder="Add to the conversation… Use @ to mention someone."
                      rows={3}
                    />
                    <div className="nw-comment-submit">
                      <span>
                        As {bootstrap.viewer.name} ·{" "}
                        {bootstrap.viewer.company?.name}
                      </span>
                      <button
                        className="nw-button nw-primary"
                        disabled={busy || !body.trim()}
                      >
                        <Send size={16} />
                        {busy ? "Sending…" : "Send"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="nw-inline-notice">
                    <LockKeyhole size={17} />
                    {!post.comments_open
                      ? "Comments are turned off for this post."
                      : !bootstrap.viewer.email_verified
                        ? "Verify your email to join the conversation."
                        : post.community_id
                          ? "Join this community to take part in the discussion."
                          : "Join or create your company to take part."}
                  </div>
                )}
                {error && (
                  <p className="nw-error" role="alert">
                    {error}
                  </p>
                )}
              </section>
            </div>
            <aside className="nw-discussion-aside nw-panel">
              <h2>
                {post.community_id ? "In this community" : "About this company"}
              </h2>
              <CompanyLogo company={post.company} size={52} />
              <h3>{post.company.name}</h3>
              <p>{post.company.tagline || post.company.location}</p>
              <Link className="nw-text" to={companyPath(post.company)}>
                View company profile
                <ArrowRight size={16} />
              </Link>
              {post.community_id && (
                <button
                  className="nw-button"
                  onClick={() =>
                    actions.onNavigate(`/communities/${post.community_id}`)
                  }
                >
                  Open {post.community_name}
                </button>
              )}
              {post.author_id === bootstrap.viewer.id &&
                ["sourcing", "available"].includes(post.kind) && (
                  <div className="nw-source-cta">
                    <h3>Ready to turn this into a job?</h3>
                    <p>
                      Review the details and choose which files to bring into a
                      job draft.
                    </p>
                    {post.source_job_id ? (
                      <Link
                        className="nw-button"
                        to={`/jobs/${post.source_job_id}/edit`}
                      >
                        Continue job draft
                        <ArrowRight size={16} />
                      </Link>
                    ) : (
                      <button
                        className="nw-button"
                        onClick={() =>
                          actions.onNavigate(`/posts/${post.id}/job-draft`)
                        }
                      >
                        Create a job draft
                        <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                )}
            </aside>
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
    <article className="nw-comment">
      <CompanyLogo company={comment.company} size={34} />
      <div className="nw-comment-main">
        <div className="nw-comment-by">
          <strong>{comment.author.name}</strong>
          <time dateTime={comment.created_at}>
            {networkTime(comment.created_at)}
          </time>
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
            {canReply && (
              <button onClick={() => onReply(comment)}>Reply</button>
            )}
            {comment.can_edit && (
              <>
                <button onClick={() => setEditing(true)}>
                  <Pencil size={12} />
                  Edit
                </button>
                <button onClick={() => setDeleting(true)}>
                  <Trash2 size={12} />
                  Delete
                </button>
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
