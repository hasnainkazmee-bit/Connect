import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
export function WebUpdateNotice() {
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
