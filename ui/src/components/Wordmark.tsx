import { useEffect, useRef } from "react";
import { subscribeLevel } from "../store/store";

const LETTERS = "waypoint".split("");
/** Each letter sits at its own slight tilt, like hand-set type. */
const TILT = [-6, 4, -3, 6, -5, 3, -4, 7];

/**
 * The masthead wordmark. Letters drop in one by one on launch, alternate pink and ink, and keep up a little wave
 * whose height follows what's actually playing (louder = bouncier, silence = a gentle sway). Hover makes them
 * jump and swap colours.
 */
export function Wordmark() {
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
      smooth += (Math.sqrt(level) - smooth) * (level > smooth ? 0.3 : 0.05);
      const amp = Math.round((1.5 + smooth * 9) * 10) / 10;
      if (amp !== last) {
        el.style.setProperty("--amp", `${amp}px`);
        last = amp;
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
    <span ref={ref} className="wordmark" aria-label="Waypoint" role="img">
      {LETTERS.map((ch, i) => (
        <span key={i} aria-hidden className="wm-drop" style={{ "--i": i } as React.CSSProperties}>
          <span className="wm-letter" style={{ "--r": `${TILT[i]}deg`, "--i": i } as React.CSSProperties}>
            {ch}
          </span>
        </span>
      ))}
    </span>
  );
}
