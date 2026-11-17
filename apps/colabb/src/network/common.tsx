import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, AlertCircle, RefreshCw, MessageSquare } from "lucide-react";
import type { NetworkCompany } from "./types";
import { networkApi, networkError } from "./client";

export function useNetworkResource<T>(
  path: string | null,
  revision: number | string = 0,
) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    networkApi<T>(path, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(networkError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, revision, retry]);
  return { data, setData, error, loading, retry: () => setRetry((n) => n + 1) };
}
export function CompanyLogo({
  company,
  size = 42,
}: {
  company?: Pick<NetworkCompany, "name" | "logo_url"> | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [company?.logo_url]);
  return (
    <span className="nw-logo" style={{ width: size, height: size }}>
      {company?.logo_url && !broken && (
        <img
          src={company.logo_url}
          alt={`${company.name} logo`}
          onError={() => setBroken(true)}
        />
      )}
    </span>
  );
}
export function NetworkState({
  loading,
  error,
  retry,
  title,
  children,
}: {
  loading?: boolean;
  error?: string;
  retry?: () => void;
  title?: string;
  children?: ReactNode;
}) {
  if (loading)
    return (
      <div className="nw-loading" role="status" aria-label="Loading Network">
        <div className="nw-skeleton nw-skeleton-line" />
        <div className="nw-skeleton nw-skeleton-card" />
        <div className="nw-skeleton nw-skeleton-card" />
        <span className="nw-sr">Loading</span>
      </div>
    );
  if (error)
    return (
      <div className="nw-state" role="alert">
        <AlertCircle size={28} />
        <h2>We couldn’t load this</h2>
        <p>{error}</p>
        {retry && (
          <button className="nw-button" onClick={retry}>
            <RefreshCw size={16} />
            Try again
          </button>
        )}
      </div>
    );
  return (
    <div className="nw-state">
      <MessageSquare size={28} />
      <h2>{title || "Nothing here yet"}</h2>
      {children}
    </div>
  );
}
export function BackButton({
  onClick,
  children = "Back",
}: {
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button className="nw-back" onClick={onClick}>
      <ArrowLeft size={18} />
      {children}
    </button>
  );
}
export function companyPath(company: NetworkCompany) {
  return company.slug ? `/${company.slug}` : `/company/${company.id}`;
}
