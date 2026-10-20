import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Critter } from "../../src/pals/Critter";
import { CRITTERS, type CritterName } from "../../src/pals/data";

const BOARD = "WAYPOINT".split("");

/** The whole cast; in the app every profile gets one of these as its pal. */
const CAST = Object.keys(CRITTERS) as CritterName[];
const title = (n: CritterName) => n[0].toUpperCase() + n.slice(1);

/** The headline's last word rolls through these. */
const DEVICE_WORDS = ["headphones", "earbuds", "speakers", "headset"];

/**
 * "Your sound follows your [headphones.]": the device word rolls up and out every couple of seconds, each one
 * printed in the next ink. Holds still on the first word with reduced motion.
 */
function RollingHeadline() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % DEVICE_WORDS.length), 2200);
    return () => window.clearInterval(id);
  }, [reduce]);
  const word = DEVICE_WORDS[i];
  return (
    <h1 className="headline mt-6 text-[clamp(2.6rem,6vw,5rem)]" aria-label="Your sound follows your headphones, earbuds, speakers or headset.">
      <span aria-hidden>Your sound follows your</span>
      <span className="roll-slot" aria-hidden>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={word}
            className="roll-word"
            data-ink={i % 3}
            initial={{ y: "90%", opacity: 0, rotate: 4 }}
            animate={{ y: 0, opacity: 1, rotate: 0 }}
            exit={{ y: "-90%", opacity: 0, rotate: -4 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
          >
            {word}.
          </motion.span>
        </AnimatePresence>
      </span>
    </h1>
  );
}

/**
 * The venue front: on the left the copy and a pal picker, and on the right a marquee sign that bills your pick, over
 * closed curtains where that pal peeks through. The show itself starts one screen further down, where the whole front
 * falls onto the stage.
 */
export function Hero() {
  const ref = useRef<HTMLElement>(null);
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

  const [star, setStar] = useState<CritterName>("fox");
  const [hover, setHover] = useState<CritterName | null>(null);
  const [cheer, setCheer] = useState(false);
  const cheerTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(cheerTimer.current), []);

  const pick = (n: CritterName) => {
    setStar(n);
    setCheer(true);
    window.clearTimeout(cheerTimer.current);
    cheerTimer.current = window.setTimeout(() => setCheer(false), 1800);
  };

  const face = falling ? "alarm" : cheer ? "cheer" : "idle";
  const band = falling ? "alarm" : cheer ? "cheer" : "idle";
  const shown = hover ?? star;

  return (
    <section ref={ref} className="relative z-[4] px-4 pt-[80px] pb-7 md:px-8">
      <div className="venue-panel tint-lime mx-auto grid min-h-[calc(100dvh-92px)] w-full max-w-[1320px] grid-cols-1 items-center gap-10 p-6 md:p-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
        <div className="relative z-[1]">
          <span className="stamp">
            <span className="on-air" aria-hidden />
            Now playing on Windows
          </span>
          <RollingHeadline />
          <p className="mt-5 max-w-[42ch] text-[clamp(1rem,1.4vw,1.18rem)] leading-relaxed text-fg-2">
            Waypoint ranks your headphones, earbuds and speakers. Windows always plays on the best one that's connected.
          </p>

          <div className="mt-8">
            <p className="mb-3 font-mono text-[12px] text-fg-3">Every profile in Waypoint gets a pal. Pick tonight's star:</p>
            <div className="pal-picker" role="radiogroup" aria-label="Tonight's star">
              {CAST.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={star === n}
                  aria-label={title(n)}
                  className="pal-pick"
                  onClick={() => pick(n)}
                  onPointerEnter={() => setHover(n)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(n)}
                  onBlur={() => setHover(null)}
                >
                  <Critter name={n} clip={star === n || hover === n ? "cheer" : "idle"} scale={2} blink={false} />
                </button>
              ))}
            </div>
            <p className="mt-3 min-h-[2.8em] max-w-[44ch] text-[0.95rem] leading-snug text-fg-3" aria-live="polite">
              <span className="font-display font-bold text-fg">{title(shown)}.</span> {CRITTERS[shown].tag}
            </p>
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
                    key={star}
                    className="inline-block"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: [0, 1, 0.3, 1, 0.6, 1], y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.6 }}
                  >
                    Starring {title(star)}
                  </motion.span>
                </AnimatePresence>
              </p>
            </div>
          </div>
          <div className="facade" aria-hidden>
            <div className="curtain curtain-l" />
            <div className="curtain curtain-r" />
            <div className={`peek-split ${falling ? "is-falling" : ""}`}>
              {falling ? <span className="amp-bubble">whoa whoa whoa</span> : cheer ? <span className="amp-bubble">my turn!</span> : null}
              <motion.span
                key={star}
                className="inline-block"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 15 }}
              >
                <Critter name={star} clip={face} scale={4} />
              </motion.span>
            </div>
            <div className={`peek-hem ${falling ? "is-falling" : ""}`}>
              <Critter name="beepo" clip={band} scale={4} />
              <Critter name="bun" clip={band} scale={4} />
              <Critter name="sprout" clip={band} scale={4} />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
