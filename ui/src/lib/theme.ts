export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "waypoint.theme";
const media = () => window.matchMedia("(prefers-color-scheme: light)");

let current: ThemePref = "system";
let listening = false;
let userChangeAt = -Infinity; // no user pick yet: host updates always apply

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === "system") return media().matches ? "light" : "dark";
  return pref;
}

function setAttr(resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved;
}

/** Applies the cached preference synchronously at startup so the first paint is already correct. */
export function applyCachedTheme() {
  let pref: ThemePref = "system";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") pref = saved;
  } catch {
    // storage unavailable — fall back to system
  }
  current = pref;
  setAttr(resolveTheme(pref));
  watchSystem();
}

/**
 * Applies a theme preference. When the resolved theme actually changes it animates with a stepped circular
 * reveal starting at `origin` (the control that was clicked), using the View Transitions API when available.
 */
export function applyTheme(pref: ThemePref, origin?: { x: number; y: number }) {
  if (origin) userChangeAt = performance.now();
  current = pref;
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // ignore
  }

  const next = resolveTheme(pref);
  if (document.documentElement.dataset.theme === next) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (origin && !reduce && typeof doc.startViewTransition === "function") {
    document.documentElement.style.setProperty("--vt-x", `${origin.x}px`);
    document.documentElement.style.setProperty("--vt-y", `${origin.y}px`);
    doc.startViewTransition(() => setAttr(next));
  } else {
    setAttr(next);
  }
}

/**
 * Applies the preference reported by the host. Ignored briefly after the user picked a theme here, so a snapshot
 * that was already in flight can't flip it back before the host has processed the change.
 */
export function syncThemeFromHost(pref: ThemePref) {
  if (pref !== current && performance.now() - userChangeAt < 2000) return;
  applyTheme(pref);
}

function watchSystem() {
  if (listening) return;
  listening = true;
  media().addEventListener("change", () => {
    if (current === "system") applyTheme("system", { x: window.innerWidth / 2, y: 0 });
  });
}
