import { Reorder, motion, useDragControls } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Hand, Plug, Power, Scale, ShieldCheck, Unplug } from "lucide-react";
import { ACTS, act, headliner, type ActId } from "./acts";
import { Stage } from "./Stage";

type Mode = "off" | "balanced" | "strict";

const MODES: { value: Mode; label: string; icon: typeof Power; ink: string; blurb: string }[] = [
  { value: "off", label: "Off", icon: Power, ink: "var(--color-neutral)", blurb: "Waypoint only watches. Windows does whatever it likes." },
  { value: "balanced", label: "Balanced", icon: Scale, ink: "var(--color-sun)", blurb: "Switches when devices come and go. Someone else's switch stays until the next change." },
  { value: "strict", label: "Strict", icon: ShieldCheck, ink: "var(--color-lime)", blurb: "Your best device always plays. Anyone else's switch is put straight back." },
];

const plays = (id: ActId) => `${act(id).name} ${act(id).name.endsWith("s") ? "play" : "plays"}`;

/**
 * The stage that fell out of the gig lands here, and it's yours: rank the setlist, pull plugs, pick a mode and try
 * to switch the output behind Waypoint's back. Follows the app's real rules: Off leaves Windows alone (which jumps
 * to whatever connected last), Balanced picks the best device whenever devices or the order change but respects
 * someone else's switch until then, Strict always puts the best device back.
 */
