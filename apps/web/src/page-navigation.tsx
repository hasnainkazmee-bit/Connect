import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useBlocker,
  useLocation,
  useNavigate,
  type Location,
} from "react-router-dom";
import { ArrowLeft, CircleAlert } from "lucide-react";

type Guard = { dirty: boolean; busy: boolean };
const PageScopeContext = createContext<string | null>(null);
export const PageScopeProvider = PageScopeContext.Provider;
const PageGuardContext = createContext<
  (key: string, guard: Guard | null) => void
>(() => {});
export const PageGuardProvider = PageGuardContext.Provider;
export function usePageGuard(dirty: boolean, busy = false) {
  const register = useContext(PageGuardContext);
  const location = useLocation();
  const scope = useContext(PageScopeContext) || location.pathname;
  useEffect(() => {
    register(scope, { dirty, busy });
    return () => register(scope, null);
  }, [register, scope, dirty, busy]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
}

type Page = { id: string; content: ReactNode; background: Location };
export function usePageNavigation() {
  const location = useLocation(),
    navigate = useNavigate();
  const [pages, setPages] = useState<Page[]>([]);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const guards = useRef(new Map<string, Guard>());
  const bypass = useRef(false);
  const register = useCallback((key: string, guard: Guard | null) => {
    if (guard) guards.current.set(key, guard);
    else guards.current.delete(key);
  }, []);
  const active = pages.find((p) => location.pathname === "/actions/" + p.id);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (bypass.current || currentLocation.key === nextLocation.key)
      return false;
    const guard = guards.current.get(currentLocation.pathname);
    return !!(guard?.dirty || guard?.busy);
  });
  useEffect(() => {
    bypass.current = false;
  }, [location.key]);
  useEffect(() => {
    if (!location.pathname.startsWith("/actions/"))
      setPages((p) => (p.length ? [] : p));
    else
      setPages((p) => {
        const index = p.findIndex(
          (page) => location.pathname === "/actions/" + page.id,
        );
        return index >= 0 && index < p.length - 1 ? p.slice(0, index + 1) : p;
      });
  }, [location.pathname]);
  const open = (content: ReactNode) => {
    const id = crypto.randomUUID();
    setPages((p) => [
      ...p,
      { id, content, background: active?.background || location },
    ]);
    // The source page stays mounted with its draft intact.
    bypass.current = true;
    navigate("/actions/" + id, {
      state: { returnTo: location.pathname + location.search + location.hash },
    });
  };
  const close = (saved: unknown = false) => {
    if (!active) return;
    if (saved === true) bypass.current = true;
    navigate(-1);
  };
  const requestLeave = (action: () => void) => {
    const guard = guards.current.get(location.pathname);
    if (guard?.dirty || guard?.busy) setPendingLeave(() => action);
    else action();
  };
  const keep = () => {
    setPendingLeave(null);
    blocker.reset?.();
  };
  const discard = () => {
    if (pendingLeave) {
      bypass.current = true;
      setPendingLeave(null);
      pendingLeave();
    } else blocker.proceed?.();
  };
  return {
    pendingLeave,
    requestLeave,
    keep,
    discard,
    active,
    pages,
    open,
    close,
    register,
    blocker,
    guard: guards.current.get(location.pathname),
  };
}

export function FullPage({
  children,
  back,
  backLabel = "Back",
}: {
  children: ReactNode;
  back: () => void;
  backLabel?: string;
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const heading = root.current?.querySelector<HTMLElement>("h1,h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  return (
    <section className="full-page-flow" ref={root}>
      <button className="page-back" type="button" onClick={back}>
        <ArrowLeft size={18} />
        {backLabel}
      </button>
      <div className="full-page-content">{children}</div>
    </section>
  );
}
export function LeavePage({
  busy,
  keep,
  discard,
}: {
  busy: boolean;
  keep: () => void;
  discard: () => void;
}) {
  return (
    <FullPage back={keep} backLabel="Back to editing">
      <section className="leave-page">
        <CircleAlert size={32} />
        <h1>
          {busy ? "Your changes are being saved." : "You have unsaved changes."}
        </h1>
        <p>
          {busy
            ? "Please wait for saving to finish before leaving this page."
            : "Keep editing to save your changes, or leave without saving."}
        </p>
        <div className="page-actions">
          <button className="button primary" onClick={keep} autoFocus>
            Keep editing
          </button>
          {!busy && (
            <button className="button" onClick={discard}>
              Leave without saving
            </button>
          )}
        </div>
      </section>
    </FullPage>
  );
}
