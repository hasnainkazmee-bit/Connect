import { api } from "../api";
export const networkApi = <T = any>(path: string, options: RequestInit = {}) =>
  api<T>(`/network-v2${path}`, options);
export const networkPost = <T = any>(path: string, data: unknown = {}) =>
  networkApi<T>(path, { method: "POST", body: JSON.stringify(data) });
export const networkPatch = <T = any>(path: string, data: unknown = {}) =>
  networkApi<T>(path, { method: "PATCH", body: JSON.stringify(data) });
export const networkDelete = <T = any>(path: string, data?: unknown) =>
  networkApi<T>(path, {
    method: "DELETE",
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
export const networkError = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
export const networkDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
};
export const networkTime = (value?: string | null) => {
  if (!value) return "";
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return networkDate(value);
};
export const networkFileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// A missing draft is a new composer route; all other failures retain the editor.
export async function networkReadDraft(
  id: string,
  signal?: AbortSignal,
): Promise<
  | (import("./types").NetworkDraft & {
      files: import("./types").NetworkAttachment[];
    })
  | null
> {
  const controller = new AbortController(),
    abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(abort, 30000);
  try {
    const response = await fetch(
      `/api/network-v2/drafts/${encodeURIComponent(id)}`,
      { credentials: "same-origin", signal: controller.signal },
    );
    if (response.status === 404) return null;
    if (response.status === 401)
      window.dispatchEvent(new Event("connect:session-expired"));
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || "Your draft could not be loaded. Please try again.",
      );
    return data.draft;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
