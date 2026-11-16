// Only the initial document load is covered. Later route changes keep their
// existing local loading states and never bring the startup screen back.
declare global {
  interface Window {
    colabbStartup?: { start(): void; ready(): void; fail(): void };
  }
}
let pending = 0;
let committed = false;
let finished = false;
let frame = 0;
window.colabbStartup?.start();

function revealWhenReady() {
  cancelAnimationFrame(frame);
  if (finished || !committed || pending) return;
  // Let response state updates commit and paint before fading the cover away.
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (finished || !committed || pending) return;
      finished = true;
      window.colabbStartup?.ready();
      // Also recover if an intermediary stripped the nonce-bearing bootstrap.
      document.getElementById("root")?.removeAttribute("inert");
      document.getElementById("colabb-startup")?.classList.add("is-leaving");
      if (!window.colabbStartup) document.getElementById("colabb-startup")?.remove();
    });
  });
}

export function trackStartupRequest() {
  if (finished) return () => {};
  pending++;
  cancelAnimationFrame(frame);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pending--;
    revealWhenReady();
  };
}

export function commitStartupView() {
  committed = true;
  revealWhenReady();
}

export function StartupPlaceholder() {
  return (
    <main className="colabb-startup-placeholder" aria-label="Opening Colabb" aria-busy="true">
      <div className="colabb-startup-brand" aria-hidden="true">
        <svg className="colabb-startup-symbol" viewBox="10 29 80 42">
          <path className="colabb-startup-left" d="M10 29L10 71L46.37306695894642 50Z" />
          <path className="colabb-startup-right" d="M90 29L90 71L53.62693304105358 50Z" />
        </svg>
        <img src="/brand/marks/wordmark-ink.svg" alt="" width="234" height="52" />
      </div>
    </main>
  );
}
