import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { CodeXml, Download } from "lucide-react";
import { Critter } from "../../src/pals/Critter";
import { DOWNLOAD, REPO } from "./acts";

const BOARD = "WAYPOINT".split("");

/**
 * The venue front: copy on the left, and on the right a marquee sign over closed curtains with a pal peeking
 * through. The show itself (the stage) starts one screen further down, where these curtains open.
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

  return (
    <section ref={ref} className="relative z-[4] px-3 pt-[76px] pb-3 md:px-6">
      <div className="venue-panel tint-lime mx-auto grid min-h-[calc(100dvh-92px)] w-full max-w-[1320px] grid-cols-1 items-center gap-10 p-6 md:p-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
        <div className="relative z-[1]">
          <span className="stamp">Now playing on Windows</span>
          <h1 className="headline mt-6 text-[clamp(2.6rem,6vw,5rem)]">Only the headliner plays.</h1>
          <p className="mt-5 max-w-[42ch] text-[clamp(1rem,1.4vw,1.18rem)] leading-relaxed text-fg-2">
            Waypoint ranks your headphones, earbuds and speakers. Windows always plays on the best one that's connected.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={DOWNLOAD} className="btn-ink">
              <Download size={17} strokeWidth={2.4} />
              Download for Windows
            </a>
            <a href={REPO} className="btn-ghost">
              <CodeXml size={17} strokeWidth={2.2} />
              View the code
            </a>
          </div>
        </div>

        <motion.div
          className="pointer-events-none relative z-[1] mx-auto w-full max-w-[600px]"
          style={{ y: fallY, rotate: fallRotate, opacity: fallOpacity, transformOrigin: "70% 100%" }}
        >
          <div className="marquee-sign">
            <span className="bulbs" aria-hidden />
            <div className="letterboard" role="img" aria-label="Tonight: Waypoint, with the pixel pals">
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
              <p className="lb-small">with the pixel pals</p>
            </div>
          </div>
          <div className="facade" aria-hidden>
            <div className="curtain curtain-l" />
            <div className="curtain curtain-r" />
            <div className="peek-split">
              <Critter name="fox" clip="idle" scale={4} />
            </div>
            <div className="peek-hem">
              <Critter name="beepo" clip="idle" scale={4} />
              <Critter name="bun" clip="idle" scale={4} />
              <Critter name="sprout" clip="idle" scale={4} />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
