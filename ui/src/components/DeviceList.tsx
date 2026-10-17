import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import type { DeviceView, Flow } from "../bridge/protocol";
import { flowText, isAvailable, splitName } from "../lib/format";
import { useApp } from "../store/store";
import { DeviceCard, SortableDeviceCard } from "./DeviceCard";
import { Critter } from "../pals/Critter";
import { Button, Switch, ZineHeading } from "./ui";

export function DeviceList({ flow }: { flow: Flow }) {
  const devices = useApp((s) => s.snapshot![flow].devices);
  const text = flowText[flow];
  const showDisconnected = useApp((s) => s.snapshot!.settings.showDisconnected);
  const updateSettings = useApp((s) => s.updateSettings);
  const reorderVisible = useApp((s) => s.reorderVisible);
  const send = useApp((s) => s.send);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  // dnd-kit animates the drop itself; suspend layout animation briefly so the two don't fight.
  const [settling, setSettling] = useState(false);

  const { ranked, ignored } = useMemo(() => {
    const ranked: DeviceView[] = [];
    const ignored: DeviceView[] = [];
    for (const d of devices) {
      if (d.autoExcluded) ignored.push(d);
      else if (showDisconnected || isAvailable(d) || d.isDefault) ranked.push(d);
    }
    return { ranked, ignored };
  }, [devices, showDisconnected]);

  const ids = ranked.map((d) => d.id);
  const connectedCount = devices.filter((d) => isAvailable(d) && !d.autoExcluded).length;
  const active = activeId ? devices.find((d) => d.id === activeId) : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const nameOf = (id: string | number) => {
    const d = devices.find((x) => x.id === id);
    return d ? splitName(d).primary : "device";
  };
  const position = (id: string | number) => ids.indexOf(String(id)) + 1;

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, priority ${position(active.id)} of ${ids.length}.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} moved to priority ${position(over.id)}.` : `${nameOf(active.id)} is no longer over the list.`),
    onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} dropped at priority ${position(over.id)}.` : `${nameOf(active.id)} dropped.`),
    onDragCancel: ({ active }) => `Reordering cancelled. ${nameOf(active.id)} returned to priority ${position(active.id)}.`,
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    setSettling(true);
    window.setTimeout(() => setSettling(false), 400);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    reorderVisible(flow, arrayMove(ids, from, to));
  };

  return (
    <section aria-labelledby={`priority-title-${flow}`}>
      <ZineHeading
        id={`priority-title-${flow}`}
        title="Setlist"
        note={`Drag to rank · ${connectedCount} connected · best one ${flow === "input" ? "records" : "plays"}`}
        aside={
          <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-fg-3">
            Show disconnected
            <Switch label="Show disconnected devices" checked={showDisconnected} onCheckedChange={(v) => updateSettings({ showDisconnected: v })} />
          </label>
        }
      />

      {ranked.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[14px] border-[1.6px] border-dashed border-[var(--line-strong)] px-6 py-12 text-center">
          {flow === "input" ? <Critter name="mikey" clip="hush" scale={5} /> : <Critter name="bun" clip="worried" scale={5} />}
          <p className="mt-2 text-[18px] font-extrabold tracking-[-0.03em] text-fg">{text.emptyTitle}</p>
          <p className="max-w-sm text-[13px] text-fg-3">{text.emptyText}</p>
          <div className="mt-1 flex gap-2">
            <Button size="sm" onClick={() => send({ type: "openSettings", page: "bluetooth" })}>
              Bluetooth settings
            </Button>
            <Button size="sm" variant="ghost" onClick={() => updateSettings({ showDisconnected: true })}>
              Show disconnected
            </Button>
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
          accessibility={{ announcements, screenReaderInstructions: { draggable: "To reorder, press space or enter, use the arrow keys to move, and press space again to drop. Press escape to cancel." } }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <motion.ul layout className="flex flex-col border-b-2 border-dotted border-[var(--line-strong)] pt-1" aria-label={`${text.noun[0].toUpperCase()}${text.noun.slice(1)} priority, highest first`}>
              <AnimatePresence initial={true}>
                {ranked.map((d, i) => (
                  <motion.li
                    key={d.id}
                    className="list-none"
                    layout={activeId || settling ? false : "position"}
                    initial={{ opacity: 0, y: 18, rotate: 0.6 }}
                    animate={{ opacity: 1, y: 0, rotate: 0, transition: { type: "spring", stiffness: 260, damping: 28, delay: 0.15 + Math.min(i, 10) * 0.06 } }}
                    exit={{ opacity: 0, height: 0, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
                  >
                    <SortableDeviceCard device={d} flow={flow} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 240, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }}>{active ? <DeviceCard device={active} flow={flow} overlay /> : null}</DragOverlay>
        </DndContext>
      )}

      {ignored.length > 0 && (
        <div className="mt-5">
          <button
            onClick={() => setIgnoredOpen((v) => !v)}
            aria-expanded={ignoredOpen}
            className="font-pixel flex items-center gap-2 rounded-lg px-1 py-1 text-[10.5px] text-fg-3 hover:text-fg"
          >
            <ChevronDown size={15} className={ignoredOpen ? "rotate-0 transition-transform" : "-rotate-90 transition-transform"} />
            {flow === "input" ? "Virtual inputs" : "Hands-Free & virtual endpoints"} ({ignored.length})
            <span className="text-fg-4">· ignored by default</span>
          </button>
          <AnimatePresence initial={false}>
            {ignoredOpen && (
              <motion.ul
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="mt-3 flex flex-col overflow-hidden"
              >
                {ignored.map((d) => (
                  <li key={d.id} className="list-none">
                    <DeviceCard device={d} flow={flow} sortable={false} />
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
