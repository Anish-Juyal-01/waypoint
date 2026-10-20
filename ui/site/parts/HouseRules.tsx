import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Hand, Power, Scale, ShieldCheck } from "lucide-react";
import { ACTS, act, headliner, type ActId } from "./acts";
import { Stage, type OnStage } from "./Stage";

type Mode = "off" | "balanced" | "strict";

const MODES: { value: Mode; label: string; icon: typeof Power; ink: string; blurb: string }[] = [
  { value: "off", label: "Off", icon: Power, ink: "var(--color-neutral)", blurb: "Waypoint only watches and writes it down." },
  { value: "balanced", label: "Balanced", icon: Scale, ink: "var(--color-sun)", blurb: "Your change is respected until a device connects or leaves." },
  { value: "strict", label: "Strict", icon: ShieldCheck, ink: "var(--color-lime)", blurb: "Your #1 stays on. Anyone else's switch is put straight back." },
];

const ORDER: ActId[] = ACTS.map((a) => a.id);
const rankOf = (id: ActId) => ORDER.indexOf(id) + 1;

/**
 * Interactive two: something else switches the output (a game, a call app, Windows itself). Pick a mode and heckle
 * the stage to see how Waypoint answers. Mirrors the app's real rules: Off logs it, Balanced respects it until the
 * next device change, Strict reverts it.
 */
export function HouseRules() {
  const [mode, setMode] = useState<Mode>("strict");
  const [earbuds, setEarbuds] = useState(false);
  const [lit, setLit] = useState<ActId>("headphones");
  const [note, setNote] = useState("Headphones are playing. They're #1.");
  const [heckled, setHeckled] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const connected = new Set<ActId>(["headphones", "desk", "monitor", ...(earbuds ? (["earbuds"] as ActId[]) : [])]);
  const best = () => headliner(ORDER, connected)!;

  const pickMode = (m: Mode) => {
    window.clearTimeout(timer.current);
    setMode(m);
    setHeckled(false);
    setLit("headphones");
    setNote(m === "off" ? "Off. Waypoint is just watching now." : `${MODES.find((x) => x.value === m)!.label}. Headphones are playing.`);
  };

  const heckle = () => {
    window.clearTimeout(timer.current);
    setHeckled(true);
    setLit("monitor");
    if (mode === "strict") {
      setNote("Something switched to the monitor...");
      timer.current = window.setTimeout(() => {
        setLit(best());
        setNote("Put straight back. Strict keeps your best device on.");
        setHeckled(false);
      }, 900);
    } else if (mode === "balanced") {
      setNote("Respected. Maybe you meant it. Waypoint goes back to your list when a device connects or leaves.");
    } else {
      setNote("The monitor plays. Off only writes it in the activity log.");
    }
  };

  const toggleEarbuds = () => {
    window.clearTimeout(timer.current);
    const next = !earbuds;
    setEarbuds(next);
    const nowConnected = new Set(connected);
    if (next) nowConnected.add("earbuds");
    else nowConnected.delete("earbuds");
    if (mode === "off") {
      setNote(next ? "Earbuds connect. Off doesn't switch anything." : "Earbuds leave. Nothing changes in Off.");
      return;
    }
    const top = headliner(ORDER, nowConnected)!;
    setLit(top);
    setHeckled(false);
    const plays = `${act(top).name} ${act(top).name.endsWith("s") ? "play" : "plays"}`;
    setNote(next ? `Earbuds connect, so Waypoint checks the list again. ${plays}.` : `Earbuds leave. ${plays}.`);
  };

  const acts: OnStage[] = (["desk", "headphones", ...(earbuds ? (["earbuds"] as ActId[]) : []), "monitor"] as ActId[]).map((id) => ({
    id,
    rank: rankOf(id),
    says: id === "monitor" && heckled ? "my turn!" : undefined,
  }));

  return (
    <section className="px-3 py-3 md:px-6">
      <div className="venue-panel tint-coral mx-auto grid w-full max-w-[1320px] grid-cols-1 p-6 md:p-12 items-center gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
        <div className="relative z-[1] order-2 lg:order-1">
          <Stage acts={acts} lit={lit} compact />
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={note}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22 }}
              className="mt-4 min-h-[3.2em] max-w-[56ch] text-[1.02rem] leading-relaxed text-fg-2"
              aria-live="polite"
            >
              {note}
            </motion.p>
          </AnimatePresence>
        </div>

        <div className="relative z-[1] order-1 lg:order-2">
          <h2 className="headline max-w-[14ch] text-[clamp(2.2rem,4.6vw,3.6rem)]">Set the house rules.</h2>
          <p className="mt-4 max-w-[46ch] text-[1.05rem] leading-relaxed text-fg-2">
            Games, call apps and Windows itself love to switch the output behind your back. Pick how Waypoint answers.
          </p>

          <div className="mt-8 flex gap-5" role="radiogroup" aria-label="Mode">
            {MODES.map((m) => {
              const Icon = m.icon;
              const on = mode === m.value;
              return (
                <button key={m.value} type="button" role="radio" aria-checked={on} className="coin-btn flex flex-col items-center gap-2" onClick={() => pickMode(m.value)}>
                  <span className="coin" style={{ background: on ? m.ink : "transparent", color: on ? "var(--color-on-accent)" : "var(--color-fg)" }}>
                    <Icon size={22} strokeWidth={2.3} />
                  </span>
                  <span className={`font-mono text-[12px] ${on ? "text-fg" : "text-fg-3"}`}>{m.label}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-4 min-h-[3em] max-w-[40ch] text-[0.95rem] text-fg-3">{MODES.find((m) => m.value === mode)!.blurb}</p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="btn-ink" onClick={heckle}>
              <Hand size={17} strokeWidth={2.4} />
              Switch to the monitor
            </button>
            <button type="button" className="btn-ghost" onClick={toggleEarbuds}>
              {earbuds ? "Unplug earbuds" : "Plug in earbuds"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
