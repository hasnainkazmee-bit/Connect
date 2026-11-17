import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Maximize2,
  X,
} from "lucide-react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type { NetworkAttachment, NetworkPost } from "./types";
import { networkFileSize } from "./client";
export function networkFileUrl(file: Pick<NetworkAttachment, "id">) {
  return `/api/network-v2/files/${encodeURIComponent(file.id)}`;
}
export function NetworkMedia({
  files = [],
  format = "4:5",
  onOpen,
  onOpenPost,
}: {
  files: NetworkAttachment[];
  format?: NetworkPost["media_format"];
  onOpen: (file: NetworkAttachment) => void;
  onOpenPost?: () => void;
}) {
  const images = files.filter((f) => f.mime_type.startsWith("image/")),
    documents = files.filter((f) => !f.mime_type.startsWith("image/"));
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const go = (next: number) => {
    const i = Math.max(0, Math.min(images.length - 1, next));
    track.current?.scrollTo({
      left: i * track.current.clientWidth,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    setIndex(i);
  };
  return (
    <>
      {images.length > 0 && (
        <div
          className="nw-gallery"
          style={
            { "--nw-ratio": format.replace(":", "/") } as React.CSSProperties
          }
        >
          <div className="nw-gallery-stage">
            <div
              className="nw-gallery-track"
              ref={track}
              onScroll={() => {
                const el = track.current;
                if (el) setIndex(Math.round(el.scrollLeft / el.clientWidth));
              }}
              aria-label="Post images"
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  go(index + 1);
                }
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  go(index - 1);
                }
              }}
            >
              {images.map((file, i) => (
                <button
                  type="button"
                  key={file.id}
                  className="nw-gallery-slide"
                  onClick={() => onOpenPost ? onOpenPost() : onOpen(file)}
                  aria-label={onOpenPost
                    ? `View post and comments, image ${i + 1} of ${images.length}`
                    : `Open ${file.name}, image ${i + 1} of ${images.length}`}
                >
                  <img
                    src={networkFileUrl(file)}
                    alt={file.name}
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
            {images.length > 1 && (
              <>
                <span className="nw-gallery-count">
                  {index + 1} / {images.length}
                </span>
                <button
                  type="button"
                  className="nw-gallery-arrow previous"
                  disabled={!index}
                  onClick={() => go(index - 1)}
                  aria-label="Previous image"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  className="nw-gallery-arrow next"
                  disabled={index >= images.length - 1}
                  onClick={() => go(index + 1)}
                  aria-label="Next image"
                >
                  <ChevronRight size={18} />
                </button>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div className="nw-gallery-dots">
              {images.map((f, i) => (
                <button
                  type="button"
                  key={f.id}
                  aria-label={`Show image ${i + 1}`}
                  aria-pressed={index === i}
                  onClick={() => go(i)}
                >
                  <span />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {documents.length > 0 && (
        <div className="nw-documents">
          {documents.map((file) => (
            <button
              type="button"
              className="nw-file"
              key={file.id}
              onClick={() => onOpen(file)}
            >
              <FileText size={23} />
              <span>
                <b>{file.name}</b>
                <small>
                  {networkFileSize(file.size_bytes)} ·{" "}
                  {file.mime_type === "application/pdf" ? "PDF" : "Document"}
                </small>
              </span>
              <Maximize2 size={17} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
export function NetworkFileViewer({ id }: { id: string }) {
  const navigate = useNavigate(),
    location = useLocation(),
    [query] = useSearchParams();
  const name = query.get("name") || "Attachment",
    mime = query.get("type") || "application/pdf";
  const back = () =>
    location.state?.networkFileOrigin ? navigate(-1) : navigate("/network");
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") back();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [location.key]);
  const url = networkFileUrl({ id });
  return (
    <div className="nw-file-viewer">
      <header>
        <button type="button" className="nw-button nw-quiet" onClick={back}>
          <ArrowLeft size={18} />
          Back
        </button>
        <strong>{name}</strong>
        <a className="nw-button" href={`${url}?download=1`} download={name}>
          <Download size={18} />
          <span>Download</span>
        </a>
        <button
          type="button"
          className="nw-icon"
          aria-label="Close viewer"
          onClick={back}
        >
          <X size={22} />
        </button>
      </header>
      <div className="nw-file-canvas">
        {mime.startsWith("image/") ? (
          <img src={url} alt={name} />
        ) : mime === "application/pdf" ? (
          <iframe src={`${url}?preview=1#toolbar=1`} title={name} />
        ) : (
          <div className="nw-state">
            <FileText size={40} />
            <h2>{name}</h2>
            <p>Download this file to open it on your device.</p>
            <a
              href={`${url}?download=1`}
              className="nw-button nw-primary"
              download={name}
            >
              Download file
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
