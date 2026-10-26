import type { BrowserSurfaceRect } from "./browserSurfaceStore";

export const BROWSER_SURFACE_MOTION_MS = 200;

const MORPH_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const rectEquals = (left: BrowserSurfaceRect, right: BrowserSurfaceRect) =>
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

export function morphBrowserSurface(
  wrapper: HTMLElement,
  from: BrowserSurfaceRect,
  to: BrowserSurfaceRect,
) {
  if (prefersReducedMotion() || rectEquals(from, to)) return;
  wrapper.animate(
    [
      {
        transformOrigin: "top left",
        transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width}, ${from.height / to.height})`,
      },
      { transformOrigin: "top left", transform: "none" },
    ],
    { duration: BROWSER_SURFACE_MOTION_MS, easing: MORPH_EASING },
  );
}

export function fadeBrowserSurface(runtimeTabId: string, direction: "in" | "out") {
  if (prefersReducedMotion()) return;
  const wrapper = document.querySelector<HTMLElement>(
    `[data-preview-viewport="${CSS.escape(runtimeTabId)}"]`,
  );
  const entering = direction === "in";

  wrapper?.animate([{ opacity: entering ? 0 : 1 }, { opacity: entering ? 1 : 0 }], {
    duration: BROWSER_SURFACE_MOTION_MS,
    easing: "ease-out",
    fill: entering ? "backwards" : "forwards",
  });
}
