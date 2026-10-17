import { motion } from "motion/react";
import { useMemo } from "react";

// Same 16×16 mark as the app icon; '#' = ink, 'L' = lime.
const MARK = [
  "..LLLLLLLLLLLL..",
  ".LLLLLLLLLLLLLL.",
  "LLLLLLLLLLLLLLLL",
  "LLLLLLLLL#LLLLLL",
  "LLLLLLLLLL#LLLLL",
  "LLLLLLL#LLL#LLLL",
  "LLLLLLLL#LL#LLLL",
  "LLL##LLL#LL#LLLL",
  "LLL##LLL#LL#LLLL",
  "LLLLLLLL#LL#LLLL",
  "LLLLLLL#LLL#LLLL",
  "LLLLLLLLLL#LLLLL",
  "LLLLLLLLL#LLLLLL",
  "LLLLLLLLLLLLLLLL",
  ".LLLLLLLLLLLLLL.",
  "..LLLLLLLLLLLL..",
];

const CELL = 6;

/** The logo assembles from scattered pixels while the host reads the audio devices. */
export function BootSplash() {
  const pixels = useMemo(() => {
    const out: { x: number; y: number; c: string; fx: number; fy: number; d: number }[] = [];
    MARK.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === ".") return;
        const angle = Math.random() * Math.PI * 2;
        const r = 120 + Math.random() * 160;
        out.push({ x, y, c: ch === "#" ? "var(--riso-line)" : "var(--color-lime)", fx: Math.cos(angle) * r, fy: Math.sin(angle) * r, d: Math.random() * 0.35 });
      }),
    );
    return out;
  }, []);

  return (
    <div className="grid flex-1 place-items-center" role="status" aria-label="Loading Waypoint">
      <div className="flex flex-col items-center gap-7">
        <div className="relative" style={{ width: 16 * CELL, height: 16 * CELL }}>
          {pixels.map((p, i) => (
            <motion.span
              key={i}
              className="absolute"
              style={{ left: p.x * CELL, top: p.y * CELL, width: CELL, height: CELL, background: p.c }}
              initial={{ x: p.fx, y: p.fy, opacity: 0, scale: 0.4 }}
              animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 140, damping: 22, mass: 0.9, delay: p.d }}
            />
          ))}
        </div>
        <motion.p
          className="font-pixel text-[11px] text-fg-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          Reading your audio devices<span className="animate-blink">_</span>
        </motion.p>
      </div>
    </div>
  );
}
