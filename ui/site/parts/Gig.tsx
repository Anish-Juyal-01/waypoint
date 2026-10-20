import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef, useState } from "react";
import { ACTS, act, type ActId } from "./acts";
import { Stage, type OnStage } from "./Stage";

interface Beat {
  /** Acts on stage, left to right doesn't matter: each amp has its own spot. */
  on: OnStage[];
  lit: ActId;
  /** Acts that have left the building (struck through on the setlist). */
  gone?: ActId[];
  title: string;
  body: string;
}

const rank = (id: ActId) => ACTS.findIndex((a) => a.id === id) + 1;
const on = (id: ActId, extra: Partial<OnStage> = {}): OnStage => ({ id, rank: rank(id), ...extra });

/** The gig, one beat per screen of scrolling. */
const BEATS: Beat[] = [
  {
    on: [on("laptop")],
    lit: "laptop",
    title: "Doors open.",
    body: "Laptop speakers are the only act in the building, so they play. They're #4 on your list.",
  },
  {
    on: [on("laptop"), on("desk", { says: "check, check" })],
    lit: "desk",
    title: "Desk speakers plug in.",
    body: "They're #3 on your list and the laptop is #4, so the spotlight swings over.",
  },
  {
    on: [on("laptop"), on("desk"), on("monitor", { mood: "ignored", says: "not my slot" })],
    lit: "desk",
    title: "The monitor wakes up.",
    body: "Windows likes to jump to whatever just connected. The monitor is #5, so Waypoint leaves it in the wings.",
  },
  {
    on: [on("laptop"), on("desk"), on("monitor"), on("headphones", { says: "check, check" })],
    lit: "headphones",
    title: "Headphones on.",
    body: "#1 on the list. The headliner takes the stage, and every app set to Default follows it.",
  },
  {
    on: [on("laptop"), on("desk", { says: "we're back" }), on("monitor")],
    lit: "desk",
    gone: ["headphones"],
    title: "The battery dies.",
    body: "Waypoint drops to the next act that's actually here. Earbuds are #2 but not in the building, so the desk speakers play.",
  },
  {
    on: [on("laptop"), on("desk"), on("monitor")],
    lit: "desk",
    gone: ["headphones"],
    title: "That's the whole gig.",
    body: "Rank your devices once and Waypoint keeps it that way, checking that every switch really happened. Now run your own show.",
  },
];

/**
 * The hook: a pinned stage that plays a short gig as you scroll. Amps (devices) roll on, the spotlight only moves to
 * one that outranks whoever's playing, and when the headliner's battery dies it falls back down the setlist.
 */
/** One screen of scrolling per beat, plus one at the end where the stage falls through the floor. */
const UNITS = BEATS.length + 1;

