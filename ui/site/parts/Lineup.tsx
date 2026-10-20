import { motion } from "motion/react";
import { Critter } from "../../src/pals/Critter";
import type { CritterName } from "../../src/pals/data";

/** The rest of the app, set as a gig poster: biggest names first. */
const BILL: { name: string; note: string; size: string; ink?: boolean }[] = [
  { name: "Microphones", note: "their own setlist, off until you rank one", size: "clamp(2.6rem,7.5vw,6.2rem)", ink: true },
  { name: "Verified switches", note: "checked with Windows, never assumed", size: "clamp(2rem,5.4vw,4.4rem)" },
  { name: "Profiles", note: "work, gaming, travel, each with its own order", size: "clamp(1.7rem,4.2vw,3.4rem)", ink: true },
  { name: "Global hotkeys", note: "Ctrl+Alt+F9 for the next output", size: "clamp(1.45rem,3.4vw,2.6rem)" },
  { name: "Apps that won't follow", note: "it names them and shows the fix", size: "clamp(1.3rem,2.8vw,2.1rem)", ink: true },
  { name: "Start with Windows", note: "lives in the tray, no admin rights", size: "clamp(1.15rem,2.3vw,1.7rem)" },
];

const BAND: { name: CritterName; clip: string }[] = [
  { name: "fox", clip: "cheer" },
  { name: "bun", clip: "idle" },
  { name: "beepo", clip: "idle" },
  { name: "mikey", clip: "sing" },
  { name: "sprout", clip: "idle" },
  { name: "owlet", clip: "idle" },
  { name: "chick", clip: "cheer" },
];

export function Lineup() {
  return (
    <section className="px-3 py-3 md:px-6" aria-labelledby="bill-title">
      <div className="poster mx-auto w-full max-w-[1320px]">
        <p id="bill-title" className="poster-kicker">
          Also on the bill
        </p>
        <ul className="mt-6 flex flex-col items-center gap-[clamp(0.9rem,2.2vw,1.6rem)]">
          {BILL.map((b, i) => (
            <motion.li
              key={b.name}
              className="flex flex-col items-center text-center"
              initial={{ opacity: 0, y: 26, rotate: i % 2 ? 1.5 : -1.5 }}
              whileInView={{ opacity: 1, y: 0, rotate: 0 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ type: "spring", stiffness: 120, damping: 16, delay: i * 0.04 }}
            >
              <span className={`poster-name ${b.ink ? "is-ink" : ""}`} style={{ fontSize: b.size }}>
                {b.name}
              </span>
              <span className="mt-1 font-mono text-[12px] text-fg-3">{b.note}</span>
            </motion.li>
          ))}
        </ul>
        <div className="mt-12 flex flex-wrap items-end justify-center gap-x-4 gap-y-2" aria-hidden>
          {BAND.map((p) => (
            <Critter key={p.name} name={p.name} clip={p.clip} scale={4} />
          ))}
        </div>
        <p className="mt-6 text-center font-mono text-[12px] text-fg-3">Free and open source. Windows 10 and 11. Everything stays on your PC.</p>
      </div>
    </section>
  );
}
