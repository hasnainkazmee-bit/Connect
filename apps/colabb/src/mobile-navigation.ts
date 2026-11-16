import { useRef, type TouchEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function useMobileNavigation(
  individual: boolean,
  signedIn: boolean,
  modalOpen: boolean,
  signIn: () => void,
) {
  const location = useLocation(),
    navigate = useNavigate();
  const start = useRef<{ x: number; y: number; time: number } | null>(null);
  const routes = individual
    ? ["/", "/directory", "/messages"]
    : ["/", "/directory", "/network/connections", "/messages"];
  const index = routes.indexOf(location.pathname);
  return {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      start.current = null;
      if (
        modalOpen ||
        index < 0 ||
        !matchMedia("(max-width: 720px)").matches ||
        event.touches.length !== 1 ||
        window.getSelection()?.toString()
      )
        return;
      const touch = event.touches[0];
      if (touch.clientX < 28 || touch.clientX > innerWidth - 28) return;
      let target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input,textarea,select,button,a,video,[contenteditable=true],[role=slider]",
        )
      )
        return;
      while (target && target !== event.currentTarget) {
        if (
          target.scrollWidth > target.clientWidth + 5 &&
          /auto|scroll/.test(getComputedStyle(target).overflowX)
        )
          return;
        target = target.parentElement;
      }
      start.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: performance.now(),
      };
    },
    onTouchEnd(event: TouchEvent<HTMLElement>) {
      const from = start.current;
      start.current = null;
      if (!from || event.changedTouches.length !== 1) return;
      const touch = event.changedTouches[0],
        dx = touch.clientX - from.x,
        dy = touch.clientY - from.y;
      if (
        Math.abs(dx) < 90 ||
        Math.abs(dy) > Math.abs(dx) * 0.45 ||
        performance.now() - from.time > 700
      )
        return;
      const route = routes[index + (dx < 0 ? 1 : -1)];
      if (!route) return;
      if (!signedIn && (route.startsWith("/network") || route === "/messages"))
        signIn();
      else navigate(route);
    },
    onTouchCancel() {
      start.current = null;
    },
  };
}
