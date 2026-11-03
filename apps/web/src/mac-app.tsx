import { useEffect, useRef, useState, type ReactNode } from "react";
import { installMacNativeSelects } from "./mac-native-select";

const routes = new Set([
  "/",
  "/directory",
  "/network",
  "/network/connections",
  "/messages",
]);
export type DesktopCommand =
  | { type: "navigate"; path: string }
  | { type: "compose" | "account" | "notifications" | "profile" };
export type DesktopState = {
  ready: boolean;
  path: string;
  signedIn: boolean;
  accountType: string;
  userName: string;
  companyName: string;
  canPublish: boolean;
  unreadCount: number;
};
type DesktopWindow = Window & {
  chrome?: { webview?: { postMessage?: (value: unknown) => void } };
  webkit?: {
    messageHandlers?: {
      connectMac?: { postMessage?: (value: unknown) => void };
    };
  };
};

export function isMacApp() {
  return (
    window.opener == null &&
    navigator.userAgent.includes("ConnectMac/") &&
    typeof (window as DesktopWindow).webkit?.messageHandlers?.connectMac
      ?.postMessage === "function"
  );
}

export function isWindowsApp() {
  return (
    window.opener == null &&
    navigator.userAgent.includes("ConnectWindows/") &&
    typeof (window as DesktopWindow).chrome?.webview?.postMessage === "function"
  );
}

export type DesktopHost = "mac" | "windows";
export const desktopCommandEvent = (host: DesktopHost) =>
  `connect:${host}-command`;

// This adapter exposes navigation/UI intents only. The existing React handlers
// remain responsible for authentication, authorization, and every API mutation.
export function useDesktopApp(
  state: DesktopState,
  onCommand: (command: DesktopCommand) => void,
) {
  const [host] = useState<DesktopHost | null>(() =>
    isMacApp() ? "mac" : isWindowsApp() ? "windows" : null,
  );
  const current = useRef({ state, onCommand });
  current.current = { state, onCommand };
  const lastState = useRef("");
  const queuedCommand = useRef<DesktopCommand | null>(null);
  const sendState = () => {
    if (!host) return;
    const value = current.current.state;
    try {
      const payload = {
        type: "state",
        ready: value.ready,
        path: value.path,
        signedIn: value.signedIn,
        accountType: value.accountType,
        userName: value.userName,
        companyName: value.companyName,
        canPublish: value.canPublish,
        unreadCount: value.unreadCount,
      };
      if (host === "mac")
        (window as DesktopWindow).webkit!.messageHandlers!.connectMac!
          .postMessage!(payload);
      else (window as DesktopWindow).chrome!.webview!.postMessage!(payload);
    } catch {
      /* Losing native chrome must never interrupt the web workspace. */
    }
  };
  useEffect(() => {
    if (!host) return;
    document.documentElement.classList.add(
      "connect-desktop",
      `connect-${host}`,
    );
    const removeNativeSelects =
      host === "mac" ? installMacNativeSelects() : () => {};
    const commandEvent = desktopCommandEvent(host);
    const deliver = (command: DesktopCommand) => {
      if (current.current.state.ready) current.current.onCommand(command);
      else queuedCommand.current = command;
    };
    const receive = (event: Event) => {
      const command: unknown = (event as CustomEvent).detail;
      if (
        !command ||
        typeof command !== "object" ||
        !("type" in command) ||
        typeof command.type !== "string"
      )
        return;
      if (command.type === "state") {
        sendState();
        return;
      }
      if (command.type === "navigate") {
        if (
          !("path" in command) ||
          typeof command.path !== "string" ||
          !routes.has(command.path)
        )
          return;
        deliver({ type: "navigate", path: command.path });
      } else if (
        ["compose", "account", "notifications", "profile"].includes(
          String(command.type),
        )
      ) {
        deliver({ type: command.type } as DesktopCommand);
      }
      // A dirty/saving modal can keep the route unchanged. Acknowledge that too.
      queueMicrotask(sendState);
    };
    window.addEventListener(commandEvent, receive);
    return () => {
      queuedCommand.current = null;
      removeNativeSelects();
      window.removeEventListener(commandEvent, receive);
      document.documentElement.classList.remove(
        "connect-desktop",
        `connect-${host}`,
      );
    };
  }, [host]);
  useEffect(() => {
    if (host && state.ready && queuedCommand.current) {
      const command = queuedCommand.current;
      queuedCommand.current = null;
      current.current.onCommand(command);
    }
  }, [host, state.ready]);
  useEffect(() => {
    const serialized = JSON.stringify(state);
    if (serialized !== lastState.current) {
      lastState.current = serialized;
      sendState();
    }
  }, [host, state]);
  return host;
}

export function DesktopPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="desktop-action-panel mac-action-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
