import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { Critter } from "../../src/pals/Critter";
import { act, type ActId } from "./acts";

/** Where the lamp hangs and where the amps stand, as fractions of the stage height. */
const LAMP_Y = 0.05;
const FLOOR_Y = 0.79;

export type AmpMood = "idle" | "lit" | "ignored";

export interface OnStage {
  id: ActId;
  rank: number;
  mood?: AmpMood;
  /** A speech bubble over the pal ("check, check"). */
  says?: string;
}

/**
 * A small risograph stage: amps (devices) with a pal on each, and one spotlight that swings to whichever amp is
 * playing. Amps roll in from the nearest wing when they appear and topple off when they're unplugged.
 */
export function Stage({ acts, lit, compact, className }: { acts: OnStage[]; lit: ActId | null; compact?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(1.6);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => el.clientHeight > 0 && setRatio(el.clientWidth / el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Swing the beam from the lamp (top centre) to the lit amp; the beam's length follows the angle so it always ends
  // on the floor.
  const target = lit ? act(lit).x : 50;
  const dy = (FLOOR_Y - LAMP_Y) / ratio; // in stage widths
  const dx = (target - 50) / 100;
  const angle = Math.atan2(dx, dy);
  const length = ((FLOOR_Y - LAMP_Y) * 100) / Math.cos(angle);

  return (
    <div ref={ref} className={`stage ${compact ? "stage-compact" : ""} ${className ?? ""}`} role="img" aria-label={stageLabel(acts, lit)}>
      <div className="stage-wall" aria-hidden />
      <div className="stage-truss" aria-hidden />

      <motion.div
        aria-hidden
        className="stage-beam"
        initial={false}
        animate={{ rotate: (-angle * 180) / Math.PI, height: `${length}%`, opacity: lit ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 70, damping: 14, mass: 1.1 }}
        style={{ top: `${LAMP_Y * 100}%` }}
      />
      {/* The floor sits over the beam, so the light ends where it lands; the pool of light sits on the floor. */}
      <div className="stage-floor" aria-hidden />
      <motion.div
        aria-hidden
        className="stage-pool"
        initial={false}
        animate={{ left: `${target}%`, opacity: lit ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 70, damping: 14, mass: 1.1 }}
      />
      <div className="stage-lamp" aria-hidden style={{ top: `${LAMP_Y * 100}%` }} />

      <AnimatePresence initial={false}>
        {acts.map((a) => (
          <AmpSlot key={a.id} {...a} lit={lit === a.id} compact={compact} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function stageLabel(acts: OnStage[], lit: ActId | null) {
  if (acts.length === 0) return "An empty stage.";
  const names = acts.map((a) => act(a.id).name).join(", ");
  return lit ? `On stage: ${names}. Playing: ${act(lit).name}.` : `On stage: ${names}. Nothing is playing.`;
}

function AmpSlot({ id, rank, mood, says, lit, compact }: OnStage & { lit: boolean; compact?: boolean }) {
  const a = act(id);
  const fromLeft = a.x < 50;
  const state: AmpMood = lit ? "lit" : (mood ?? "idle");
  const clip = state === "lit" ? "cheer" : state === "ignored" ? "worried" : "idle";

  return (
    <motion.div
      className="amp-slot"
      style={{ left: `${a.x}%`, bottom: `${(1 - FLOOR_Y) * 100 - 4}%` }}
      initial={{ x: fromLeft ? "-60vw" : "60vw", rotate: fromLeft ? -8 : 8 }}
      animate={{ x: 0, rotate: 0 }}
      exit={{ y: 40, rotate: fromLeft ? -24 : 24, opacity: 0, transition: { duration: 0.5, ease: [0.5, 0, 0.75, 0] } }}
      transition={{ type: "spring", stiffness: 120, damping: 17 }}
    >
      <div className="amp" data-state={state} style={{ "--amp-ink": `var(--color-${a.ink})` } as React.CSSProperties}>
        <AnimatePresence>
          {says && (
            <motion.span
              key={says}
              className="amp-bubble"
              initial={{ opacity: 0, y: 8, scale: 0.7, rotate: -6 }}
              animate={{ opacity: 1, y: 0, scale: 1, rotate: -3 }}
              exit={{ opacity: 0, y: -6, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 380, damping: 20, delay: 0.35 }}
            >
              {says}
            </motion.span>
          )}
        </AnimatePresence>
        <div className="amp-pal">
          <Critter name={a.pal} clip={clip} scale={compact ? 3 : 4} />
        </div>
        <div className="amp-box">
          <span className="amp-rank">{rank}</span>
          <span className="amp-grille" />
          {lit && (
            <span className="amp-eq" aria-hidden>
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          )}
          <span className="amp-tape">{a.tape}</span>
        </div>
      </div>
    </motion.div>
  );
}
