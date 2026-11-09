import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api } from "./api";
import { Stars } from "./reviews";
import "./google-reviews.css";

type GoogleReviewsData = {
  linked: boolean;
  googleMapsUri?: string;
  rating?: number | null;
  count?: number;
  attributions?: { provider?: string; providerUri?: string }[];
  reviews?: {
    id: string;
    rating: number | null;
    body: string;
    published: string;
    visitDate?: { year?: number; month?: number } | null;
    googleMapsUri: string;
    author: {
      displayName?: string;
      uri?: string;
      photoUri?: string;
    } | null;
  }[];
};

export function GoogleReviews({ companyId }: { companyId: string }) {
  const [data, setData] = useState<GoogleReviewsData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setFailed(false);
    api<GoogleReviewsData>(`/companies/${companyId}/google-reviews`, {
      signal: abort.signal,
    })
      .then((response) => {
        if (!abort.signal.aborted) setData(response);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, [companyId]);
  if ((!data || !data.linked) && !failed) return null;
  if (failed)
    return (
      <section className="profile-card google-reviews-card">
        <h2>Google reviews</h2>
        <p>Google reviews are temporarily unavailable.</p>
      </section>
    );
  return (
    <section className="profile-card google-reviews-card">
      <header className="google-reviews-heading">
        <div>
          <h2>Google reviews</h2>
          <p>Public feedback from Google Maps</p>
        </div>
        <a
          href={data!.googleMapsUri}
          target="_blank"
          rel="noopener noreferrer"
          className="google-maps-attribution"
          aria-label="View on Google Maps"
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
        </a>
      </header>
      {data!.rating != null && (
        <div className="google-rating">
          <strong>{data!.rating.toFixed(1)}</strong>
          <Stars value={data!.rating} size={17} />
          <span>{data!.count?.toLocaleString()} ratings on Google Maps</span>
        </div>
      )}
      {!!data!.reviews?.length && (
        <>
          <p className="google-review-context">
            A selection of Google reviews, ordered by relevance.
          </p>
          <div className="google-review-list">
            {data!.reviews!.map((review) => (
              <article
                key={review.id || review.googleMapsUri}
                className="google-review"
              >
                <header>
                  <a
                    href={review.author?.uri || review.googleMapsUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="google-review-author"
                  >
                    {review.author?.photoUri ? (
                      <img src={review.author.photoUri} alt="" />
                    ) : (
                      <span className="google-review-avatar" aria-hidden="true">
                        {review.author?.displayName?.slice(0, 1) || "G"}
                      </span>
                    )}
                    <strong>
                      {review.author?.displayName || "Google reviewer"}
                    </strong>
                  </a>
                  <span>{review.published}</span>
                </header>
                {review.rating != null && (
                  <div className="google-review-stars">
                    <Stars value={review.rating} size={13} />
                  </div>
                )}
                {review.visitDate?.year && review.visitDate.month && (
                  <span className="google-review-visit">
                    Visited{" "}
                    {new Intl.DateTimeFormat(undefined, {
                      year: "numeric",
                      month: "long",
                    }).format(
                      new Date(
                        Date.UTC(
                          review.visitDate.year,
                          review.visitDate.month - 1,
                          1,
                        ),
                      ),
                    )}
                  </span>
                )}
                {review.body && <p>{review.body}</p>}
                <a
                  href={review.googleMapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="google-review-source"
                >
                  View review on Google Maps <ArrowUpRight size={14} />
                </a>
              </article>
            ))}
          </div>
        </>
      )}
      {!!data!.attributions?.length && (
        <div className="google-data-providers">
          {data!.attributions!.map((item) =>
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
        </div>
      )}
      {!data!.rating && !data!.reviews?.length && (
        <p>No Google reviews are available for this company yet.</p>
      )}
    </section>
  );
}
