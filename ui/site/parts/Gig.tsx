import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import { useRef, useState } from "react";
import { CodeXml, Download } from "lucide-react";
import { ACTS, DOWNLOAD, REPO, act, type ActId } from "./acts";
import { Stage, type OnStage } from "./Stage";

interface Beat {
  /** Acts on stage, left to right doesn't matter: each amp has its own spot. */
  on: OnStage[];
  lit: ActId;
  /** Acts that have left the building (struck through on the setlist). */
  gone?: ActId[];
  title?: string;
  body?: string;
}

const rank = (id: ActId) => ACTS.findIndex((a) => a.id === id) + 1;
const on = (id: ActId, extra: Partial<OnStage> = {}): OnStage => ({ id, rank: rank(id), ...extra });

/** The gig, one beat per screen of scrolling. Beat 0 is the hero. */
const BEATS: Beat[] = [
  { on: [on("laptop")], lit: "laptop" },
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
    body: "Rank your devices once. Waypoint checks that every switch really happened, and tells you when one didn't.",
  },
];

/**
 * The hook: a pinned stage that plays a short gig as you scroll. Amps (devices) roll on, the spotlight only moves to
 * one that outranks whoever's playing, and when the headliner's battery dies it falls back down the setlist.
 */
export function Gig() {
  const ref = useRef<HTMLElement>(null);
  const [beat, setBeat] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const next = Math.min(BEATS.length - 1, Math.max(0, Math.floor(p * BEATS.length)));
    setBeat((b) => (b === next ? b : next));
  });

  const b = BEATS[beat];
  return (
    <section ref={ref} className="relative" style={{ height: `${BEATS.length * 100 + 40}dvh` }} aria-label="How Waypoint picks what plays">
      <div className="sticky top-0 flex min-h-[100dvh] items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 items-center gap-6 px-4 pt-[76px] pb-6 md:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
          <div className="order-2 min-h-[220px] lg:order-1 lg:min-h-[520px]">
            <AnimatePresence mode="wait" initial={false}>
              {beat === 0 ? <Hero key="hero" /> : <Caption key={beat} beat={b} index={beat} />}
            </AnimatePresence>
          </div>

          {/* Below the two-column layout the stage shares the pinned screen with the caption, so its width is capped
              by the screen height. */}
          <div className="order-1 mx-auto w-full max-w-[max(280px,calc((100dvh-380px)*1.5))] lg:order-2 lg:max-w-none">
            <Stage acts={b.on} lit={b.lit} />
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

function Hero() {
  return (
    <motion.div exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.2 }} className="flex flex-col justify-center lg:min-h-[520px]">
      <h1 className="headline text-[clamp(2.5rem,6vw,4.75rem)]">Only the headliner plays.</h1>
      <p className="mt-5 max-w-[42ch] text-[clamp(1rem,1.4vw,1.15rem)] leading-relaxed text-fg-2">
        Waypoint ranks your headphones, earbuds and speakers. Windows always plays on the best one that's connected.
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <a href={DOWNLOAD} className="btn-ink">
          <Download size={17} strokeWidth={2.4} />
          Download for Windows
        </a>
        <a href={REPO} className="btn-ghost">
          <CodeXml size={17} strokeWidth={2.2} />
          View the code
        </a>
      </div>
    </motion.div>
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
