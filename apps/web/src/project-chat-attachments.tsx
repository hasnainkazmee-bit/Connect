import { useEffect, useRef, useState } from "react";
import { FileText, LoaderCircle, Paperclip, RefreshCw, X } from "lucide-react";
import {
  attachmentError,
  JobAttachments,
  type JobFile,
} from "./job-attachments";

type Upload = {
  key: string;
  file: File;
  preview: string;
  progress: number;
  error: string;
  busy: boolean;
};
export function ChatAttachmentUpload({
  jobId,
  providerId,
  clientId,
  files,
  onChange,
  onBusy,
  disabled,
}: {
  jobId: string;
  providerId: string;
  clientId: string;
  files: JobFile[];
  onChange: (files: JobFile[]) => void;
  onBusy: (busy: boolean) => void;
  disabled: boolean;
}) {
  const [uploads, setUploads] = useState<Upload[]>([]),
    [error, setError] = useState("");
  const active = useRef(new Map<string, XMLHttpRequest>()),
    urls = useRef(new Set<string>()),
    live = useRef(true);
  const latestFiles = useRef(files);
  latestFiles.current = files;
  const uploadRef = useRef(uploads);
  uploadRef.current = uploads;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      active.current.forEach((r) => r.abort());
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);
  useEffect(
    () => onBusy(uploads.some((u) => u.busy || !!u.error)),
    [uploads, onBusy],
  );
  const update = (key: string, patch: Partial<Upload>) => {
    if (live.current)
      setUploads((list) =>
        list.map((item) => (item.key === key ? { ...item, ...patch } : item)),
      );
  };
  const send = (item: Upload) => {
    if (active.current.has(item.key)) return;
    update(item.key, { busy: true, error: "", progress: 0 });
    const xhr = new XMLHttpRequest();
    active.current.set(item.key, xhr);
    xhr.open(
      "POST",
      `/api/jobs/${jobId}/files?name=${encodeURIComponent(item.file.name)}&providerId=${providerId}&messageDraftId=${clientId}`,
    );
    xhr.withCredentials = true;
    xhr.timeout = 120000;
    xhr.setRequestHeader("Content-Type", item.file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        update(item.key, {
          progress: Math.min(99, Math.round((e.loaded / e.total) * 100)),
        });
    };
    const fail = (message: string) => {
      active.current.delete(item.key);
      update(item.key, { busy: false, error: message });
    };
    xhr.onerror = () => fail("Connection interrupted. Try again.");
    xhr.ontimeout = () => fail("Upload took too long. Try again.");
    xhr.onabort = () => {
      active.current.delete(item.key);
    };
    xhr.onload = () => {
      active.current.delete(item.key);
      let data: any;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status === 401)
        window.dispatchEvent(new Event("connect:session-expired"));
      if (xhr.status < 200 || xhr.status >= 300 || !data?.id) {
        fail(data?.error || "File could not be uploaded. Try again.");
        return;
      }
      if (!live.current) return;
      const saved: JobFile = {
        id: data.id,
        original_name: data.original_name || item.file.name,
        mime_type: data.mime_type || item.file.type,
        size_bytes: data.size_bytes || item.file.size,
      };
      const next = [...latestFiles.current, saved];
      latestFiles.current = next;
      onChange(next);
      setUploads((list) => list.filter((u) => u.key !== item.key));
      if (item.preview) {
        URL.revokeObjectURL(item.preview);
        urls.current.delete(item.preview);
      }
    };
    xhr.send(item.file);
  };
  const add = (selected: File[]) => {
    if (!selected.length) return;
    const issue =
      attachmentError(selected) ||
      (files.length + uploads.length + selected.length > 10
        ? "Attach up to 10 files to a message."
        : "");
    setError(issue);
    if (issue) return;
    const entries = selected.map((file) => {
      const preview = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : "";
      if (preview) urls.current.add(preview);
      return {
        key: crypto.randomUUID(),
        file,
        preview,
        progress: 0,
        error: "",
        busy: true,
      };
    });
    setUploads((list) => [...list, ...entries]);
    entries.forEach(send);
  };
  return (
    <div className="project-chat-uploads">
      <label
        className={`project-attach-button ${disabled ? "is-disabled" : ""}`}
        title="Attach photos or PDF files"
      >
        <Paperclip size={19} />
        <span>Add files</span>
        <input
          type="file"
          aria-label="Attach photos or PDF files"
          accept=".pdf,image/jpeg,image/png,image/webp"
          multiple
          disabled={disabled}
          onChange={(e) => {
            add(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
      </label>
      {!!(files.length || uploads.length) && (
        <div className="project-upload-list">
          {files.map((file) => (
            <div className="project-upload-item is-ready" key={file.id}>
              <JobAttachments files={[file]} />
              <button
                type="button"
                aria-label={`Remove ${file.original_name}`}
                className="project-upload-remove"
                disabled={disabled}
                onClick={() => onChange(files.filter((f) => f.id !== file.id))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {uploads.map((item) => (
            <div
              className={`project-upload-item ${item.error ? "has-error" : ""}`}
              key={item.key}
            >
              <div className="project-upload-preview">
                {item.preview ? (
                  <img src={item.preview} alt="" />
                ) : (
                  <FileText size={22} />
                )}
              </div>
              <div className="project-upload-copy">
                <strong>{item.file.name}</strong>
                <span>
                  {item.error ||
                    (item.progress === 99
                      ? "Processing…"
                      : `Uploading ${item.progress}%`)}
                </span>
                {item.busy && (
                  <progress
                    value={item.progress}
                    max={100}
                    aria-label={`Uploading ${item.file.name}`}
                  />
                )}
              </div>
              {item.error && (
                <button
                  type="button"
                  className="inbox-icon-button"
                  aria-label={`Retry ${item.file.name}`}
                  onClick={() => send(item)}
                >
                  <RefreshCw size={16} />
                </button>
              )}
              <button
                type="button"
                className="project-upload-remove"
                aria-label={`Remove ${item.file.name}`}
                onClick={() => {
                  active.current.get(item.key)?.abort();
                  setUploads((list) => list.filter((u) => u.key !== item.key));
                  if (item.preview) {
                    URL.revokeObjectURL(item.preview);
                    urls.current.delete(item.preview);
                  }
                }}
              >
                <X size={14} />
              </button>
              {item.busy && (
                <LoaderCircle className="inbox-spinner" size={14} />
              )}
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="inbox-send-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
