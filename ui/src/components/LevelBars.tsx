import clsx from "clsx";
import { useEffect, useRef } from "react";
import type { Flow } from "../bridge/protocol";
import { subscribeLevel } from "../store/store";

const SAMPLE_MS = 55;

/**
 * A scrolling bar graph of the real peak level for one flow (speakers or microphone): the newest sample enters on
 * the right and older ones slide left and fade. Heights come straight from the host's peak meter, so the bars only
 * move when sound is actually playing or being picked up. Written to the DOM directly (no re-render per frame).
 */
export function LevelBars({ flow, active, bars = 40, className }: { flow: Flow; active: boolean; bars?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cells = [...el.children] as HTMLElement[];
    const history: number[] = new Array(bars).fill(0);
    const paint = () => {
      for (let i = 0; i < cells.length; i++) cells[i].style.transform = `scaleY(${Math.max(0.06, history[i]).toFixed(3)})`;
    };
    if (!active) {
      paint();
      return;
    }

    // Keep the loudest level seen since the last sample so short peaks aren't missed between samples.
    let peak = 0;
    const unsubscribe = subscribeLevel(flow, (v) => {
      if (v > peak) peak = v;
    });
    const id = window.setInterval(() => {
      history.shift();
      history.push(Math.min(1, Math.sqrt(peak) * 1.15));
      peak = 0;
      paint();
    }, SAMPLE_MS);
    return () => {
      window.clearInterval(id);
      unsubscribe();
    };
  }, [flow, active, bars]);

  return (
    <div ref={ref} aria-hidden className={clsx("level-bars", !active && "is-idle", flow === "input" && "is-input", className)}>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} style={{ opacity: 0.25 + (0.75 * (i + 1)) / bars }} />
      ))}
    </div>
  );
}
