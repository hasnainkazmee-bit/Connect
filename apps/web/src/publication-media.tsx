import { useRef, useState } from "react";
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
  const [ratio, setRatio] = useState("1 / 1");
  const photos = media.filter((m) => m.mime.startsWith("image/"));
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
  return (
    <div className="post-media">
      {photos.length > 0 && (
        <div
          className="photo-gallery"
          role="region"
          aria-roledescription="carousel"
          aria-label={`Photos from ${companyName}`}
        >
          <div
            className="photo-track"
            ref={track}
            style={{ aspectRatio: ratio }}
            onScroll={(event) => {
              const el = event.currentTarget;
              setActive(
                Math.round(el.scrollLeft / Math.max(1, el.clientWidth)),
              );
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                go(
                  Math.min(
                    photos.length - 1,
                    Math.max(0, active + (event.key === "ArrowRight" ? 1 : -1)),
                  ),
                  true,
                );
              }
            }}
          >
            {photos.map((m, index) => (
              <button
                className="post-photo"
                key={m.id}
                tabIndex={active === index ? 0 : -1}
                aria-label={
                  "View " + (m.alt || `photo ${index + 1} from ${companyName}`)
                }
                onClick={() =>
                  !preview &&
                  open(
                    <div className="post-lightbox">
                      <img
                        src={m.url}
                        alt={m.alt || "Photo shared by " + companyName}
                      />
                      {m.alt && <p>{m.alt}</p>}
                    </div>,
                  )
                }
              >
                <img
                  src={m.url}
                  alt={m.alt || "Photo shared by " + companyName}
                  loading="lazy"
                  decoding="async"
                  onLoad={(event) => {
                    if (index === 0) {
                      const img = event.currentTarget;
                      const r =
                        img.naturalWidth / Math.max(1, img.naturalHeight);
                      setRatio(
                        r < 0.9 ? "4 / 5" : r > 1.3 ? "16 / 9" : "1 / 1",
                      );
                    }
                  }}
                />
              </button>
            ))}
          </div>
          {photos.length > 1 && (
            <div className="photo-pagination">
              <button
                className="icon-button"
                aria-label="Previous photo"
                disabled={active === 0}
                onClick={() => go(active - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <span role="status" aria-live="polite">
                {active + 1} / {photos.length}
              </span>
              <div className="photo-dots" aria-hidden="true">
                {photos.map((m, index) => (
                  <i key={m.id} className={active === index ? "active" : ""} />
                ))}
              </div>
              <button
                className="icon-button"
                aria-label="Next photo"
                disabled={active === photos.length - 1}
                onClick={() => go(active + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>
      )}
      {media
        .filter((m) => !m.mime.startsWith("image/"))
        .map((m) =>
          m.mime.startsWith("video/") ? (
            <video
              key={m.id}
              src={m.url}
              controls
              playsInline
              preload="metadata"
              aria-label={"Video from " + companyName}
            />
          ) : (
            <a key={m.id} href={m.url} className="post-document">
              <FileText size={28} />
              <div>
                <strong>{m.name}</strong>
                <small>
                  PDF · {((m.size || 0) / 1024 / 1024).toFixed(1)} MB · Download
                </small>
              </div>
              <ArrowRight size={19} />
            </a>
          ),
        )}
    </div>
  );
}
