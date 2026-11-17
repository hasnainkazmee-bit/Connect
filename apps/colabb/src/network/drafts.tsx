import { useState } from "react";
import { ArrowRight, FileText, Image, Trash2, LockKeyhole } from "lucide-react";
import { NetworkState, useNetworkResource } from "./common";
import { networkApi, networkDelete, networkError, networkTime } from "./client";
import type { NetworkBootstrap, NetworkDraft, NetworkList } from "./types";
export function NetworkDrafts({
  bootstrap,
  onNavigate,
  onRefresh,
  revision,
}: {
  bootstrap: NetworkBootstrap;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  revision: number;
}) {
  const r = useNetworkResource<NetworkList<NetworkDraft>>("/drafts", revision),
    [remove, setRemove] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [more, setMore] = useState(false);
  async function loadMore() {
    if (!r.data?.next_cursor) return;
    setMore(true);
    setError("");
    try {
      const page = await networkApi<NetworkList<NetworkDraft>>(
        `/drafts?cursor=${encodeURIComponent(r.data.next_cursor)}`,
      );
      r.setData((d) =>
        d
          ? {
              items: [
                ...d.items,
                ...page.items.filter(
                  (item) =>
                    !d.items.some((existing) => existing.id === item.id),
                ),
              ],
              next_cursor: page.next_cursor,
            }
          : page,
      );
    } catch (e) {
      setError(networkError(e));
    } finally {
      setMore(false);
    }
  }
  async function discard(draft: NetworkDraft) {
    setBusy(true);
    setError("");
    try {
      await networkDelete(`/drafts/${draft.id}`, { version: draft.version });
      r.setData((d) =>
        d ? { ...d, items: d.items.filter((x) => x.id !== draft.id) } : d,
      );
      setRemove("");
      onRefresh();
    } catch (e) {
      setError(networkError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="nw-drafts">
      <div className="nw-section-heading">
        <h1>Your drafts</h1>
        <p>Pick up where you left off. Nothing here has been published.</p>
      </div>
      {r.loading || r.error ? (
        <NetworkState loading={r.loading} error={r.error} retry={r.retry} />
      ) : !r.data?.items.length ? (
        <NetworkState title="A place for work in progress">
          <p>
            Start a company post or community discussion. Your writing and
            uploaded files will be saved here.
          </p>
          <button className="nw-button" onClick={() => onNavigate("/compose")}>
            Start a post
            <ArrowRight size={16} />
          </button>
        </NetworkState>
      ) : (
        r.data.items.map((d) => (
          <article className="nw-panel nw-draft" key={d.id}>
            <div className="nw-draft-meta">
              <FileText size={17} />
              <span>
                {d.community_id
                  ? bootstrap.communities.find((c) => c.id === d.community_id)
                      ?.name || "Community discussion"
                  : bootstrap.viewer.company?.name || "Company post"}
              </span>
              <time>{networkTime(d.updated_at)}</time>
            </div>
            <h2>{d.body.title || "Company post"}</h2>
            <p>
              {d.body.body || "Photos and documents ready to add to your post."}
            </p>
            <small>
              {d.body.file_ids?.length || 0} attachments
              {d.body.answers?.length
                ? ` · ${d.body.answers.length} details`
                : ""}
            </small>
            {!d.can_publish && (
              <p className="nw-inline-notice">
                <LockKeyhole size={15} />
                Your draft is safe. Access to its destination is required before
                publishing.
              </p>
            )}
            {remove === d.id ? (
              <div className="nw-inline-confirm">
                <p>Discard this draft? This cannot be undone.</p>
                <div className="nw-actions">
                  <button
                    className="nw-button"
                    disabled={busy}
                    onClick={() => discard(d)}
                  >
                    Discard draft
                  </button>
                  <button
                    className="nw-button nw-quiet"
                    onClick={() => setRemove("")}
                  >
                    Keep draft
                  </button>
                </div>
              </div>
            ) : (
              <div className="nw-actions">
                <button
                  className="nw-button"
                  onClick={() => onNavigate(`/compose/${d.id}`)}
                >
                  Resume
                  <ArrowRight size={16} />
                </button>
                <button
                  className="nw-button nw-quiet"
                  onClick={() => setRemove(d.id)}
                >
                  <Trash2 size={15} />
                  Discard
                </button>
              </div>
            )}
          </article>
        ))
      )}
      {r.data?.next_cursor && (
        <div className="nw-load-more">
          <button
            type="button"
            className="nw-button"
            disabled={more}
            onClick={loadMore}
          >
            {more ? "Loading…" : "More drafts"}
          </button>
        </div>
      )}
      {error && (
        <p className="nw-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
