import { useEffect, useState } from "react";
import { ExternalLink, Star } from "lucide-react";
import { api } from "./api";
import "./google-rating.css";

type GoogleRatingData = {
  linked: boolean;
  googleMapsUri?: string;
  rating?: number | null;
  count?: number;
  attributions?: { provider?: string; providerUri?: string }[];
};

export function GoogleRating({
  companyId,
  companyName,
  location,
}: {
  companyId: string;
  companyName: string;
  location: string;
}) {
  const [data, setData] = useState<GoogleRatingData | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    api<GoogleRatingData>(`/companies/${companyId}/google-rating`, {
      signal: abort.signal,
    })
      .then((response) => {
        if (!abort.signal.aborted) setData(response);
      })
      .catch(() => {
        if (!abort.signal.aborted) setData(null);
      });
    return () => abort.abort();
  }, [companyId]);
  const mapsSearch = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [companyName.trim(), location.trim()].filter(Boolean).join(" "),
  )}`;
  if (!data?.linked || data.rating == null) {
    return (
      <a
        href={mapsSearch}
        target="_blank"
        rel="noopener noreferrer"
        className="presence-google-rating presence-google-lookup"
        aria-label={`Check ${companyName}'s rating on Google Maps`}
      >
        <img
          className="google-logo-light"
          src="/assets/google-maps-darkgray.svg"
          alt=""
        />
        <img
          className="google-logo-dark"
          src="/assets/google-maps-white.svg"
          alt=""
        />
        <span>Check rating</span>
        <ExternalLink size={13} aria-hidden="true" />
      </a>
    );
  }
  return (
    <span className="presence-google-rating-wrap">
      <a
        href={data.googleMapsUri}
        target="_blank"
        rel="noopener noreferrer"
        className="presence-google-rating"
        aria-label={`Google Maps rating ${data.rating.toFixed(1)} out of 5 from ${data.count || 0} ratings`}
      >
        <img
          className="google-logo-light"
          src="/assets/google-maps-darkgray.svg"
          alt="Google Maps"
        />
        <img
          className="google-logo-dark"
          src="/assets/google-maps-white.svg"
          alt=""
        />
        <span className="presence-google-score">
          <Star size={14} fill="currentColor" aria-hidden="true" />
          <strong>{data.rating.toFixed(1)}</strong>
          <span>({data.count?.toLocaleString()})</span>
        </span>
      </a>
      {!!data.attributions?.length && (
        <span className="google-data-providers">
          {data.attributions.map((item) =>
            item.providerUri ? (
              <a
                key={`${item.provider}:${item.providerUri}`}
                href={item.providerUri}
                target="_blank"
                rel="noopener noreferrer"
              >
                {item.provider}
              </a>
            ) : (
              <span key={item.provider}>{item.provider}</span>
            ),
          )}
        </span>
      )}
    </span>
  );
}
