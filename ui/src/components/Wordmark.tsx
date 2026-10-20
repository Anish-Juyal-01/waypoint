import { useEffect, useRef } from "react";
import { subscribeLevel } from "../store/store";

const LETTERS = "waypoint".split("");

/**
 * The masthead wordmark: plum letters with a pink offset shadow on a sunflower badge (the same one as the website).
 * Letters drop in one by one on launch and each sways on its own beat; the badge gives a little kick that follows
 * what's actually playing (louder = bigger kick, silence = still).
 */
export function Wordmark({ size = 22 }: { size?: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let level = 0;
    let smooth = 0;
    let raf = 0;
    let last = -1;
    const unsubscribe = subscribeLevel("output", (v) => (level = v));
    const tick = () => {
      smooth += (Math.sqrt(level) - smooth) * (level > smooth ? 0.35 : 0.06);
      const kick = Math.round(smooth * 100) / 100;
      if (kick !== last) {
        el.style.setProperty("--kick", String(kick));
        last = kick;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, []);

  return (
    <span ref={ref} className="wordmark-m is-live" style={{ fontSize: size }} aria-label="Waypoint" role="img">
      {LETTERS.map((ch, i) => (
        <span key={i} aria-hidden className="wmm-drop" style={{ "--i": i } as React.CSSProperties}>
          <span className="wmm-letter">{ch}</span>
        </span>
      ))}
    </span>
  );
}
