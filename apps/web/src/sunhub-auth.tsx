import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api } from "./api";
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

export function SunhubAuthLink({
  intent,
  accountType = "company",
  returnTo,
  disabled = false,
  subtle = false,
}: {
  intent: "login" | "signup" | "link";
  accountType?: "company" | "individual";
  returnTo?: string;
  disabled?: boolean;
  subtle?: boolean;
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
        if (disabled) event.preventDefault();
      }}
    >
      {!subtle && (
        <img src="/assets/sunhub-symbol.png" alt="" width="24" height="24" />
      )}
      <span>{label}</span>
      {!subtle && <ArrowUpRight size={18} aria-hidden="true" />}
    </a>
  );
}
