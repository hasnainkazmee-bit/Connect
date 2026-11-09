import { useEffect, useState } from "react";
import { ArrowUpRight, Check, LoaderCircle, Star } from "lucide-react";
import { api } from "./api";
import "./google-business-manager.css";

type Status = {
  enabled: boolean;
  connected: boolean;
  locationName: string | null;
  locationTitle: string | null;
  rating: number | null;
  count: number;
  updatedAt: string | null;
};
type Location = {
  accountName: string;
  locationName: string;
  title: string;
  address: string;
  website: string;
};

export function GoogleBusinessManager() {
  const [status, setStatus] = useState<Status | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    api<Status>("/companies/current/google-business", { signal: abort.signal })
      .then((result) => {
        if (!abort.signal.aborted) setStatus(result);
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setError(reason.message);
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!status?.connected || status.locationName) return;
    const abort = new AbortController();
    setBusy(true);
    api<{ locations: Location[] }>(
      "/companies/current/google-business/locations",
      {
        signal: abort.signal,
      },
    )
      .then((result) => {
        if (!abort.signal.aborted) setLocations(result.locations);
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [status?.connected, status?.locationName]);
  const result = new URLSearchParams(window.location.search).get("google");
  async function choose(location: Location) {
    setBusy(true);
    setError("");
    try {
      await api("/companies/current/google-business/location", {
        method: "POST",
        body: JSON.stringify({
          accountName: location.accountName,
          locationName: location.locationName,
        }),
      });
      window.location.reload();
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api("/companies/current/google-business", { method: "DELETE" });
      window.location.reload();
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  }
  return (
    <section
      className="google-business-panel"
      aria-label="Google rating connection"
    >
      <div className="google-business-head">
        <span className="google-business-icon" aria-hidden="true">
          <img src="/assets/google-maps-darkgray.svg" alt="" />
        </span>
        <div>
          <h3>Google rating</h3>
          <p>Show your Google score alongside your Connect customer reviews.</p>
        </div>
      </div>
      {result === "failed" && (
        <p className="google-business-error">
          The Google connection didn’t finish. Please try again.
        </p>
      )}
      {error && (
        <p className="google-business-error" role="alert">
          {error}
        </p>
      )}
      {!status ? (
        !error && (
          <span className="google-business-loading">
            <LoaderCircle size={16} className="spin" /> Loading Google
            connection…
          </span>
        )
      ) : !status.enabled ? (
        <p className="google-business-hint">
          Google Business Profile access is being set up. Connect reviews remain
          available now.
        </p>
      ) : !status.connected ? (
        <>
          <button
            className="button primary google-business-connect"
            onClick={() => window.location.assign("/api/google-business/start")}
          >
            Connect Google Business Profile <ArrowUpRight size={16} />
          </button>
          <p className="google-business-hint">
            Only a company owner or admin can connect a verified Google listing.
            Google asks for Business Profile access; Connect reads your rating
            and review count only.
          </p>
        </>
      ) : status.locationName ? (
        <div className="google-business-linked">
          <span className="google-business-linked-title">
            <Check size={16} /> {status.locationTitle}
          </span>
          {status.rating !== null ? (
            <span className="google-business-linked-score">
              <Star size={15} fill="currentColor" /> {status.rating.toFixed(1)}{" "}
              · {status.count.toLocaleString()} Google ratings
            </span>
          ) : (
            <span className="google-business-hint">
              No Google ratings for this location yet.
            </span>
          )}
          <button
            className="google-business-disconnect"
            disabled={busy}
            onClick={disconnect}
          >
            Disconnect Google
          </button>
        </div>
      ) : (
        <>
          <p className="google-business-hint">
            Choose the Google listing for this company. Its name or website must
            match this Connect profile.
          </p>
          {busy && !locations.length && (
            <span className="google-business-loading">
              <LoaderCircle size={16} className="spin" /> Finding your
              locations…
            </span>
          )}
          {!busy && !locations.length && !error && (
            <p className="google-business-hint">
              No eligible locations were found in this Google account.
            </p>
          )}
          <div className="google-business-locations">
            {locations.map((location) => (
              <button
                key={`${location.accountName}:${location.locationName}`}
                disabled={busy}
                onClick={() => void choose(location)}
              >
                <span>
                  <strong>{location.title}</strong>
                  <small>
                    {location.address ||
                      location.website ||
                      "Google Business Profile"}
                  </small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
          <button
            className="google-business-disconnect"
            disabled={busy}
            onClick={disconnect}
          >
            Use a different Google account
          </button>
        </>
      )}
    </section>
  );
}
