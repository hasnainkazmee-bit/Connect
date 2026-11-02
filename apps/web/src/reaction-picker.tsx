import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, RefreshCw, X } from "lucide-react";

type EmojiSelection = { native: string; name: string };

export function ReactionPicker({
  anchor,
  companyName,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement;
  companyName: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pickerHost = useRef<HTMLDivElement>(null);
  const [picker, setPicker] = useState<{
    Picker: new (options: Record<string, unknown>) => HTMLElement;
    data: unknown;
  } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    // The complete catalog and picker are kept out of the initial feed bundle.
    void Promise.all([import("emoji-mart"), import("@emoji-mart/data")])
      .then(([component, catalog]) => {
        if (!cancelled)
          setPicker({
            // Emoji Mart registers Picker as an HTMLElement at runtime;
            // its published declaration inherits from an untyped base class.
            Picker: component.Picker as unknown as new (
              options: Record<string, unknown>,
            ) => HTMLElement,
            data: catalog.default,
          });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const latest = useRef({ onSelect, onClose });
  latest.current = { onSelect, onClose };
  useEffect(() => {
    if (!picker || !pickerHost.current) return;
    const element = new picker.Picker({
      data: picker.data,
      onEmojiSelect: (selection: EmojiSelection) => {
        latest.current.onSelect(selection.native);
        latest.current.onClose();
      },
      autoFocus: true,
      dynamicWidth: true,
      theme: "light",
      set: "native",
      emojiButtonSize: 44,
      emojiSize: 24,
      previewPosition: "none",
      skinTonePosition: "search",
      navPosition: "bottom",
      maxFrequentRows: 2,
    });
    pickerHost.current.appendChild(element);
    return () => element.remove();
  }, [picker]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(368, window.innerWidth - 24);
      const height = Math.min(500, window.innerHeight - 32);
      element.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      element.style.top = `${Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - height - 16))}px`;
    };
    position();
    element.showModal();
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("resize", position);
      element.close();
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  return createPortal(
    <dialog
      ref={dialog}
      className="reaction-picker-dialog"
      aria-label="Choose a reaction"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="reaction-picker-content">
        <header>
          <div>
            <h2>Choose a reaction</h2>
            <p>As {companyName}</p>
          </div>
          <button
            className="icon-button"
            aria-label="Close emoji picker"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div ref={pickerHost} className="reaction-picker-host" />
        {!picker &&
          (error ? (
            <div className="reaction-picker-loading" role="alert">
              <p>Couldn’t load emoji. Try again.</p>
              <button
                className="button"
                onClick={() => setAttempt((n) => n + 1)}
              >
                <RefreshCw size={16} /> Try again
              </button>
            </div>
          ) : (
            <div className="reaction-picker-loading" role="status">
              <LoaderCircle className="spin" size={22} /> Loading emoji…
            </div>
          ))}
      </div>
    </dialog>,
    document.body,
  );
}
