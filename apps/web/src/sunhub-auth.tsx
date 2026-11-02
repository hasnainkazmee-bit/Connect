import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { api } from "./api";
import type { Session } from "./types";
import "./sunhub-auth.css";

export function useSunhubAuth() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<{ enabled: boolean }>("/auth/sunhub/config", {
      signal: controller.signal,
    })
      .then((config) => {
        if (!controller.signal.aborted) setEnabled(config.enabled === true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return enabled;
}

export function sunhubAuthError(code: string) {
  const messages: Record<string, string> = {
    unavailable:
      "Sunhub sign-in is temporarily unavailable. Try again or use your Connect email and password.",
    cancelled:
      "Sunhub sign-in was canceled. You can try again whenever you’re ready.",
    expired: "Your Sunhub sign-in request expired. Please try again.",
    failed: "We couldn’t complete Sunhub sign-in. Please try again.",
    account_conflict:
      "This email already has a Connect account. Sign in with your Connect password, then link Sunhub in Account settings.",
    email_unverified: "Verify your email with Sunhub, then try again.",
  };
  return Object.hasOwn(messages, code) ? messages[code] : messages.failed;
}

// Keep invitation, claim, and filtered-directory URLs, never an external redirect.
export function sunhubReturnTo(
  value = window.location.pathname +
    window.location.search +
    window.location.hash,
) {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return "/";
  const url = new URL(value, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    url.pathname.startsWith("//") ||
    /^\/api(?:\/|$)/.test(url.pathname)
  )
    return "/";
  url.searchParams.delete("sso_error");
  url.searchParams.delete("sunhub_linked");
  return url.pathname + url.search + url.hash;
}

type SunhubIntent = "login" | "signup" | "link";
type PopupAttempt = {
  window: Window | null;
  controller: AbortController;
  settling: boolean;
  dispose: () => void;
};

/** A form shares one attempt across sign-in and signup; identity stays in cookies. */
export function useSunhubPopup({
  onSuccess,
  expectedUserId,
}: {
  onSuccess: (session: Session) => void;
  expectedUserId?: string;
}) {
  const active = useRef<PopupAttempt | null>(null);
  const callbacks = useRef({ onSuccess, expectedUserId });
  callbacks.current = { onSuccess, expectedUserId };
  const [phase, setPhase] = useState<"idle" | "waiting" | "finishing">("idle");
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      active.current?.dispose();
      active.current = null;
    },
    [],
  );

  const start = (
    intent: SunhubIntent,
    accountType: "company" | "individual",
    returnTo: string,
  ) => {
    if (active.current) {
      active.current.window?.focus();
      return;
    }
    const popupId = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const query = new URLSearchParams({
      intent,
      accountType,
      returnTo: sunhubReturnTo(returnTo),
      display: "popup",
      popup_id: popupId,
    });
    const origin = window.location.origin;
    const linkingUserId = callbacks.current.expectedUserId;
    const attempt: PopupAttempt = {
      window: null,
      controller: new AbortController(),
      settling: false,
      dispose: () => {},
    };
    let channel: BroadcastChannel | undefined;
    let poll: number | undefined, closedTimer: number | undefined;
    let expiry: number | undefined;
    const closeWindow = () => {
      try {
        attempt.window?.close();
      } catch {}
    };
    const stopListening = (closeChannel = true) => {
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
      clearTimeout(closedTimer);
      clearTimeout(expiry);
      if (closeChannel) channel?.close();
    };
    attempt.dispose = () => {
      stopListening();
      attempt.controller.abort();
      closeWindow();
    };
    const finish = (message = "") => {
      if (active.current !== attempt) return;
      active.current = null;
      attempt.dispose();
      setPhase("idle");
      setError(message);
    };
    const handoff = (
      status: "success" | "error",
      message = "",
      session?: Session,
    ) => {
      if (active.current !== attempt) return;
      // Successful authentication can unmount this form. The callback owns its
      // final transition; unmount cleanup must not close that window early.
      active.current = null;
      stopListening(false);
      attempt.controller.abort();
      setPhase("idle");
      setError(message);
      try {
        if (session) callbacks.current.onSuccess(session);
      } catch {
        status = "error";
        setError(sunhubAuthError("failed"));
      }
      // Give React a turn to commit the destination before acknowledging it.
      // Unlike requestAnimationFrame, this also runs in an unfocused opener.
      window.setTimeout(() => {
        const ready = { type: "connect:sunhub:ready", popupId, status };
        try {
          attempt.window?.postMessage(ready, origin);
        } catch {}
        try {
          channel?.postMessage(ready);
        } catch {}
        channel?.close();
      }, 80);
    };
    const receive = async (value: unknown) => {
      if (active.current !== attempt || attempt.settling) return;
      if (!value || typeof value !== "object") return;
      const data = value as Record<string, unknown>;
      if (
        data.type !== "connect:sunhub:complete" ||
        data.popupId !== popupId ||
        !["success", "error"].includes(data.status as string)
      )
        return;
      attempt.settling = true;
      stopListening(false);
      if (data.status === "error") {
        handoff(
          "error",
          sunhubAuthError(
            typeof data.error === "string" ? data.error : "failed",
          ),
        );
        return;
      }
      setPhase("finishing");
      try {
        const session = await api<Session>("/session", {
          signal: attempt.controller.signal,
        });
        if (active.current !== attempt) return;
        if (!session.user)
          throw new Error(
            "Connect couldn’t restore your sign-in. Please try again.",
          );
        if (
          intent === "link" &&
          (session.user.id !== linkingUserId ||
            callbacks.current.expectedUserId !== linkingUserId ||
            !session.user.sunhubLinked)
        )
          throw new Error(
            "Your Connect account changed. Please try linking Sunhub again.",
          );
        handoff("success", "", session);
      } catch (cause) {
        if (active.current === attempt)
          handoff(
            "error",
            (cause as Error).message || sunhubAuthError("failed"),
          );
      }
    };
    function onMessage(event: MessageEvent) {
      if (event.origin === origin && event.source === attempt.window)
        void receive(event.data);
    }
    active.current = attempt;
    setError("");
    setPhase("waiting");
    window.addEventListener("message", onMessage);
    try {
      channel = new BroadcastChannel("connect-sunhub-" + popupId);
      channel.onmessage = (event) => {
        if (event.origin === origin) void receive(event.data);
      };
    } catch {
      // postMessage remains available in browsers without BroadcastChannel.
    }
    // These existing Screen properties need no Window Management permission.
    const display = window.screen as Screen & {
      availLeft?: number;
      availTop?: number;
    };
    const availableWidth = display.availWidth || display.width || 500;
    const availableHeight = display.availHeight || display.height || 680;
    const width = Math.min(500, availableWidth);
    const height = Math.min(680, availableHeight);
    const screenLeft = Number.isFinite(display.availLeft)
      ? display.availLeft!
      : 0;
    const screenTop = Number.isFinite(display.availTop) ? display.availTop! : 0;
    // Negative origins belong to monitors left of or above the primary display.
    const left = Math.round(screenLeft + (availableWidth - width) / 2);
    const top = Math.round(screenTop + (availableHeight - height) / 2);
    try {
      // Stay in this trusted click: awaiting a request first would block the popup.
      attempt.window = window.open(
        "/api/auth/sunhub/start?" + query,
        "connect-sunhub-" + popupId,
        `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
      );
    } catch {}
    if (!attempt.window) {
      finish("Allow pop-ups for Connect, then try Sunhub sign-in again.");
      return;
    }
    poll = window.setInterval(() => {
      if (attempt.window?.closed && !closedTimer) {
        // Completion and window.close can arrive in either order.
        closedTimer = window.setTimeout(() => {
          if (!attempt.settling) finish(sunhubAuthError("cancelled"));
        }, 750);
      }
    }, 400);
    expiry = window.setTimeout(
      () => finish(sunhubAuthError("expired")),
      15 * 60 * 1000,
    );
    attempt.window.focus();
  };
  return {
    pending: phase !== "idle",
    phase,
    error,
    start,
    focus: () => active.current?.window?.focus(),
    cancel: () => {
      active.current?.dispose();
      active.current = null;
      setPhase("idle");
      setError(sunhubAuthError("cancelled"));
    },
  };
}

type SunhubPopup = ReturnType<typeof useSunhubPopup>;

export function SunhubPopupStatus({ popup }: { popup: SunhubPopup }) {
  if (!popup.pending && !popup.error) return null;
  return (
    <div className="sunhub-popup-state">
      {popup.error && (
        <p className="sunhub-popup-error" role="alert">
          {popup.error}
        </p>
      )}
      {popup.pending && (
        <>
          <p role="status">
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
            {popup.phase === "finishing"
              ? "Finishing your sign-in…"
              : "Continue in the Sunhub window."}
          </p>
          <div>
            {popup.phase === "waiting" && (
              <button type="button" onClick={popup.focus}>
                Show window
              </button>
            )}
            <button type="button" onClick={popup.cancel}>
              Cancel Sunhub sign-in
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function SunhubAuthLink({
  intent,
  accountType = "company",
  returnTo,
  disabled = false,
  subtle = false,
  popup,
}: {
  intent: SunhubIntent;
  accountType?: "company" | "individual";
  returnTo?: string;
  disabled?: boolean;
  subtle?: boolean;
  popup: SunhubPopup;
}) {
  const query = new URLSearchParams({
    intent,
    accountType,
    returnTo: sunhubReturnTo(returnTo),
  });
  const label =
    intent === "login"
      ? "Sign in with Sunhub"
      : intent === "signup"
        ? "Create a Sunhub account"
        : "Link Sunhub account";
  return (
    <a
      className={subtle ? "sunhub-auth-secondary" : "sunhub-auth-action"}
      href={"/api/auth/sunhub/start?" + query}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={(event) => {
        event.preventDefault();
        if (!disabled)
          popup.start(intent, accountType, sunhubReturnTo(returnTo));
      }}
      title="Opens a Sunhub sign-in window"
    >
      {!subtle && (
        <img src="/assets/sunhub-symbol.png" alt="" width="24" height="24" />
      )}
      <span>{label}</span>
      {!subtle && <ArrowUpRight size={18} aria-hidden="true" />}
    </a>
  );
}
