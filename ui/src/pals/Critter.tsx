import { motion, useAnimationControls } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sprite } from "../components/Pixel";
import { CRITTERS, type CritterName } from "./data";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Creatures drawn mostly in ink, which need an outline on dark surfaces. */
const INK_CRITTERS = new Set<string>([]);

/**
 * Plays one clip of a cast creature at its own frame rate, with random blinks for creatures that have a
 * blink frame. With reduced motion it holds the first frame.
 */
export function Critter({
  name,
  clip,
  scale = 3,
  flip,
  blink = true,
  className,
  title,
}: {
  name: CritterName;
  clip?: string;
  scale?: number;
  flip?: boolean;
  blink?: boolean;
  className?: string;
  title?: string;
}) {
  const spec = CRITTERS[name];
  const frames = spec.frames as Record<string, readonly (readonly string[])[]>;
  const clipName = clip && frames[clip] ? clip : Object.keys(frames)[0];
  const list = frames[clipName];
  const fps = (spec.fps as Record<string, number>)[clipName] ?? 6;
  const [index, setIndex] = useState(0);
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    setIndex(0);
    if (list.length < 2 || reduced()) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % list.length), 1000 / fps);
    return () => window.clearInterval(id);
  }, [name, clipName, list.length, fps]);

  useEffect(() => {
    if (!blink || !frames.blink || reduced()) return;
    let t = 0;
    const schedule = () => {
      t = window.setTimeout(() => {
        setBlinking(true);
        window.setTimeout(() => setBlinking(false), 140);
        schedule();
      }, 2400 + Math.random() * 3800);
    };
    schedule();
    return () => window.clearTimeout(t);
  }, [blink, frames.blink, name]);

  const frame = blinking && frames.blink && clipName === Object.keys(frames)[0] ? frames.blink[0] : list[index % list.length];
  return (
    <span className={`inline-block leading-none ${INK_CRITTERS.has(name) ? "critter-ink " : ""}${className ?? ""}`} style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <Sprite map={frame as string[]} palette={spec.palette} scale={scale} title={title} />
    </span>
  );
}

/** Integer pixel scale that fits a creature inside a `box`×`box` square. */
export function fitScale(name: CritterName, box: number) {
  const s = CRITTERS[name];
  return Math.max(1, Math.floor(Math.min(box / s.w, box / s.h)));
}

/* ── Profile pals ─────────────────────────────────────── */

type Moods = { idle: string; sleep: string; cheer: string };

/** Every cast member has the same pose set, so each pal maps idle / asleep (inactive) / cheer (just switched to). */
const MOODS: Moods = { idle: "idle", sleep: "sleep", cheer: "cheer" };

export const PICKABLE = Object.keys(CRITTERS) as CritterName[];

/** Default pal for a profile without an explicit choice: deterministic by position. */
export function defaultPal(index: number): CritterName {
  const order: CritterName[] = ["sprout", "fox", "owlet", "chick", "slime", "bun", "puff", "radish", "shroom", "jelly", "beepo", "mikey"];
  return order[((index % order.length) + order.length) % order.length];
}

export function isCritter(name: string | null | undefined): name is CritterName {
  return !!name && name in CRITTERS;
}

/**
 * A profile's pal: awake and animating when its profile is active, dozing otherwise. When it becomes active it
 * plays its "cheer" clip with a little hop.
 */
export function ProfilePal({ name, active, box = 44, className }: { name: CritterName; active: boolean; box?: number; className?: string }) {
  const moods = MOODS;
  const [cheering, setCheering] = useState(false);
  const controls = useAnimationControls();
  const wasActive = useRef(active);
  const scale = useMemo(() => fitScale(name, box), [name, box]);

  useEffect(() => {
    if (active && !wasActive.current && !reduced()) {
      setCheering(true);
      controls.start({ y: [0, -10, 0, -3, 0], transition: { duration: 0.6, ease: "easeOut" } });
      const t = window.setTimeout(() => setCheering(false), 1300);
      wasActive.current = active;
      return () => window.clearTimeout(t);
    }
    wasActive.current = active;
  }, [active, controls]);

  const clip = cheering ? moods.cheer : active ? moods.idle : moods.sleep;
  return (
    <motion.span animate={controls} className={`inline-grid place-items-end ${className ?? ""}`} style={{ width: box, height: box }}>
      <span style={{ filter: active ? undefined : "saturate(0.55)", opacity: active ? 1 : 0.8 }}>
        <Critter name={name} clip={clip} scale={scale} blink={active} />
      </span>
    </motion.span>
  );
}
