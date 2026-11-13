import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileText,
  Paperclip,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useApp } from "./context";

export type JobFile = {
  provider_company_id?: string | null;
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  quote_id?: string | null;
  quote_version?: number | null;
  update_id?: string | null;
  message_id?: string | null;
};
type ViewFile = {
  name: string;
  type: string;
  size: number;
  file?: File;
  src?: string;
  download?: string;
};
const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const savedFile = (f: JobFile): ViewFile => ({
  name: f.original_name,
  type: f.mime_type,
  size: f.size_bytes,
  src: `/api/jobs/files/${f.id}?preview=1`,
  download: `/api/jobs/files/${f.id}`,
});
const pendingFile = (f: File): ViewFile => ({
  name: f.name,
  type: f.type,
  size: f.size,
  file: f,
});
export function attachmentError(files: File[]) {
  if (files.some((f) => f.size === 0))
    return "This file is empty. Choose another file.";
  if (files.some((f) => f.size > 12 * 1024 * 1024))
    return "Each attachment must be 12 MB or smaller.";
  if (
    files.some(
      (f) =>
        !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(
          f.type,
        ),
    )
  )
    return "Use PDF, JPG, PNG, or WebP attachments.";
  if (files.some((f) => f.name.length > 200))
    return "Use a file name shorter than 200 characters.";
  return "";
}
function useFileUrl(item?: ViewFile) {
  const [local, setLocal] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!item?.file) return;
    const value = URL.createObjectURL(item.file);
    setLocal({ file: item.file, url: value });
    return () => URL.revokeObjectURL(value);
  }, [item?.file]);
  // Never render the previous attachment's URL while the next file loads.
  return item?.file
    ? local?.file === item.file
      ? local.url
      : ""
    : item?.src || "";
}
function AttachmentThumbnail({ item }: { item: ViewFile }) {
  const src = useFileUrl(item);
  return (
    <span className="attachment-thumbnail">
      {item.type.startsWith("image/") ? (
        <img src={src} alt="" loading="lazy" />
      ) : (
        <>
          <FileText size={28} />
          <b>PDF</b>
        </>
      )}
    </span>
  );
}
export function AttachmentViewer({
  files,
  initial = 0,
}: {
  files: ViewFile[];
  initial?: number;
}) {
  const { close } = useApp();
  const root = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(
      Math.max(0, Math.min(initial, files.length - 1)),
    ),
    [zoom, setZoom] = useState(1);
  const [imageFailed, setImageFailed] = useState(false);
  const item = files[index] || files[0];
  const src = useFileUrl(item);
  const isImage = !!item?.type.startsWith("image/");
  const isPdf = item?.type === "application/pdf";
  useEffect(() => setZoom(1), [index]);
  useEffect(() => setImageFailed(false), [src]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (root.current && !root.current.closest("[hidden]"))
        root.current
          .querySelector<HTMLElement>("h2")
          ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // Older action pages stay mounted to keep their source drafts. Only the
      // visible viewer may respond to shortcuts.
      if (
        !root.current ||
        root.current.closest("[hidden]") ||
        event.defaultPrevented
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, select, [contenteditable=true]")
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowLeft" && zoom === 1) {
        event.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (event.key === "ArrowRight" && zoom === 1) {
        event.preventDefault();
        setIndex((i) => Math.min(files.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [close, files.length, zoom]);
  if (!item)
    return (
      <section className="job-file-viewer" ref={root}>
        <header className="job-file-toolbar">
          <button
            type="button"
            className="jobs-button jobs-secondary viewer-back"
            onClick={() => close()}
          >
            <ArrowLeft size={18} />
            Back
          </button>
          <h2 tabIndex={-1}>Attachment unavailable</h2>
        </header>
        <div className="job-file-canvas">
          <p className="file-viewer-fallback">
            Return to the job and choose another attachment.
          </p>
        </div>
      </section>
    );
  return (
    <section
      className="job-file-viewer"
      ref={root}
      aria-label="Attachment preview"
    >
      <header className="job-file-toolbar">
        <button
          type="button"
          className="jobs-button jobs-secondary viewer-back"
          onClick={() => close()}
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <div className="job-file-heading">
          <h2 tabIndex={-1}>{item.name}</h2>
          <span aria-live="polite">
            {sizeLabel(item.size)} · {index + 1} of {files.length}
          </span>
        </div>
        <button
          type="button"
          className="viewer-close"
          aria-label="Close preview"
          onClick={() => close()}
        >
          <X size={22} />
        </button>
      </header>
      <div
        className={`job-file-canvas ${isImage ? "image" : isPdf ? "pdf" : "document"}`}
      >
        {src &&
          (isImage && !imageFailed ? (
            <div className="job-file-image-scroll">
              <img
                src={src}
                alt={item.name}
                onError={() => setImageFailed(true)}
                style={{
                  width: zoom > 1 ? `${zoom * 100}%` : undefined,
                  maxWidth: zoom > 1 ? "none" : undefined,
                  maxHeight: zoom > 1 ? "none" : undefined,
                }}
              />
            </div>
          ) : isPdf ? (
            <iframe
              src={src + "#view=FitH"}
              title={`PDF preview: ${item.name}`}
            />
          ) : (
            <div className="file-viewer-fallback">
              <FileText size={36} />
              <p>
                {imageFailed
                  ? "This image could not be displayed."
                  : "Download this attachment to open it."}
              </p>
              <a
                href={item.download || src}
                download={item.name}
                className="jobs-button jobs-secondary"
              >
                <Download size={18} />
                Download file
              </a>
            </div>
          ))}
      </div>
      <footer>
        <div className="viewer-navigation" aria-label="Attachments">
          <button
            type="button"
            className="jobs-button jobs-secondary"
            aria-label="Previous attachment"
            disabled={index === 0}
            onClick={() => setIndex((i) => i - 1)}
          >
            <ArrowLeft size={18} />
          </button>
          <span>
            {index + 1} / {files.length}
          </span>
          <button
            type="button"
            className="jobs-button jobs-secondary"
            aria-label="Next attachment"
            disabled={index === files.length - 1}
            onClick={() => setIndex((i) => i + 1)}
          >
            <ArrowRight size={18} />
          </button>
        </div>
        {isImage && (
          <div className="viewer-zoom">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={zoom <= 1}
              onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
            >
              <ZoomOut size={18} />
            </button>
            <button
              type="button"
              className="viewer-fit"
              aria-label="Fit image to screen"
              onClick={() => setZoom(1)}
            >
              {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={zoom >= 3}
              onClick={() => setZoom((z) => Math.min(3, z + 0.5))}
            >
              <ZoomIn size={18} />
            </button>
          </div>
        )}
        <a
          href={item.download || src}
          download={item.name}
          className="jobs-button jobs-secondary"
        >
          <Download size={16} />
          Download
        </a>
      </footer>
      {isPdf && (
        <p className="file-viewer-help">
          Use the document toolbar to move between pages or zoom.{" "}
          <a href={item.download || src} download={item.name}>
            Download PDF
          </a>{" "}
          if your browser cannot display it.
        </p>
      )}
    </section>
  );
}
export function AttachmentPicker({
  files,
  onChange,
  label = "Add plans or photos",
  disabled = false,
  readOnly = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  label?: string;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const { open } = useApp();
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const addFiles = (selected: File[]) => {
    const issue = attachmentError(selected);
    setError(issue);
    if (!issue) onChange([...files, ...selected]);
  };
  const items = files.map(pendingFile);
  return (
    <div className="job-attachment-picker">
      {!readOnly && (
        <label
          className={`attachment-add ${disabled ? "disabled" : ""} ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={(e) => {
            if (
              !(e.relatedTarget instanceof Node) ||
              !e.currentTarget.contains(e.relatedTarget)
            )
              setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!disabled) addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <Paperclip size={19} />
          <span>
            <b>{label}</b>
            <small>
              Drop files here or browse · PDF or images · 12 MB each
            </small>
          </span>
          <input
            aria-label={label}
            type="file"
            multiple
            disabled={disabled}
            accept=".pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              addFiles(selected);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {error && (
        <p className="job-error" role="alert">
          {error}
        </p>
      )}
      {!!items.length && (
        <div className="job-attachment-grid">
          {items.map((item, i) => (
            <div
              className="job-attachment-card"
              data-kind={item.type.startsWith("image/") ? "image" : "document"}
              key={`${i}-${item.name}`}
            >
              <button
                type="button"
                className="attachment-preview"
                aria-label={`Preview ${item.name}`}
                onClick={() =>
                  open(<AttachmentViewer files={items} initial={i} />)
                }
              >
                <AttachmentThumbnail item={item} />
                <span>
                  <b>{item.name}</b>
                  <small>{sizeLabel(item.size)} · Preview</small>
                </span>
              </button>
              {!readOnly && (
                <button
                  type="button"
                  className="attachment-remove"
                  disabled={disabled}
                  aria-label={`Remove ${item.name}`}
                  onClick={() => onChange(files.filter((_, n) => n !== i))}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
export function JobAttachments({ files }: { files: JobFile[] }) {
  const { open } = useApp();
  if (!files.length) return null;
  const items = files.map(savedFile);
  return (
    <div className="job-attachment-grid">
      {items.map((item, i) => (
        <div
          className="job-attachment-card"
          data-kind={item.type.startsWith("image/") ? "image" : "document"}
          key={files[i].id}
        >
          <button
            className="attachment-preview"
            type="button"
            aria-label={`Preview ${item.name}`}
            onClick={() => open(<AttachmentViewer files={items} initial={i} />)}
          >
            <AttachmentThumbnail item={item} />
            <span>
              <b>{item.name}</b>
              <small>{sizeLabel(item.size)} · Open preview</small>
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
