import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { ArrowUpRight, Globe, MessageSquare, Newspaper, X } from "lucide-react";
import { useApp } from "./context";
import { Logo } from "./identity";
import type { PublicationKind } from "./publication-content";
import "./publishing.css";
export {
  formats,
  RichDocument,
  publicationLabel,
  type PublicationKind,
} from "./publication-content";
type Module = typeof import("./publishing");
let loaded: Module | null = null;
let pending: Promise<Module> | null = null;
export function preloadPublisher() {
  return (pending ||= import("./publishing")
    .then((value) => (loaded = value))
    .catch((error) => {
      pending = null;
      throw error;
    }));
}
const LazyDrafts = lazy(() =>
  preloadPublisher().then((m) => ({ default: m.DraftsDialog })),
);
const loading = (
  <div className="manage-loading" role="status">
    Opening your drafts…
  </div>
);
export function Publisher(props: ComponentProps<Module["Publisher"]>) {
  const { company, close } = useApp();
  const [module, setModule] = useState<Module | null>(loaded);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<PublicationKind>(
    props.initialKind || "post",
  );
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [composing, setComposing] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const live = useRef({ text, module, composing });
  live.current = { text, module, composing };
  useEffect(() => {
    let cancelled = false;
    void preloadPublisher()
      .then((value) => {
        if (!cancelled) setModule(value);
      })
      .catch(() => {
        if (!cancelled)
          setError("The writing tools couldn’t load. Your text is still here.");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const active = !!module && !composing;
  useEffect(() => {
    if (active || props.publicationId) return;
    textarea.current?.focus();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (live.current.text.trim()) event.preventDefault();
    };
    const beforeClose = (event: Event) => {
      if (
        live.current.text.trim() &&
        !window.confirm("Discard this unsaved post?")
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("connect:modal-close", beforeClose);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("connect:modal-close", beforeClose);
    };
  }, [active, props.publicationId]);
  if (active) {
    const Ready = module.Publisher;
    return <Ready {...props} initialKind={kind} initialText={text} />;
  }
  const requestClose = () => {
    const event = new CustomEvent("connect:modal-close", {
      cancelable: true,
      detail: { close },
    });
    if (window.dispatchEvent(event)) close();
  };
  return (
    <div
      className="publisher publisher-onebox publisher-starting"
      data-publication-kind={kind}
    >
      <header className="publisher-top">
        <button
          className="icon-button publisher-close"
          aria-label="Close dialog"
          onClick={requestClose}
        >
          <X size={20} />
        </button>
        <h2>{props.publicationId ? "Edit publication" : "Create a post"}</h2>
        <button className="button primary publish-button" disabled>
          Publish <ArrowUpRight size={17} />
        </button>
      </header>
      {company && (
        <div className="publisher-identity">
          <Logo company={company} />
          <div>
            <strong>{company.name}</strong>
            <span>
              <Globe size={12} />
              Public
            </span>
          </div>
        </div>
      )}
      {!props.publicationId && (
        <>
          <div
            className="publisher-formats"
            role="group"
            aria-label="Publication format"
          >
            <button
              aria-pressed={kind === "post"}
              onClick={() => setKind("post")}
            >
              <MessageSquare size={17} />
              Post
            </button>
            <button
              aria-pressed={kind !== "post"}
              onClick={() => setKind("press_release")}
            >
              <Newspaper size={17} />
              Press release
            </button>
          </div>
          <div className="publisher-canvas">
            <textarea
              ref={textarea}
              className="publisher-instant-input"
              aria-label="Update content"
              placeholder="What’s happening at your company?"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
            />
          </div>
        </>
      )}
      <footer className="publisher-bottom">
        <span role={error ? "alert" : "status"}>
          {error ||
            (props.publicationId
              ? "Opening your publication…"
              : "You can start writing. Tools are loading…")}
        </span>
        {error && (
          <button
            className="button secondary"
            onClick={() => {
              setError("");
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
        )}
      </footer>
    </div>
  );
}
export function DraftsDialog() {
  return (
    <Suspense fallback={loading}>
      <LazyDrafts />
    </Suspense>
  );
}