export function Showtime() {
  const [order, setOrder] = useState<ActId[]>(ACTS.map((a) => a.id));
  const [plugged, setPlugged] = useState<Set<ActId>>(() => new Set<ActId>(["desk", "laptop", "monitor"]));
  const [recent, setRecent] = useState<ActId[]>(["laptop", "monitor", "desk"]);
  const [mode, setMode] = useState<Mode>("balanced");
  const [lit, setLit] = useState<ActId | null>("desk");
  const [heckled, setHeckled] = useState(false);
  const [note, setNote] = useState("Desk speakers play: they're the highest act that's plugged in.");
  const timer = useRef(0);
  const [landed, setLanded] = useState(false);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const settle = (nextOrder: ActId[], nextPlugged: Set<ActId>, what: string) => {
    window.clearTimeout(timer.current);
    setHeckled(false);
    const best = headliner(nextOrder, nextPlugged);
    setLit(best);
    setNote(best ? `${what} ${plays(best)}.` : `${what} Nothing is plugged in, so there's silence.`);
  };

  const togglePlug = (id: ActId) => {
    const next = new Set(plugged);
    const plugging = !next.has(id);
    if (plugging) next.add(id);
    else next.delete(id);
    const nextRecent = plugging ? [...recent.filter((r) => r !== id), id] : recent.filter((r) => r !== id);
    setPlugged(next);
    setRecent(nextRecent);

    if (mode === "off") {
      window.clearTimeout(timer.current);
      setHeckled(false);
      if (plugging) {
        setLit(id);
        setNote(`${act(id).name} connected and Windows jumped straight to it. Off doesn't stop that.`);
      } else if (lit === id) {
        const fallback = [...nextRecent].reverse().find((r) => next.has(r)) ?? null;
        setLit(fallback);
        const best = headliner(order, next);
        setNote(
          !fallback
            ? "Everything is unplugged."
            : fallback === best
              ? `${act(id).name} left. Windows picked ${act(fallback).name}.`
              : `${act(id).name} left. Windows picked ${act(fallback).name}, not your #1.`,
        );
      } else {
        setNote(`${act(id).name} left. Nothing else changes in Off.`);
      }
      return;
    }
    settle(order, next, plugging ? `${act(id).name} plugged in, so Waypoint checks the list.` : `${act(id).name} left, so Waypoint checks the list.`);
  };

  const reorder = (next: ActId[]) => {
    setOrder(next);
    if (mode === "off") {
      setNote("New order saved. Off won't switch anything for it.");
      return;
    }
    settle(next, plugged, "New running order.");
  };

  const move = (id: ActId, by: -1 | 1) => {
    const i = order.indexOf(id);
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    reorder(next);
  };

  /** Something else (a game, a call app, Windows) switches the output to the monitor; the mode decides what happens. */
  const heckle = (m: Mode = mode) => {
    window.clearTimeout(timer.current);
    if (!plugged.has("monitor")) {
      setNote("Plug the monitor back in to see that.");
      return;
    }
    setHeckled(true);
    setLit("monitor");
    if (m === "strict") {
      setNote("Something switched to the monitor...");
      timer.current = window.setTimeout(() => {
        const best = headliner(order, plugged);
        setLit(best);
        setHeckled(false);
        setNote(best ? `Strict put it straight back. ${plays(best)}.` : "Strict put it straight back.");
      }, 1000);
    } else if (m === "balanced") {
      setNote("Something switched to the monitor. Balanced respects it until a device comes or goes.");
    } else {
      setNote("Something switched to the monitor. Off lets it, and only writes it in the log.");
    }
  };

  // Picking a mode shows it working: the stage resets to your best device, then something tries to steal it.
  const pickMode = (m: Mode) => {
    window.clearTimeout(timer.current);
    setMode(m);
    setHeckled(false);
    setLit(headliner(order, plugged));
    setNote(`${MODES.find((x) => x.value === m)!.label}. Watch what happens when something grabs the output...`);
    timer.current = window.setTimeout(() => heckle(m), 1100);
  };

  const onStage = order
    .filter((id) => plugged.has(id))
    .map((id) => ({ id, rank: order.indexOf(id) + 1, says: id === "monitor" && heckled ? "my turn!" : undefined }));
  const blurb = MODES.find((m) => m.value === mode)!.blurb;

  return (
    <section id="run-the-show" className="relative z-[1] px-3 py-3 md:px-6">
      <div className="venue-panel tint-sun mx-auto grid w-full max-w-[1320px] grid-cols-1 gap-x-12 gap-y-7 p-5 md:p-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr] lg:p-12">
        <div className="lg:col-start-1 lg:row-start-1">
          <h2 className="headline text-[clamp(2.2rem,4.6vw,3.6rem)]">Run the show.</h2>
          <p className="mt-3 max-w-[46ch] text-[1.05rem] leading-relaxed text-fg-2">
            Drag the setlist, pull plugs, pick a mode, then try to switch the output behind Waypoint's back.
          </p>
        </div>

        {/* On phones: heading, stage and controls, then the setlist. Side by side from lg up. */}
        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {/* Lands with a thud when it scrolls in, having fallen out of the gig above. */}
          <motion.div
            className="relative"
            initial={{ y: -160, rotate: -5 }}
            whileInView={{ y: 0, rotate: 0 }}
            viewport={{ once: true, amount: 0.35 }}
            transition={{ type: "spring", stiffness: 300, damping: 13, mass: 1.2 }}
            onAnimationComplete={() => setLanded(true)}
          >
            <Stage acts={onStage} lit={lit} sign={`House rules: ${MODES.find((m) => m.value === mode)!.label}`} />
            {landed && (
              <span className="dust" aria-hidden>
                <i />
                <i />
                <i />
                <i />
              </span>
            )}
          </motion.div>

          <motion.p
              key={note}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
              className="mt-4 min-h-[3.2em] font-display text-[1.15rem] font-bold leading-snug"
              aria-live="polite"
            >
              {note}
            </motion.p>

          <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex gap-4" role="radiogroup" aria-label="Mode">
                {MODES.map((m) => {
                  const Icon = m.icon;
                  const on = mode === m.value;
                  return (
                    <button key={m.value} type="button" role="radio" aria-checked={on} className="coin-btn flex flex-col items-center gap-1.5" onClick={() => pickMode(m.value)}>
                      <span className="coin coin-sm" style={{ background: on ? m.ink : "transparent", color: on ? "var(--color-on-accent)" : "var(--color-fg)" }}>
                        <Icon size={19} strokeWidth={2.3} />
                      </span>
                      <span className={`font-mono text-[12px] ${on ? "text-fg" : "text-fg-3"}`}>{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <button type="button" className="btn-ink self-start sm:self-auto" onClick={() => heckle()} disabled={lit === "monitor"}>
              <Hand size={17} strokeWidth={2.4} />
              Switch to the monitor
            </button>
          </div>
          <p className="mt-3 max-w-[60ch] text-[0.92rem] text-fg-3">{blurb}</p>
        </div>

        <div className="paper-sheet self-start lg:col-start-1 lg:row-start-2">
          <span className="tape tape-left" aria-hidden />
          <span className="tape tape-right" aria-hidden />
          <Reorder.Group axis="y" values={order} onReorder={reorder} className="flex flex-col" aria-label="Your setlist">
            {order.map((id, i) => (
              <Row
                key={id}
                id={id}
                rank={i + 1}
                first={i === 0}
                lastRow={i === order.length - 1}
                plugged={plugged.has(id)}
                playing={lit === id}
                onToggle={() => togglePlug(id)}
                onMove={(by) => move(id, by)}
              />
            ))}
          </Reorder.Group>
        </div>
      </div>
    </section>
  );
}

function Row({
  id,
  rank,
  first,
  lastRow,
  plugged,
  playing,
  onToggle,
  onMove,
}: {
  id: ActId;
  rank: number;
  first: boolean;
  lastRow: boolean;
  plugged: boolean;
  playing: boolean;
  onToggle: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const controls = useDragControls();
  const a = act(id);
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      className="order-row"
      data-plugged={plugged}
      whileDrag={{ scale: 1.03, rotate: -1.2, zIndex: 2 }}
      transition={{ type: "spring", stiffness: 500, damping: 34 }}
    >
      <button
        type="button"
        className="order-grip"
        onPointerDown={(e) => {
          e.preventDefault();
          controls.start(e);
        }}
        aria-label={`Drag ${a.name}`}
        tabIndex={-1}
      >
        <GripVertical size={18} strokeWidth={2.2} />
      </button>
      <span className="set-num w-8 text-[28px]" data-live={playing}>
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[16.5px] font-bold">
          <span className={playing ? "hl" : undefined}>{a.name}</span>
        </span>
        <span className="block font-mono text-[11px] text-fg-3">{a.via}</span>
      </span>
      <span className="hidden items-center gap-1 sm:flex">
        <button type="button" className="icon-btn" onClick={() => onMove(-1)} disabled={first} aria-label={`Move ${a.name} up`}>
          <ArrowUp size={15} strokeWidth={2.4} />
        </button>
        <button type="button" className="icon-btn" onClick={() => onMove(1)} disabled={lastRow} aria-label={`Move ${a.name} down`}>
          <ArrowDown size={15} strokeWidth={2.4} />
        </button>
      </span>
      <button type="button" className="plug-btn" aria-pressed={plugged} onClick={onToggle} aria-label={`${a.name}: ${plugged ? "plugged in" : "unplugged"}`}>
        {plugged ? <Plug size={15} strokeWidth={2.4} /> : <Unplug size={15} strokeWidth={2.4} />}
        <span>{plugged ? "In" : "Out"}</span>
      </button>
    </Reorder.Item>
  );
}
