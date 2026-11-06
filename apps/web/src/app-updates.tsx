import { useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { useDesktopUpdate } from "./desktop-updates";

const desktopDismissKey = "connect.desktop-update-dismissed";

export function WebUpdateNotice() {
  const desktop = useDesktopUpdate();
  const [dismissedDesktop, setDismissedDesktop] = useState(() => {
    try {
      return sessionStorage.getItem(desktopDismissKey) || "";
    } catch {
      return "";
    }
  });
  const [available, setAvailable] = useState(""),
    [dismissed, setDismissed] = useState("");
  useEffect(() => {
    let cancel = false;
    const current =
      (import.meta as any).env.VITE_CONNECT_RELEASE || "development";
    if (current === "development") return;
    const check = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (!response.ok) return;
        const { release } = await response.json();
        if (!cancel && release && release !== current) setAvailable(release);
      } catch {}
    };
    const timer = setInterval(check, 120000);
    document.addEventListener("visibilitychange", check);
    void check();
    return () => {
      cancel = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  const desktopRelease = desktop && `${desktop.platform}:${desktop.version}`;
  if (desktop?.available && desktopRelease !== dismissedDesktop) {
    return (
      <aside className="web-update-notice desktop-update-notice" role="status">
        <Download size={19} aria-hidden="true" />
        <div>
          <strong>Connect {desktop.version} is ready.</strong>
          <span>
            Download the update, then quit Connect and run the installer.
          </span>
        </div>
        {desktop.downloads.map((download) => (
          <a
            className="update-download"
            key={download.arch}
            href={download.url}
            target="_blank"
            rel="noreferrer"
          >
            Download update
            {desktop.downloads.length > 1 &&
              ` (${download.arch.toUpperCase()})`}
          </a>
        ))}
        <button
          className="update-dismiss"
          aria-label="Remind me later"
          onClick={() => {
            setDismissedDesktop(desktopRelease!);
            try {
              sessionStorage.setItem(desktopDismissKey, desktopRelease!);
            } catch {
              // Dismissal still works when browser storage is unavailable.
            }
          }}
        >
          <X size={15} />
        </button>
      </aside>
    );
  }
  if (!available || available === dismissed) return null;
  return (
    <aside className="web-update-notice" role="status">
      <RefreshCw size={19} />
      <div>
        <strong>A fresh Connect is ready.</strong>
        <span>Refresh to use the latest improvements.</span>
      </div>
      <button onClick={() => location.reload()}>Refresh Connect</button>
      <button
        className="update-dismiss"
        aria-label="Remind me later"
        onClick={() => setDismissed(available)}
      >
        <X size={15} />
      </button>
    </aside>
  );
}
