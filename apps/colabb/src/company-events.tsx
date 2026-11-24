import type { CompanyEvent } from "./types";
import "./brand/company-events.css";

export function CompanyEvents({
  events = [],
  compact = false,
}: {
  events?: CompanyEvent[];
  compact?: boolean;
}) {
  if (!events.length) return null;
  return (
    <div
      className={"company-events" + (compact ? " company-events-compact" : "")}
      aria-label="Events attended"
    >
      {events.map((event) => (
        <a
          className="company-event"
          key={event.key}
          href={event.website}
          target="_blank"
          rel="noreferrer"
          aria-label={`Attended ${event.name} ${event.year} — event website`}
        >
          {event.logo_path && (
            <span className="company-event-logo">
              <img src={event.logo_path} alt="" width={66} height={36} />
            </span>
          )}
          <span className="company-event-copy">
            <span>
              Attended{" "}
              <strong>
                {event.name} {event.year}
              </strong>
            </span>
            {!compact && (
              <small>
                {
                  {
                    attendee: "Attendee",
                    exhibitor: "Exhibitor",
                    sponsor: "Sponsor",
                    speaker: "Speaker",
                  }[event.participation]
                }
              </small>
            )}
          </span>
        </a>
      ))}
    </div>
  );
}
