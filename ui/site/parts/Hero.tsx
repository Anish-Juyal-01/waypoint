import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Ear, Headphones, Monitor, Plug, Speaker, Unplug } from "lucide-react";
import { Critter } from "../../src/pals/Critter";

const BOARD = "WAYPOINT".split("");

/** The hero's own tiny setlist, best first. */
const DEVICES = [
  { id: "headphones", name: "Headphones", icon: Headphones },
  { id: "earbuds", name: "Earbuds", icon: Ear },
  { id: "speakers", name: "Speakers", icon: Speaker },
  { id: "monitor", name: "Monitor", icon: Monitor },
] as const;
type DeviceId = (typeof DEVICES)[number]["id"];

/**
 * The venue front: on the left a tiny working Waypoint (plug devices in and out; the best one plays), and on the
 * right a marquee sign that announces what's playing, over closed curtains with pals peeking through. The show
 * itself starts one screen further down, where the whole front falls onto the stage.
 */
export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // As the hero scrolls away, the venue front tips and falls (speeding up) down onto the gig's stage below, which
  // waits with its curtains closed; it fades out as it lands there.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const fall = useTransform(scrollYProgress, (p) => (reduce ? 0 : Math.min(1, Math.max(0, p))));
  const fallY = useTransform(fall, (p) => `${p * 100 + p * p * 55}vh`);
  const fallRotate = useTransform(fall, (p) => p * p * 12);
  const fallOpacity = useTransform(fall, [0.7, 0.92], [1, 0]);
  const [falling, setFalling] = useState(false);
  useMotionValueEvent(fall, "change", (p) => setFalling(p > 0.06));

  const [plugged, setPlugged] = useState<Set<DeviceId>>(() => new Set<DeviceId>(["speakers", "monitor"]));
  const playing = DEVICES.find((d) => plugged.has(d.id)) ?? null;
  const [cheer, setCheer] = useState(false);
  const cheerTimer = useRef(0);

  // The fox cheers for a moment whenever a new headliner takes over.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setCheer(true);
    window.clearTimeout(cheerTimer.current);
    cheerTimer.current = window.setTimeout(() => setCheer(false), 1600);
    return () => window.clearTimeout(cheerTimer.current);
  }, [playing?.id]);

  const toggle = (id: DeviceId) =>
    setPlugged((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A soft spotlight follows the pointer across the hero (written straight to CSS variables, no re-render).
  const onPointerMove = (e: React.PointerEvent) => {
    const el = panel.current;
    if (!el || reduce) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
    el.style.setProperty("--glow", "1");
  };

  const face = falling ? "alarm" : cheer ? "cheer" : playing ? "idle" : "worried";
  const announce = playing ? `Now playing: ${playing.name}` : "Doors closed";

  return (
    <section ref={ref} className="relative z-[4] px-4 pt-[80px] pb-7 md:px-8">
      <div
        ref={panel}
        onPointerMove={onPointerMove}
        onPointerLeave={() => panel.current?.style.setProperty("--glow", "0")}
        className="venue-panel tint-lime hero-panel mx-auto grid min-h-[calc(100dvh-92px)] w-full max-w-[1320px] grid-cols-1 items-center gap-10 p-6 md:p-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14"
      >
        <span className="hero-glow" aria-hidden />
        <div className="relative z-[1]">
          <span className="stamp">
            <span className="on-air" aria-hidden />
            Now playing on Windows
          </span>
          <h1 className="headline mt-6 text-[clamp(2.6rem,6vw,5rem)]">
            Only the <span className="hero-word">headliner</span> plays.
          </h1>
          <p className="mt-5 max-w-[42ch] text-[clamp(1rem,1.4vw,1.18rem)] leading-relaxed text-fg-2">
            Waypoint ranks your headphones, earbuds and speakers. Windows always plays on the best one that's connected.
          </p>

          <div className="mt-8">
            <p className="mb-3 font-mono text-[12px] text-fg-3">Try it: plug things in and out. The highest one plays.</p>
            <div className="flex flex-wrap gap-2.5" role="group" aria-label="Devices">
              {DEVICES.map((d, i) => {
                const Icon = d.icon;
                const on = plugged.has(d.id);
                const live = playing?.id === d.id;
                return (
                  <motion.button
                    key={d.id}
                    type="button"
                    className="plug-chip"
                    data-on={on}
                    data-live={live}
                    aria-pressed={on}
                    aria-label={`${d.name}, rank ${i + 1}: ${on ? "plugged in" : "unplugged"}${live ? ", playing" : ""}`}
                    onClick={() => toggle(d.id)}
                    whileTap={{ scale: 0.94 }}
                    layout
                  >
                    <span className="plug-rank">{i + 1}</span>
                    <Icon size={17} strokeWidth={2.3} />
                    <span>{d.name}</span>
                    {on ? <Plug size={14} strokeWidth={2.5} className="plug-state" /> : <Unplug size={14} strokeWidth={2.5} className="plug-state" />}
                    {live && <motion.span layoutId="hero-live" className="plug-live" transition={{ type: "spring", stiffness: 420, damping: 30 }} />}
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        <motion.div
          className="pointer-events-none relative z-[1] mx-auto w-full max-w-[600px]"
          style={{ y: fallY, rotate: fallRotate, opacity: fallOpacity, transformOrigin: "70% 100%" }}
        >
          <div className="marquee-sign">
            <span className="bulbs" aria-hidden />
            <div className="letterboard">
              <p className="lb-small">Tonight and every night</p>
              <p className="lb-big" aria-hidden>
                {BOARD.map((ch, i) => (
                  <motion.span
                    key={i}
                    className="lb-tile"
                    initial={{ y: -40, opacity: 0, rotate: -20 }}
                    animate={{ y: 0, opacity: 1, rotate: [-3, 2, -2, 3, -1, 2, -3, 1][i] }}
                    transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.25 + i * 0.07 }}
                  >
                    {ch}
                  </motion.span>
                ))}
              </p>
              <p className="lb-small lb-live" aria-live="polite">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={announce}
                    className="inline-block"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: [0, 1, 0.3, 1, 0.6, 1], y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.6 }}
                  >
                    {announce}
                  </motion.span>
                </AnimatePresence>
              </p>
            </div>
          </div>
          <div className="facade" aria-hidden>
            <div className="curtain curtain-l" />
            <div className="curtain curtain-r" />
            <div className={`peek-split ${falling ? "is-falling" : ""}`}>
              {falling ? (
                <span className="amp-bubble">whoa whoa whoa</span>
              ) : cheer && playing ? (
                <span className="amp-bubble">{playing.name.toLowerCase()}!</span>
              ) : !playing ? (
                <span className="amp-bubble">hello?</span>
              ) : null}
              <Critter name="fox" clip={face} scale={4} />
            </div>
            <div className={`peek-hem ${falling ? "is-falling" : ""}`}>
              <Critter name="beepo" clip={falling ? "alarm" : cheer ? "cheer" : "idle"} scale={4} />
              <Critter name="bun" clip={falling ? "alarm" : cheer ? "cheer" : "idle"} scale={4} />
              <Critter name="sprout" clip={falling ? "alarm" : cheer ? "cheer" : "idle"} scale={4} />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
