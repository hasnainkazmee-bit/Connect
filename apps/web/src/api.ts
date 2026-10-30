export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(
    abort,
    options.body instanceof FormData ? 120000 : 30000,
  );
  try {
    const response = await fetch("/api" + path, {
      credentials: "same-origin",
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    });
    if (
      response.status === 401 &&
      ![
        "/session",
        "/auth/login",
        "/auth/register",
        "/auth/logout",
        "/auth/password/request",
        "/auth/password/reset",
      ].includes(path.split("?")[0])
    ) {
      window.dispatchEvent(new Event("connect:session-expired"));
    }
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        data?.error ||
          "Connect couldn’t complete that request. Please try again.",
      );
    if (data === null)
      throw new Error(
        "Connect returned an unexpected response. Please try again.",
      );
    return data;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted)
      throw new Error("This is taking longer than expected. Please try again.");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
export const post = <T = any>(path: string, data: any = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data) });
