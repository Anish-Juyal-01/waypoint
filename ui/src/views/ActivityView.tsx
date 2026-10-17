import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRightLeft,
  CircleAlert,
  CircleCheck,
  Download,
  Hand,
  Info,
  ListOrdered,
  Mic,
  Plug,
  Power,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
  TriangleAlert,
  Undo2,
  Unplug,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ActivityEntry, ActivityKind } from "../bridge/protocol";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Critter } from "../pals/Critter";
import { Button, Eyebrow } from "../components/ui";
import { clockTime, dayLabel } from "../lib/format";
import { useApp } from "../store/store";
import { PageHeader } from "./PageHeader";

type Filter = "all" | "switches" | "connections" | "issues";

const filters: { id: Filter; label: string; kinds: ActivityKind[] | null }[] = [
  { id: "all", label: "All", kinds: null },
  { id: "switches", label: "Switches", kinds: ["switched", "switchFailed", "reverted", "override", "restored", "externalChange"] },
  { id: "connections", label: "Connections", kinds: ["connected", "disconnected", "discovered"] },
  { id: "issues", label: "Issues", kinds: ["switchFailed", "warning"] },
];

const kindStyle: Record<ActivityKind, { icon: typeof Info; color: string }> = {
  connected: { icon: Plug, color: "var(--color-tx-mint)" },
  disconnected: { icon: Unplug, color: "var(--color-fg-3)" },
  discovered: { icon: Sparkles, color: "var(--color-tx-lime)" },
  switched: { icon: CircleCheck, color: "var(--color-tx-lime)" },
  switchFailed: { icon: CircleAlert, color: "var(--color-tx-coral)" },
  externalChange: { icon: ArrowRightLeft, color: "var(--color-tx-sky)" },
  reverted: { icon: Undo2, color: "var(--color-tx-coral)" },
  override: { icon: Hand, color: "var(--color-tx-sky)" },
  restored: { icon: RotateCcw, color: "var(--color-tx-lime)" },
  modeChanged: { icon: Power, color: "var(--color-tx-violet)" },
  priorityChanged: { icon: ListOrdered, color: "var(--color-fg-2)" },
  settings: { icon: Settings2, color: "var(--color-fg-2)" },
  warning: { icon: TriangleAlert, color: "var(--color-tx-sun)" },
  info: { icon: Info, color: "var(--color-fg-2)" },
};

export function ActivityView() {
  const activity = useApp((s) => s.activity);
  const send = useApp((s) => s.send);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const groups = useMemo(() => {
    const kinds = filters.find((f) => f.id === filter)!.kinds;
    const list = activity.filter((a) => !kinds || kinds.includes(a.kind)).slice().reverse();
    const map = new Map<string, ActivityEntry[]>();
    for (const a of list) {
      const key = dayLabel(a.time);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return [...map.entries()];
  }, [activity, filter]);

  const counts = useMemo(
    () => Object.fromEntries(filters.map((f) => [f.id, f.kinds ? activity.filter((a) => f.kinds!.includes(a.kind)).length : activity.length])) as Record<Filter, number>,
    [activity],
  );

  return (
    <>
      <PageHeader
        title="Activity"
        accent="var(--color-sun)"
        subtitle="Every connection, switch and decision Waypoint made — verified results only."
        actions={
          <>
            <Button size="sm" icon={<Download size={14} />} onClick={() => send({ type: "exportLog" })} disabled={activity.length === 0}>
              Export
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirmClear(true)} disabled={activity.length === 0}>
              Clear
            </Button>
          </>
        }
      />

      <div role="tablist" aria-label="Filter activity" className="mb-6 flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={clsx(
              "press relative flex h-9 items-center gap-2 rounded-[10px] border-[1.6px] px-3.5 text-[13px] font-bold tracking-[-0.01em]",
              filter === f.id ? "border-fg text-on-accent" : "border-[var(--line-strong)] text-fg-2 hover:border-fg hover:text-fg",
            )}
          >
            {filter === f.id && <motion.span layoutId="activity-filter" className="absolute inset-[-1.6px] rounded-[10px] bg-sun" transition={{ type: "spring", stiffness: 520, damping: 36 }} />}
            <span className="relative">{f.label}</span>
            <span className={clsx("font-pixel relative text-[10px]", filter === f.id ? "text-on-accent/70" : "text-fg-4")}>{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[14px] border-[1.6px] border-dashed border-[var(--line-strong)] px-6 py-14 text-center">
          <Critter name="owlet" clip="idle" scale={4} />
          <p className="mt-2 text-[18px] font-extrabold tracking-[-0.03em] text-fg">Nothing here yet</p>
          <p className="max-w-sm text-[13px] text-fg-3">Connect or disconnect a device and Waypoint will log what it did.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map(([day, entries]) => (
            <section key={day} aria-label={day}>
              <h2 className="mb-3">
                <Eyebrow color="var(--color-sun)">{day}</Eyebrow>
              </h2>
              <ol className="surface relative overflow-hidden py-1">
                <AnimatePresence initial={false}>
                  {entries.map((a) => {
                    const { icon: Icon, color } = kindStyle[a.kind] ?? kindStyle.info;
                    return (
                      <motion.li
                        key={a.id || a.time}
                        layout="position"
                        initial={{ opacity: 0, clipPath: "inset(0 100% 0 0)" }}
                        animate={{ opacity: 1, clipPath: "inset(0 0% 0 0)" }}
                        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                        className="group relative flex items-start gap-3.5 border-b-2 border-dotted border-[var(--line-strong)] px-4 py-3 last:border-b-0 hover:bg-fg/[0.02]"
                      >
                        <span className="mt-[1px] grid size-8 shrink-0 place-items-center rounded-[8px] border-[1.6px]" style={{ borderColor: color, color }}>
                          <Icon size={15} strokeWidth={2.4} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 text-[14px] font-bold tracking-[-0.015em] text-fg">
                            {a.title}
                            {a.flow === "capture" && (
                              <span className="font-pixel inline-flex h-[18px] items-center gap-1 rounded-[5px] bg-sky px-1.5 text-[9px] text-on-accent">
                                <Mic size={10} strokeWidth={2.6} /> Mic
                              </span>
                            )}
                          </p>
                          {a.detail && <p className="mt-0.5 text-[13px] leading-relaxed text-fg-3">{a.detail}</p>}
                        </div>
                        <time dateTime={a.time} className="font-pixel mt-1 shrink-0 text-[10px] text-fg-4">
                          {clockTime(a.time)}
                        </time>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ol>
            </section>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear activity log?"
        description="This permanently removes all activity history from this PC."
        confirmLabel="Clear log"
        danger
        onConfirm={() => send({ type: "clearLog" })}
      />
    </>
  );
}
