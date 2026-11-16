import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, ArrowRight } from "lucide-react";
import { useApp } from "./context";
export type GalleryMedia = {
  id: string;
  name: string;
  mime: string;
  size?: number;
  url: string;
  alt: string;
};
export function MediaGallery({
  media,
  companyName,
  preview = false,
}: {
  media: GalleryMedia[];
  companyName: string;
  preview?: boolean;
}) {
  const { open } = useApp();
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const photosOnly = media.every((item) => item.mime.startsWith("image/"));
  const itemLabel = photosOnly ? "photo" : "attachment";
  const identity = media.map((item) => item.id).join(":");
  useEffect(() => {
    setActive(0);
    track.current?.scrollTo({ left: 0, behavior: "instant" });
  }, [identity]);
  const go = (index: number, moveFocus = false) => {
    const el = track.current;
    if (!el) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (moveFocus)
      (el.children[index] as HTMLElement | undefined)?.focus({
        preventScroll: true,
      });
    el.scrollTo({
      left: index * el.clientWidth,
      behavior: reduced ? "instant" : "smooth",
    });
  };
  if (!media.length) return null;
  return (
    <div className="post-media">
      <div
        className="photo-gallery"
        role="region"
        aria-roledescription={media.length > 1 ? "carousel" : undefined}
        aria-label={`${photosOnly ? "Photos" : "Attachments"} from ${companyName}`}
      >
        <div
          className="photo-track"
          ref={track}
          onScroll={(event) => {
            const el = event.currentTarget;
            const next = Math.min(
              media.length - 1,
              Math.round(el.scrollLeft / Math.max(1, el.clientWidth)),
            );
            setActive(next);
            el.querySelectorAll("video").forEach((video) => {
              if (video.parentElement !== el.children[next]) video.pause();
            });
          }}
          onKeyDown={(event) => {
            // Native video controls own their arrow-key seeking/volume behavior.
            if ((event.target as HTMLElement).closest("video")) return;
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              go(
                Math.min(
                  media.length - 1,
                  Math.max(0, active + (event.key === "ArrowRight" ? 1 : -1)),
                ),
                true,
              );
            }
          }}
        >
          {media.map((item, index) =>
            item.mime.startsWith("image/") ? (
              <button
                className="post-media-slide post-photo"
                key={item.id}
                tabIndex={active === index ? 0 : -1}
                aria-label={
                  "View " +
                  (item.alt || `photo ${index + 1} from ${companyName}`)
                }
                onClick={() =>
                  !preview &&
                  open(
                    <div className="post-lightbox">
                      <img
                        src={item.url}
                        alt={item.alt || "Photo shared by " + companyName}
                      />
                      {item.alt && <p>{item.alt}</p>}
                    </div>,
                  )
                }
              >
                <img
                  src={item.url}
                  alt={item.alt || "Photo shared by " + companyName}
                  loading="lazy"
                  decoding="async"
                />
              </button>
            ) : item.mime.startsWith("video/") ? (
              <div
                className="post-media-slide post-video"
                key={item.id}
                tabIndex={active === index ? 0 : -1}
                aria-label={"Video from " + companyName}
              >
                <video
                  src={item.url}
                  controls
                  playsInline
                  preload="metadata"
                  tabIndex={active === index ? 0 : -1}
                  aria-label={"Video from " + companyName}
                />
              </div>
            ) : (
              <a
                key={item.id}
                href={item.url}
                className="post-media-slide post-document"
                tabIndex={active === index ? 0 : -1}
                title={item.name}
              >
                <FileText size={40} aria-hidden="true" />
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    PDF
                    {item.size
                      ? ` · ${(item.size / 1024 / 1024).toFixed(1)} MB`
                      : ""}
                    {" · Download"}
                  </small>
                </div>
                <ArrowRight size={19} aria-hidden="true" />
              </a>
            ),
          )}
        </div>
        {media.length > 1 && (
          <div className="photo-pagination">
            <button
              className="icon-button"
              aria-label={"Previous " + itemLabel}
              disabled={active === 0}
              onClick={() => go(active - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span role="status" aria-live="polite">
              {active + 1} / {media.length}
            </span>
            <div className="photo-dots" aria-hidden="true">
              {media.length <= 7 &&
                media.map((item, index) => (
                  <i
                    key={item.id}
                    className={active === index ? "active" : ""}
                  />
                ))}
            </div>
            <button
              className="icon-button"
              aria-label={"Next " + itemLabel}
              disabled={active === media.length - 1}
              onClick={() => go(active + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
