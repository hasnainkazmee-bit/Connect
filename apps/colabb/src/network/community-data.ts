import { useEffect, useState } from "react";
import { networkApi } from "./client";
import { useApp } from "../context";

export type CommunityCompany = {
  id: string;
  name: string;
  slug?: string;
  logo_url?: string;
  tagline?: string;
  location?: string;
};
export type CommunityField = {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  required: boolean;
  placeholder?: string;
  unit?: string;
  min?: number;
  step?: number;
  options?: string[];
};
export type CommunityTopic = {
  id: string;
  label: string;
  version?: number;
  fields: CommunityField[];
};
export type CommunityPostType = {
  id: string;
  label: string;
  kind: "post" | "question" | "sourcing" | "available";
  version?: number;
};
export type CommunityRule = { title: string; body: string };
export type Community = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  join_policy: "open" | "approval";
  rules: CommunityRule[];
  topics: CommunityTopic[];
  post_types: CommunityPostType[];
  require_topic: boolean;
  archived_at?: string | null;
  cover_url?: string;
  company: CommunityCompany;
  membership: null | {
    role: "admin" | "moderator" | "member";
    status: "joined" | "pending" | "removed";
  };
  pinned_posts?: { id: string; title: string; body: string; kind: string }[];
  member_count: number;
  can_manage: boolean;
  can_moderate: boolean;
  can_post: boolean;
  can_read: boolean;
  version: number;
};
export type CommunityMember = {
  user_id: string;
  name: string;
  email?: string;
  company_name?: string;
  role: "admin" | "moderator" | "member";
  status: string;
  created_at: string;
};
export type CommunityInvitation = {
  id: string;
  email?: string;
  role: "admin" | "moderator" | "member";
  status: string;
  expires_at: string;
  created_at: string;
};
export type CommunityReport = {
  id: string;
  post_id: string;
  post_title: string;
  reason: string;
  details: string;
  reporter_name: string;
  status: string;
  resolution_reason?: string;
  created_at: string;
  resolved_at?: string;
};
export type CommunityPost = {
  id: string;
  title: string;
  body: string;
  kind: string;
  post_type_id?: string;
  post_type_label?: string;
  post_type_version?: number;
  topic_id?: string;
  topic_label?: string;
  created_at: string;
  updated_at?: string;
  company: CommunityCompany;
  author: { id: string; name: string };
  comment_count: number;
  reaction_count: number;
  answers?: {
    field_id: string;
    label: string;
    type: string;
    unit?: string;
    value: unknown;
  }[];
  files: {
    id: string;
    name: string;
    mime_type: string;
    size_bytes: number;
    url: string;
  }[];
  sourcing_status?: string;
};
export type CommunityList<T> = { items: T[]; next_cursor?: string | null };
export const communityError = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
export const communityDate = (date?: string | null) => {
  if (!date) return "";
  const d = new Date(date);
  return Number.isNaN(d.valueOf())
    ? ""
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d);
};
export const communityTime = (date: string) => {
  const ms = Date.now() - new Date(date).getTime();
  if (!Number.isFinite(ms) || ms < 0) return communityDate(date);
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24
    ? `${hours} ${hours === 1 ? "hour" : "hours"} ago`
    : communityDate(date);
};
const communityRequests = new Map<string, Promise<{ community: Community }>>();
export function useCommunity(id: string | undefined, revision: number) {
  const { session } = useApp();
  const identityKey = `${session.user?.id || "anonymous"}:${session.activeCompanyId || "none"}`;
  const [community, setCommunity] = useState<Community | null>(null);
  const [loadedFor, setLoadedFor] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!id);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (!id) {
      setCommunity(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    if (loadedFor !== `${identityKey}:${id}`) setCommunity(null);
    const key = `${identityKey}:${id}:${revision}:${attempt}`;
    let request = communityRequests.get(key);
    if (!request) {
      request = networkApi<{ community: Community }>(
        `/communities/${encodeURIComponent(id)}`,
      );
      communityRequests.set(key, request);
    }
    request
      .then((data) => {
        if (active) {
          setCommunity(data.community);
          setLoadedFor(`${identityKey}:${id}`);
        }
      })
      .catch((e) => {
        communityRequests.delete(key);
        if (active) setError(communityError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
        setTimeout(() => communityRequests.delete(key), 1000);
      });
    return () => {
      active = false;
    };
  }, [identityKey, id, revision, attempt]);
  return {
    community: loadedFor === `${identityKey}:${id}` ? community : null,
    loading,
    error,
    retry: () => setAttempt((x) => x + 1),
  };
}
export function communityRoute(path: string) {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  return {
    area: parts[0] || "communities",
    id:
      parts[0] === "communities" && parts[1] && parts[1] !== "new"
        ? parts[1]
        : undefined,
    task: parts[1] === "new" ? "new" : parts[2] === "manage" ? "manage" : "",
    tab: parts[3] || "settings",
    token: parts[0] === "invitations" ? parts[1] : undefined,
  };
}
