import { useEffect, useState } from "react";
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
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  quote_id?: string | null;
  update_id?: string | null;
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
function useFileUrl(item: ViewFile) {
  const [url, setUrl] = useState(item.src || "");
  useEffect(() => {
    if (!item.file) {
      setUrl(item.src || "");
      return;
    }
    const value = URL.createObjectURL(item.file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [item.file, item.src]);
  return url;
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
  const [index, setIndex] = useState(initial),
    [zoom, setZoom] = useState(1);
  const item = files[index];
  const src = useFileUrl(item);
  const isImage = item.type.startsWith("image/");
  useEffect(() => setZoom(1), [index]);
  return (
    <section className="job-file-viewer">
      <header>
        <h2>{item.name}</h2>
        <span>
          {sizeLabel(item.size)} · {index + 1} of {files.length}
        </span>
      </header>
      <div className={`job-file-canvas ${isImage ? "image" : "pdf"}`}>
        {src &&
          (isImage ? (
            <div className="job-file-image-scroll">
              <img
                src={src}
                alt={item.name}
                style={{
                  width: zoom > 1 ? `${zoom * 100}%` : undefined,
                  maxWidth: zoom > 1 ? "none" : undefined,
                  maxHeight: zoom > 1 ? "none" : undefined,
                }}
              />
            </div>
          ) : (
            <iframe
              src={src + "#view=FitH"}
              title={`PDF preview: ${item.name}`}
            />
          ))}
      </div>
      <footer>
        <div className="viewer-navigation">
          <button
            className="jobs-button jobs-secondary"
            aria-label="Previous attachment"
            disabled={index === 0}
            onClick={() => setIndex((i) => i - 1)}
          >
            <ArrowLeft size={18} />
          </button>
          <button
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
              aria-label="Zoom out"
              disabled={zoom <= 1}
              onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
            >
              <ZoomOut size={18} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
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
      {!isImage && (
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
  const items = files.map(pendingFile);
  return (
    <div className="job-attachment-picker">
      {!readOnly && (
        <label className={`attachment-add ${disabled ? "disabled" : ""}`}>
          <Paperclip size={19} />
          <span>
            <b>{label}</b>
            <small>Multiple files · PDF, JPG, PNG, WebP · 12 MB each</small>
          </span>
          <input
            aria-label={label}
            type="file"
            multiple
            disabled={disabled}
            accept=".pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              const issue = attachmentError(selected);
              setError(issue);
              if (!issue) onChange([...files, ...selected]);
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
            <div className="job-attachment-card" key={`${i}-${item.name}`}>
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
        <div className="job-attachment-card" key={files[i].id}>
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
