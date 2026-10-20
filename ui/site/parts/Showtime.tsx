import { Reorder, motion, useDragControls } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, MousePointerClick, Plug, Power, RotateCcw, Scale, ShieldCheck, Unplug } from "lucide-react";
import { ACTS, act, headliner, type ActId } from "./acts";
import { Stage, type Panic } from "./Stage";

type Mode = "off" | "balanced" | "strict";

const MODES: { value: Mode; label: string; icon: typeof Power; ink: string; blurb: string }[] = [
  { value: "off", label: "Off", icon: Power, ink: "var(--color-neutral)", blurb: "Waypoint only watches. Whatever Windows picks, plays." },
  { value: "balanced", label: "Balanced", icon: Scale, ink: "var(--color-sun)", blurb: "Switches when devices come and go. Someone else's pick stays until the next change." },
  { value: "strict", label: "Strict", icon: ShieldCheck, ink: "var(--color-lime)", blurb: "Your best device always plays. Anyone else's pick is put straight back." },
];

const plays = (id: ActId) => `${act(id).name} ${act(id).name.endsWith("s") ? "play" : "plays"}`;
const label = (m: Mode) => MODES.find((x) => x.value === m)!.label;

/**
 * The stage that fell out of the gig lands here, and it's yours. Rank the setlist, pull plugs, and use the switch on
 * any row to change the output behind Waypoint's back (as a game or Windows would). Follows the app's real rules:
 * Off leaves Windows alone (which jumps to whatever connected last), Balanced picks your best device whenever devices
 * or the order change but respects someone else's pick until then, Strict always puts your best device back.
 * Restore priority goes back to your list in any mode.
 */
