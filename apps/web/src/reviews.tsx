import { useEffect, useState } from "react";
import {
  Check,
  MessageSquare,
  Pencil,
  Share2,
  Star,
  Trash2,
  Flag,
} from "lucide-react";
import { api, post } from "./api";
import { useApp } from "./context";
import { Avatar } from "./identity";
import {
  ConfirmAction,
  FormError,
  ShareProfile,
  useAction,
  useUnsavedChanges,
} from "./management";
import type { Company, Rating } from "./types";

type Review = {
  id: string;
  rating: number;
  title: string;
  body: string;
  experience_date: string;
  reply: string;
  replied_at: string | null;
  created_at: string;
  reviewer_name: string;
  user_id: string;
};
type Reviews = {
  reviews: Review[];
  mine: Review | null;
  affiliated: boolean;
  rating: Rating;
  nextPage: number | null;
};
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="review-stars" aria-label={value + " out of 5 stars"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          fill={n <= Math.round(value) ? "currentColor" : "none"}
          className={n <= Math.round(value) ? "" : "empty-star"}
        />
      ))}
    </span>
  );
}
function ReviewEditor({
  target,
  review,
}: {
  target: Company;
  review?: Review | null;
}) {
  const { close, refresh, toast } = useApp(),
    task = useAction();
  const [rating, setRating] = useState(review?.rating || 0),
    [dirty, setDirty] = useState(false);
  const guard = useUnsavedChanges(dirty, task.busy);
  return (
    <section className="manage-dialog">
      <header className="manage-heading">
        <span>YOUR EXPERIENCE MATTERS</span>
        <h2>Review {target.name}</h2>
        <p>Tell other customers about working with this company.</p>
      </header>
      <form
        className="manage-form"
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(e.currentTarget));
          void task.run(async () => {
            await api("/companies/" + target.id + "/reviews/mine", {
              method: "PUT",
              body: JSON.stringify({ ...d, rating, customerExperience: true }),
            });
            refresh();
            close();
            toast("Your review is now on the company profile.");
          });
        }}
      >
        <fieldset className="review-rating-input">
          <legend>How was your experience?</legend>
          <div>
            {[1, 2, 3, 4, 5].map((n) => (
              <label
                key={n}
                title={
                  ["Poor", "Fair", "Good", "Very good", "Excellent"][n - 1]
                }
              >
                <input
                  type="radio"
                  name="rating"
                  required
                  value={n}
                  checked={rating === n}
                  onChange={() => {
                    setRating(n);
                    setDirty(true);
                  }}
                  aria-label={n + " star" + (n > 1 ? "s" : "")}
                />
                <Star size={34} fill={n <= rating ? "currentColor" : "none"} />
              </label>
            ))}
          </div>
          <small>
            {rating
              ? ["Poor", "Fair", "Good", "Very good", "Excellent"][rating - 1]
              : "Choose a rating"}
          </small>
        </fieldset>
        <label>
          A short summary
          <input
            name="title"
            defaultValue={review?.title}
            required
            minLength={3}
            maxLength={120}
            placeholder="What stood out?"
          />
        </label>
        <label>
          Your review
          <textarea
            name="body"
            defaultValue={review?.body}
            required
            minLength={20}
            maxLength={3000}
            rows={5}
            placeholder="What went well? What could have been better? A few specifics go a long way."
          />
        </label>
        <label>
          When did you work with them?
          <input
            name="experienceDate"
            type="date"
            required
            max={new Date().toISOString().slice(0, 10)}
            defaultValue={review?.experience_date?.slice(0, 10)}
          />
        </label>
        <label className="review-attestation">
          <input type="checkbox" required />
          <span>
            This reflects my own experience as a customer. I’m not part of this
            company’s team.
          </span>
        </label>
        <FormError error={task.error} />
        {guard}
        <footer className="manage-footer">
          <span>Your name and review will be public.</span>
          <button className="button primary" disabled={task.busy || !rating}>
            {task.busy
              ? "Saving…"
              : review
                ? "Update review"
                : "Publish review"}
          </button>
        </footer>
      </form>
    </section>
  );
}
function ReviewResponse({
  review,
  report = false,
}: {
  review: Review;
  report?: boolean;
}) {
  const { close, refresh, toast } = useApp(),
    task = useAction();
  return (
    <section className="manage-dialog">
      <header className="manage-heading">
        <h2>{report ? "Report this review" : "Reply as your company"}</h2>
        <p>
          {report
            ? "Tell us what’s wrong with this review. Reporting does not remove it."
            : "A thoughtful response shows customers you’re listening."}
        </p>
      </header>
      <form
        className="manage-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(e.currentTarget));
          void task.run(async () => {
            await post(
              "/reviews/" + review.id + (report ? "/report" : "/reply"),
              d,
            );
            refresh();
            close();
            toast(
              report
                ? "Your report has been recorded."
                : "Company reply published.",
            );
          });
        }}
      >
        <label>
          {report ? "Reason" : "Your reply"}
          <textarea
            name={report ? "reason" : "body"}
            required
            minLength={report ? 10 : 1}
            maxLength={report ? 1000 : 2000}
            rows={5}
            defaultValue={report ? "" : review.reply}
          />
        </label>
        <FormError error={task.error} />
        <footer className="manage-footer">
          <button className="button primary" disabled={task.busy}>
            {report ? "Submit report" : "Publish reply"}
          </button>
        </footer>
      </form>
    </section>
  );
}
export function CompanyReviews({ target }: { target: Company }) {
  const { company, session, admin, revision, open, signIn } = useApp(),
    task = useAction();
  const [data, setData] = useState<Reviews | null>(null),
    [page, setPage] = useState(1);
  useEffect(() => {
    let cancelled = false;
    api<Reviews>("/companies/" + target.id + "/reviews?page=" + page)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => task.setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [target.id, revision, page, session.user?.id]);
  const own = company?.id === target.id && admin;
  return (
    <section className="company-reviews">
      <div className="profile-section-heading">
        <div>
          <h2>Customer reviews</h2>
          <p>Experiences shared by the people you work with.</p>
        </div>
        {own ? (
          <button
            className="button"
            onClick={() => open(<ShareProfile target={target} reviews />)}
          >
            <Share2 size={15} />
            Get reviews
          </button>
        ) : (
          !data?.affiliated && (
            <button
              className="button primary"
              onClick={() =>
                session.user
                  ? open(<ReviewEditor target={target} review={data?.mine} />)
                  : signIn()
              }
            >
              <Pencil size={15} />
              {data?.mine ? "Edit your review" : "Write a review"}
            </button>
          )
        )}
      </div>
      <FormError error={task.error} />
      {data && (
        <>
          <div className="rating-summary">
            <div className="rating-total">
              <strong>{data.rating.average?.toFixed(1) || "—"}</strong>
              <Stars value={data.rating.average || 0} size={18} />
              <span>
                {data.rating.count}{" "}
                {data.rating.count === 1 ? "review" : "reviews"}
              </span>
            </div>
            <div className="rating-distribution">
              {data.rating.distribution.map((d) => (
                <div key={d.rating}>
                  <span>
                    {d.rating}
                    <Star size={10} />
                  </span>
                  <div>
                    <i
                      style={{
                        width:
                          (data.rating.count
                            ? (d.count / data.rating.count) * 100
                            : 0) + "%",
                      }}
                    />
                  </div>
                  <small>{d.count}</small>
                </div>
              ))}
            </div>
            <p>
              Reviews describe customer experiences.
              <br />
              Connect does not verify purchases.
            </p>
          </div>
          {!data.reviews.length ? (
            <div className="profile-empty">
              <Star size={28} />
              <h3>The first review starts a story.</h3>
              <p>
                {own
                  ? "Share your review link with a customer after your next project."
                  : "Worked with " + target.name + "? Share your experience."}
              </p>
            </div>
          ) : (
            data.reviews.map((r) => (
              <article className="customer-review" key={r.id}>
                <header>
                  <Avatar name={r.reviewer_name} />
                  <div>
                    <strong>{r.reviewer_name}</strong>
                    <small>
                      {new Date(r.created_at).toLocaleDateString(undefined, {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </small>
                  </div>
                  <Stars value={r.rating} />
                </header>
                <h3>{r.title}</h3>
                <p>{r.body}</p>
                <small className="review-experience">
                  Experience:{" "}
                  {new Date(
                    r.experience_date.slice(0, 10) + "T12:00:00",
                  ).toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })}
                </small>
                {r.reply && (
                  <blockquote>
                    <strong>{target.name} replied</strong>
                    <p>{r.reply}</p>
                  </blockquote>
                )}
                <footer>
                  {own && (
                    <button onClick={() => open(<ReviewResponse review={r} />)}>
                      <MessageSquare size={13} />
                      {r.reply ? "Edit reply" : "Reply"}
                    </button>
                  )}
                  {r.user_id === session.user?.id && (
                    <>
                      <button
                        onClick={() =>
                          open(<ReviewEditor target={target} review={r} />)
                        }
                      >
                        <Pencil size={13} />
                        Edit
                      </button>
                      <button
                        onClick={() =>
                          open(
                            <ConfirmAction
                              title="Delete your review?"
                              description="Your rating and review will be removed from this profile."
                              label="Delete review"
                              action={() =>
                                api(
                                  "/companies/" + target.id + "/reviews/mine",
                                  { method: "DELETE" },
                                )
                              }
                            />,
                          )
                        }
                      >
                        <Trash2 size={13} />
                        Delete
                      </button>
                    </>
                  )}
                  {session.user && r.user_id !== session.user.id && (
                    <button
                      onClick={() => open(<ReviewResponse review={r} report />)}
                    >
                      <Flag size={12} />
                      Report
                    </button>
                  )}
                </footer>
              </article>
            ))
          )}
          {(page > 1 || data.nextPage) && (
            <div className="review-pagination">
              <button
                className="button"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>Page {page}</span>
              <button
                className="button"
                disabled={!data.nextPage}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
