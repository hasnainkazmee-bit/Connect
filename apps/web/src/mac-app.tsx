import { useEffect, useRef, useState, type ReactNode } from "react";
import { installMacNativeSelects } from "./mac-native-select";

const routes = new Set([
  "/",
  "/directory",
  "/network",
  "/network/connections",
  "/messages",
]);
export type MacCommand =
  | { type: "navigate"; path: string }
  | { type: "compose" | "account" | "notifications" | "profile" };
export type MacState = {
  ready: boolean;
  path: string;
  signedIn: boolean;
  accountType: string;
  userName: string;
  companyName: string;
  canPublish: boolean;
  unreadCount: number;
};
type MacWindow = Window & {
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
    typeof (window as MacWindow).webkit?.messageHandlers?.connectMac
      ?.postMessage === "function"
  );
}

// This adapter exposes navigation/UI intents only. The existing React handlers
// remain responsible for authentication, authorization, and every API mutation.
export function useMacApp(
  state: MacState,
  onCommand: (command: MacCommand) => void,
) {
  const [enabled] = useState(isMacApp);
  const current = useRef({ state, onCommand });
  current.current = { state, onCommand };
  const lastState = useRef("");
  const queuedCommand = useRef<MacCommand | null>(null);
  const sendState = () => {
    if (!enabled) return;
    const value = current.current.state;
    try {
      (window as MacWindow).webkit!.messageHandlers!.connectMac!.postMessage!({
        type: "state",
        ready: value.ready,
        path: value.path,
        signedIn: value.signedIn,
        accountType: value.accountType,
        userName: value.userName,
        companyName: value.companyName,
        canPublish: value.canPublish,
        unreadCount: value.unreadCount,
      });
    } catch {
      /* Losing native chrome must never interrupt the web workspace. */
    }
  };
  useEffect(() => {
    if (!enabled) return;
    document.documentElement.classList.add("connect-mac");
    const removeNativeSelects = installMacNativeSelects();
    const deliver = (command: MacCommand) => {
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
        deliver({ type: command.type } as MacCommand);
      }
      // A dirty/saving modal can keep the route unchanged. Acknowledge that too.
      queueMicrotask(sendState);
    };
    window.addEventListener("connect:mac-command", receive);
    return () => {
      queuedCommand.current = null;
      removeNativeSelects();
      window.removeEventListener("connect:mac-command", receive);
      document.documentElement.classList.remove("connect-mac");
    };
  }, [enabled]);
  useEffect(() => {
    if (enabled && state.ready && queuedCommand.current) {
      const command = queuedCommand.current;
      queuedCommand.current = null;
      current.current.onCommand(command);
    }
  }, [enabled, state.ready]);
  useEffect(() => {
    const serialized = JSON.stringify(state);
    if (serialized !== lastState.current) {
      lastState.current = serialized;
      sendState();
    }
  }, [enabled, state]);
  return enabled;
}

export function MacPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mac-action-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