export function Showtime() {
  const [order, setOrder] = useState<ActId[]>(ACTS.map((a) => a.id));
  const [plugged, setPlugged] = useState<Set<ActId>>(() => new Set<ActId>(["desk", "laptop", "monitor"]));
  const [recent, setRecent] = useState<ActId[]>(["laptop", "monitor", "desk"]);
  const [mode, setMode] = useState<Mode>("balanced");
  const [lit, setLit] = useState<ActId | null>("desk");
  /** A device someone else switched to, which is still playing (Off or Balanced). */
  const [picked, setPicked] = useState<ActId | null>(null);
  /** A device that just grabbed the output and is shouting about it. */
  const [grabber, setGrabber] = useState<ActId | null>(null);
  const [note, setNote] = useState("Desk speakers play: they're the highest act that's plugged in.");
  const [panic, setPanic] = useState<Panic | undefined>("falling");
  const timer = useRef(0);
  const panicTimer = useRef(0);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(panicTimer.current);
    },
    [],
  );

  const landed = () => {
    setPanic("phew");
    panicTimer.current = window.setTimeout(() => setPanic(undefined), 1800);
  };

  /** Back to the running order: the highest act that's plugged in plays. */
  const settle = (nextOrder: ActId[], nextPlugged: Set<ActId>, what: string) => {
    window.clearTimeout(timer.current);
    setPicked(null);
    setGrabber(null);
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
      setGrabber(null);
      if (plugging) {
        setLit(id);
        setPicked(id);
        setNote(`${act(id).name} connected and Windows jumped straight to it. Off doesn't stop that.`);
      } else if (lit === id) {
        const fallback = [...nextRecent].reverse().find((r) => next.has(r)) ?? null;
        const best = headliner(order, next);
        setLit(fallback);
        setPicked(fallback && fallback !== best ? fallback : null);
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

  /** Something other than Waypoint (a game, a call app, Windows' own settings) switches the output to `id`. */
  const switchTo = (id: ActId) => {
    window.clearTimeout(timer.current);
    setLit(id);
    setGrabber(id);
    if (mode === "strict") {
      setPicked(null);
      setNote(`Something switched the output to ${act(id).name}...`);
      timer.current = window.setTimeout(() => {
        const best = headliner(order, plugged);
        setLit(best);
        setGrabber(null);
        setNote(best ? `Strict put it straight back. ${plays(best)}.` : "Strict put it straight back.");
      }, 1000);
      return;
    }
    setPicked(id);
    setNote(
      mode === "balanced"
        ? `Something switched to ${act(id).name}. Balanced respects it until a device comes or goes, or you restore.`
        : `Something switched to ${act(id).name}. Off lets it and only writes it in the log.`,
    );
  };

  const pickMode = (m: Mode) => {
    setMode(m);
    if (m === "strict") {
      settle(order, plugged, picked ? "Strict doesn't allow someone else's pick. Back to your list:" : "Strict.");
      return;
    }
    setNote(picked ? `${label(m)}. ${act(picked).name} keeps playing until something changes.` : `${label(m)}. Now switch the output from any row and see what happens.`);
  };

  const restore = () => settle(order, plugged, "Priority restored.");

  const onStage = order
    .filter((id) => plugged.has(id))
    .map((id) => ({ id, rank: order.indexOf(id) + 1, says: id === grabber ? "my turn!" : undefined }));
  const blurb = MODES.find((m) => m.value === mode)!.blurb;

  return (
    <section id="run-the-show" className="relative z-[1] px-4 py-7 md:px-8">
      <div className="venue-panel tint-sun mx-auto grid w-full max-w-[1320px] grid-cols-1 gap-x-12 gap-y-7 p-5 md:p-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr] lg:p-12">
        <div className="lg:col-start-1 lg:row-start-1">
          <h2 className="headline text-[clamp(2.2rem,4.6vw,3.6rem)]">Run the show.</h2>
          <p className="mt-3 max-w-[48ch] text-[1.05rem] leading-relaxed text-fg-2">
            Rank the setlist and pull plugs. Then hit <MousePointerClick className="inline align-[-3px]" size={17} strokeWidth={2.3} aria-label="switch" /> on
            any row to switch the output behind Waypoint's back, and see how each mode answers.
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
            onAnimationComplete={landed}
          >
            <Stage acts={onStage} lit={lit} sign={`House rules: ${label(mode)}`} panic={panic} />
            {panic === "phew" && (
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

          <div className="mt-4 flex flex-wrap items-end justify-between gap-5">
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
            {picked && (
                <motion.button
                  type="button"
                  className="btn-ink"
                  onClick={restore}
                  initial={{ opacity: 0, scale: 0.8, rotate: -4 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 420, damping: 22 }}
                >
                  <RotateCcw size={17} strokeWidth={2.4} />
                  Restore priority
                </motion.button>
              )}
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
                onSwitch={() => switchTo(id)}
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
  onSwitch,
}: {
  id: ActId;
  rank: number;
  first: boolean;
  lastRow: boolean;
  plugged: boolean;
  playing: boolean;
  onToggle: () => void;
  onMove: (by: -1 | 1) => void;
  onSwitch: () => void;
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
        <span className="block font-mono text-[11px] text-fg-3">{playing ? "playing" : a.via}</span>
      </span>
      <span className="hidden items-center gap-1 sm:flex">
        <button type="button" className="icon-btn" onClick={() => onMove(-1)} disabled={first} aria-label={`Move ${a.name} up`}>
          <ArrowUp size={15} strokeWidth={2.4} />
        </button>
        <button type="button" className="icon-btn" onClick={() => onMove(1)} disabled={lastRow} aria-label={`Move ${a.name} down`}>
          <ArrowDown size={15} strokeWidth={2.4} />
        </button>
      </span>
      <button
        type="button"
        className="switch-btn"
        onClick={onSwitch}
        disabled={!plugged || playing}
        aria-label={`Switch the output to ${a.name} behind Waypoint's back`}
        title="Switch the output here, the way another app would"
      >
        <MousePointerClick size={15} strokeWidth={2.4} />
      </button>
      <button type="button" className="plug-btn" aria-pressed={plugged} onClick={onToggle} aria-label={`${a.name}: ${plugged ? "plugged in" : "unplugged"}`}>
        {plugged ? <Plug size={15} strokeWidth={2.4} /> : <Unplug size={15} strokeWidth={2.4} />}
        <span>{plugged ? "In" : "Out"}</span>
      </button>
    </Reorder.Item>
  );
}
