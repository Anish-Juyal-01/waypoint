import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { subscribeLevel } from "../store/store";
import { Critter } from "./Critter";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ── Mikey: sings along to your microphone ── */

/** Hero creature for the Microphones page: sings while the mic picks up sound, looks around when quiet, hushes when muted. */
export function MicChoir({ muted, absent, scale = 8 }: { muted?: boolean; absent?: boolean; scale?: number }) {
  const [clip, setClip] = useState<"sing" | "look" | "hush">("look");

  useEffect(() => {
    if (muted || absent) {
      setClip("hush");
      return;
    }
    let level = 0;
    let lastLoud = 0;
    let current = "";
    const unsubscribe = subscribeLevel("input", (v) => (level = v));
    const id = window.setInterval(() => {
      const now = performance.now();
      if (level > 0.035) lastLoud = now;
      const next = now - lastLoud < 450 ? "sing" : "look";
      if (next !== current) {
        current = next;
        setClip(next);
      }
    }, 80);
    return () => {
      window.clearInterval(id);
      unsubscribe();
    };
  }, [muted, absent]);

  return (
    <div className="relative">
      <Critter name="mikey" clip={clip} scale={scale} />
      <AnimatePresence>
        {clip === "sing" && !reduced() && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute -top-2 -right-6">
            {[0, 1].map((i) => (
              <motion.span
                key={i}
                className="font-pixel absolute text-tx-sky"
                style={{ fontSize: 18 + i * 4 }}
                initial={{ opacity: 0, y: 0, x: i * 10 }}
                animate={{ opacity: [0, 1, 0], y: -26, x: i * 10 + 8 }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.7, ease: "linear" }}
              >
                ♪
              </motion.span>
            ))}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