export function Gig() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const [beat, setBeat] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const beats = useTransform(scrollYProgress, (p) => Math.min(1, (p * UNITS) / BEATS.length));
  const progress = useSpring(beats, { stiffness: 140, damping: 30 });

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const next = Math.min(BEATS.length - 1, Math.max(0, Math.floor(p * UNITS)));
    setBeat((b) => (b === next ? b : next));
  });

  // After the last beat the whole stage tips and falls (gravity: it speeds up), out of the bottom of the screen and
  // into the next section, where it lands.
  const drop = useTransform(scrollYProgress, (p) => (reduce ? 0 : Math.min(1, Math.max(0, p * UNITS - BEATS.length))));
  const fallY = useTransform(drop, (d) => `${d * d * 125}vh`);
  const fallRotate = useTransform(drop, (d) => d * d * 16 + Math.sin(d * 9) * 2 * d);
  const ghost = useTransform(drop, [0, 0.15], [0, 1]);
  // By the end of the fall it's below the screen; hide it there so it doesn't reappear over the next section, where
  // its twin lands.
  const fallOpacity = useTransform(drop, [0.82, 0.9], [1, 0]);
  const [falling, setFalling] = useState(false);
  useMotionValueEvent(drop, "change", (d) => setFalling(d > 0.02));

  // The curtains part as the venue slides up into place, before the first beat.
  const { scrollYProgress: entering } = useScroll({ target: ref, offset: ["start end", "start start"] });
  const curtain = useTransform(entering, [0.45, 1], [0, 1], { clamp: true });

  const b = BEATS[beat];
  return (
    <section ref={ref} className="relative z-[3] overflow-x-clip px-3 md:px-6" style={{ height: `${UNITS * 100 + 40}dvh` }} aria-label="How Waypoint picks what plays">
      <div className="sticky top-[76px] flex h-[calc(100dvh-88px)] items-stretch">
        <div className="venue-panel tint-blue mx-auto grid w-full max-w-[1320px] grid-cols-1 content-center items-center gap-5 p-4 md:p-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-10 lg:p-10">
          <div className="relative z-[1] order-2 min-h-[190px] lg:order-1 lg:min-h-[480px]">
            <AnimatePresence mode="wait" initial={false}>
              <Caption key={beat} beat={b} index={beat} />
            </AnimatePresence>
          </div>

          {/* Below the two-column layout the stage shares the pinned screen with the caption, so its width is capped
              by the screen height. */}
          <div className="relative z-[1] order-1 mx-auto w-full max-w-[max(260px,calc((100dvh-400px)*1.45))] lg:order-2 lg:max-w-none">
            <div className="relative">
              <motion.div aria-hidden className="stage-ghost" style={{ opacity: ghost }} />
              <motion.div className="pointer-events-none" style={{ y: fallY, rotate: fallRotate, opacity: fallOpacity, transformOrigin: "30% 100%" }}>
                <Stage acts={b.on} lit={b.lit} curtain={curtain} panic={falling ? "falling" : undefined} />
              </motion.div>
            </div>
            <div className="mt-3 flex items-center gap-3" aria-hidden>
              <div className="gig-rail">
                <motion.span style={{ scaleX: progress }} />
              </div>
              <span className="font-mono text-[11px] text-fg-3">Playing: {act(b.lit).name}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Caption({ beat, index }: { beat: Beat; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14, transition: { duration: 0.15 } }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-6 lg:min-h-[520px] lg:justify-center"
      aria-live="polite"
    >
      <div>
        <h2 className="headline text-[clamp(1.9rem,3.6vw,3rem)]">{beat.title}</h2>
        <p className="mt-3 max-w-[44ch] text-[clamp(0.98rem,1.3vw,1.1rem)] leading-relaxed text-fg-2">{beat.body}</p>
      </div>
      <Setlist beat={beat} last={index === BEATS.length - 1} />
    </motion.div>
  );
}

/** The running order taped to the stage floor: who's here, who's playing, who left. */
function Setlist({ beat, last }: { beat: Beat; last: boolean }) {
  const here = new Set(beat.on.map((o) => o.id));
  return (
    <ol className="setlist hidden lg:block" aria-label="Setlist">
      {ACTS.map((a, i) => {
        const gone = beat.gone?.includes(a.id);
        const lit = beat.lit === a.id;
        const status = lit ? "playing" : gone ? "left" : here.has(a.id) ? "waiting" : "not here";
        return (
          <li key={a.id} className="setlist-row" data-status={status}>
            <span className="set-num text-[26px]" data-live={lit}>
              {i + 1}
            </span>
            <span className="relative font-display text-[17px] font-bold">
              <span className={lit ? "hl" : undefined}>{a.name}</span>
              {gone && (
                <motion.span
                  className="setlist-strike"
                  initial={{ scaleX: last ? 1 : 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.45, delay: 0.25, ease: [0.65, 0, 0.35, 1] }}
                />
              )}
            </span>
            <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3">{status}</span>
          </li>
        );
      })}
    </ol>
  );
}
