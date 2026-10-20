import { Reorder, useDragControls } from "motion/react";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plug, Unplug } from "lucide-react";
import { ACTS, act, headliner, type ActId } from "./acts";
import { Stage } from "./Stage";

const PLAYABLE: ActId[] = ["headphones", "earbuds", "desk", "laptop"];

/**
 * Interactive one: drag the setlist into your own order and pull plugs. The stage always lights the highest act
 * that's still plugged in, which is exactly the rule Waypoint applies to Windows.
 */
export function RunningOrder() {
  const [order, setOrder] = useState<ActId[]>(PLAYABLE);
  const [plugged, setPlugged] = useState<Set<ActId>>(() => new Set<ActId>(["earbuds", "desk", "laptop"]));
  const lit = headliner(order, plugged);

  const toggle = (id: ActId) =>
    setPlugged((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const move = (id: ActId, by: -1 | 1) =>
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + by;
      if (j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const onStage = useMemo(() => order.filter((id) => plugged.has(id)).map((id) => ({ id, rank: order.indexOf(id) + 1 })), [order, plugged]);

  return (
    <section id="try-it" className="mx-auto w-full max-w-[1280px] px-4 py-24 md:px-8 md:py-32">
      <h2 className="headline max-w-[16ch] text-[clamp(2.2rem,4.6vw,3.6rem)]">Write your own running order.</h2>
      <p className="mt-4 max-w-[52ch] text-[1.05rem] leading-relaxed text-fg-2">
        Drag the setlist into any order and pull a few plugs. The light always finds the highest act that's still here.
      </p>

      <div className="mt-12 grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
        <div className="paper-sheet">
          <span className="tape tape-left" aria-hidden />
          <span className="tape tape-right" aria-hidden />
          <Reorder.Group axis="y" values={order} onReorder={setOrder} className="flex flex-col" aria-label="Your setlist">
            {order.map((id, i) => (
              <Row
                key={id}
                id={id}
                rank={i + 1}
                first={i === 0}
                lastRow={i === order.length - 1}
                plugged={plugged.has(id)}
                playing={lit === id}
                onToggle={() => toggle(id)}
                onMove={(by) => move(id, by)}
              />
            ))}
          </Reorder.Group>
        </div>

        <div>
          <Stage acts={onStage} lit={lit} compact />
          <p className="mt-4 font-display text-[1.25rem] font-bold" aria-live="polite">
            {lit ? (
              <>
                Playing on <span className="hl">{act(lit).name}</span>
              </>
            ) : (
              "Silence. Plug something in."
            )}
          </p>
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
  const a = ACTS.find((x) => x.id === id)!;
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
      <span className="set-num w-8 text-[30px]" data-live={playing}>
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[17px] font-bold">{a.name}</span>
        <span className="block font-mono text-[11px] text-fg-3">{a.via}</span>
      </span>
      <span className="flex items-center gap-1">
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
