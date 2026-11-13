import { useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import "./chat-emoji-picker.css";

/** A transient writing tool. Closing it never changes the message draft. */
export function ChatEmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onSelect, onClose });
  callbacks.current = { onSelect, onClose };
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let picker: HTMLElement | undefined;
    setState("loading");
    void Promise.all([import("emoji-mart"), import("@emoji-mart/data")])
      .then(([module, catalog]) => {
        if (cancelled || !host.current) return;
        const Picker = module.Picker as unknown as new (
          options: Record<string, unknown>,
        ) => HTMLElement;
        picker = new Picker({
          data: catalog.default,
          onEmojiSelect: ({ native }: { native: string }) =>
            callbacks.current.onSelect(native),
          autoFocus: true,
          dynamicWidth: true,
          theme: "light",
          set: "native",
          emojiButtonSize: 36,
          emojiSize: 22,
          previewPosition: "none",
          maxFrequentRows: 1,
        });
        host.current.appendChild(picker);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
      picker?.remove();
    };
  }, [retry]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        !container.current?.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest(".inbox-emoji-button")
      )
        callbacks.current.onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        callbacks.current.onClose();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <div
      ref={container}
      className="chat-emoji-picker"
      role="region"
      aria-label="Choose an emoji"
    >
      <header>
        <strong>Add an emoji</strong>
        <button type="button" aria-label="Close emoji picker" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div ref={host} />
      {state === "loading" && (
        <p role="status">
          <LoaderCircle size={18} className="inbox-spinner" /> Loading emoji…
        </p>
      )}
      {state === "error" && (
        <p role="alert">
          Couldn’t load emoji.{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
