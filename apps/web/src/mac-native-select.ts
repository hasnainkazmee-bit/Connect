// This adapter leaves React's controlled selects and change handlers intact.
// Only the menu is native; no DOM control is moved outside React's ownership.
type MenuOption = { title: string; disabled: boolean };
type NativeHostWindow = Window & {
  __connectMacCapabilities?: { nativeSelect?: boolean };
  webkit?: {
    messageHandlers?: {
      connectMac?: { postMessage?: (value: unknown) => void };
    };
  };
};
const selector = ".discovery-selects select";

export function installMacNativeSelects(): () => void {
  const host = window as NativeHostWindow;
  if (host.__connectMacCapabilities?.nativeSelect !== true) return () => {};
  const bridge = host.webkit?.messageHandlers?.connectMac;
  if (typeof bridge?.postMessage !== "function") return () => {};
  const root = document.documentElement;
  root.classList.add("mac-native-selects");
  let pending: {
    id: string;
    select: HTMLSelectElement;
    href: string;
    selectedIndex: number;
    options: string;
    expanded: string | null;
  } | null = null;
  const optionsFor = (select: HTMLSelectElement): MenuOption[] =>
    Array.from(select.options).map((option) => ({
      title: option.label.slice(0, 240),
      disabled:
        option.disabled ||
        (option.parentElement instanceof HTMLOptGroupElement &&
          option.parentElement.disabled),
    }));
  const snapshot = (select: HTMLSelectElement) =>
    JSON.stringify(
      Array.from(select.options).map((option) => [
        option.value,
        option.label,
        option.disabled,
        option.parentElement instanceof HTMLOptGroupElement &&
          option.parentElement.disabled,
      ]),
    );
  const reset = () => {
    const current = pending;
    pending = null;
    if (current) {
      if (current.expanded === null)
        current.select.removeAttribute("aria-expanded");
      else current.select.setAttribute("aria-expanded", current.expanded);
    }
    return current;
  };
  const cancel = () => {
    const current = reset();
    if (current) {
      try {
        bridge.postMessage!({ type: "selectCancel", requestId: current.id });
      } catch {
        /* Menu already closed. */
      }
    }
  };
  const eligible = (target: EventTarget | null): target is HTMLSelectElement =>
    target instanceof HTMLSelectElement &&
    target.matches(selector) &&
    !target.disabled &&
    !target.multiple &&
    target.size <= 1;
  const open = (select: HTMLSelectElement) => {
    if (pending?.select === select) return true;
    const options = optionsFor(select);
    if (!options.length || options.length > 512) return false;
    const bounds = select.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    cancel();
    select.focus({ preventScroll: true });
    const request = {
      id: crypto.randomUUID(),
      select,
      href: location.href,
      selectedIndex: select.selectedIndex,
      options: snapshot(select),
      expanded: select.getAttribute("aria-expanded"),
    };
    pending = request;
    select.setAttribute("aria-expanded", "true");
    try {
      bridge.postMessage!({
        type: "select",
        requestId: request.id,
        label: (
          select.getAttribute("aria-label") ||
          select.labels?.[0]?.textContent ||
          "Choose a filter"
        ).slice(0, 160),
        selectedIndex: select.selectedIndex,
        options,
        anchor: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
        },
      });
      return true;
    } catch {
      reset();
      return false; // The regular WebKit select remains available if the host fails.
    }
  };
  let suppressPointerClick = false;
  const pointer = (event: PointerEvent) => {
    if (!event.isTrusted || event.button !== 0 || !eligible(event.target))
      return;
    suppressPointerClick = open(event.target);
    if (suppressPointerClick) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const click = (event: MouseEvent) => {
    if (!event.isTrusted || !eligible(event.target)) return;
    // Pointer activation was handled on pointerdown. detail=0 covers keyboard
    // and assistive-technology activation without opening a second menu on up.
    const handled =
      event.detail > 0 ? suppressPointerClick : open(event.target);
    suppressPointerClick = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const key = (event: KeyboardEvent) => {
    if (!event.isTrusted || !eligible(event.target)) return;
    if (
      [" ", "Enter", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    ) {
      if (open(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    } else if (event.key === "Escape" && pending) {
      cancel();
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const receive = (event: Event) => {
    const result: unknown = (event as CustomEvent).detail;
    if (
      !pending ||
      !result ||
      typeof result !== "object" ||
      !("requestId" in result) ||
      result.requestId !== pending.id
    )
      return;
    const current = reset()!;
    if (
      !current.select.isConnected ||
      current.href !== location.href ||
      current.select.disabled ||
      snapshot(current.select) !== current.options ||
      current.select.selectedIndex !== current.selectedIndex
    )
      return;
    const index = "selectedIndex" in result ? result.selectedIndex : null;
    const options = optionsFor(current.select);
    if (
      typeof index === "number" &&
      Number.isInteger(index) &&
      index >= 0 &&
      index < options.length &&
      !options[index].disabled
    ) {
      if (index !== current.selectedIndex) {
        current.select.selectedIndex = index;
        current.select.dispatchEvent(new Event("input", { bubbles: true }));
        current.select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    if (current.select.isConnected)
      current.select.focus({ preventScroll: true });
  };
  const observer = new MutationObserver(() => {
    if (
      pending &&
      (!pending.select.isConnected ||
        pending.href !== location.href ||
        pending.select.disabled ||
        snapshot(pending.select) !== pending.options ||
        pending.select.selectedIndex !== pending.selectedIndex)
    )
      cancel();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled"],
  });
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
  window.addEventListener("connect:mac-select-result", receive);
  window.addEventListener("resize", cancel);
  window.addEventListener("popstate", cancel);
  window.addEventListener("pagehide", cancel);
  return () => {
    cancel();
    observer.disconnect();
    root.classList.remove("mac-native-selects");
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("keydown", key, true);
    window.removeEventListener("connect:mac-select-result", receive);
    window.removeEventListener("resize", cancel);
    window.removeEventListener("popstate", cancel);
    window.removeEventListener("pagehide", cancel);
  };
}
