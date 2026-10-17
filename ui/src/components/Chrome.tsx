import clsx from "clsx";
import { motion } from "motion/react";
import { Copy, History, Mic, Minus, SlidersHorizontal, Speaker, Square, X } from "lucide-react";
import type { MouseEvent } from "react";
import { bridge } from "../bridge/bridge";
import type { ResizeEdge } from "../bridge/protocol";
import { selectCurrent, useApp, type View } from "../store/store";
import { modeMeta, splitName } from "../lib/format";
import { spring } from "../lib/motion";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

/** Starts a native move/resize loop in the host (keeps Aero Snap working). */
function startDrag(e: MouseEvent, edge: ResizeEdge) {
  if (e.button !== 0) return;
  e.preventDefault();
  bridge.send({ type: "window", action: "drag", edge });
}

const tabs: { view: View; label: string; icon: typeof Speaker; shortcut: string }[] = [
  { view: "devices", label: "Devices", icon: Speaker, shortcut: "1" },
  { view: "microphones", label: "Microphones", icon: Mic, shortcut: "2" },
  { view: "activity", label: "Activity", icon: History, shortcut: "3" },
  { view: "settings", label: "Settings", icon: SlidersHorizontal, shortcut: "4" },
];

/**
 * Zine masthead: overprinted wordmark and an "issue" line (profile · mode · what's playing), window controls,
 * and paper tabs sitting on the masthead rule for navigation. Empty areas drag the window.
 */
export function TitleBar({ compact }: { compact?: boolean }) {
  const maximized = useApp((s) => s.maximized);
  const snapshot = useApp((s) => s.snapshot);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const current = useApp(selectCurrent("output"));
  const unreadWarnings = useApp((s) => s.activity.filter((a) => a.id > s.seenActivityId && (a.kind === "switchFailed" || a.kind === "warning")).length);
  const mode = snapshot?.output.mode;
  const profileIndex = snapshot ? snapshot.profiles.findIndex((p) => p.id === snapshot.activeProfileId) : -1;
  const profile = profileIndex >= 0 ? snapshot!.profiles[profileIndex] : null;

  return (
    <header
      className="relative z-20 shrink-0 border-b-2 border-fg bg-ink-900 pl-5"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        startDrag(e, "caption");
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        bridge.send({ type: "window", action: "maximize" });
      }}
    >
      <div className="flex h-[54px] items-center">
        <div className="flex min-w-0 items-end gap-3 pt-1">
          <Logo size={24} />
          <Wordmark />
          {snapshot && !compact && (
            <span className="font-pixel mb-[3px] truncate text-[10.5px] text-fg-3">
              No. {String(profileIndex + 1).padStart(2, "0")} · {profile?.name ?? "—"} · {mode ? modeMeta[mode].label : "—"}
              {current && <span className="text-fg-4"> · on {splitName(current).primary}</span>}
            </span>
          )}
        </div>

        <div className="flex-1" />

        <div className="mr-3">
          <ThemeToggle />
        </div>

        <div className="flex h-[54px] items-stretch self-start" role="group" aria-label="Window controls">
          <WindowButton label="Minimize" onClick={() => bridge.send({ type: "window", action: "minimize" })}>
            <Minus size={15} strokeWidth={1.6} />
          </WindowButton>
          <WindowButton label={maximized ? "Restore" : "Maximize"} onClick={() => bridge.send({ type: "window", action: "maximize" })}>
            {maximized ? <Copy size={12} strokeWidth={1.6} className="-scale-x-100" /> : <Square size={11.5} strokeWidth={1.6} />}
          </WindowButton>
          <WindowButton label="Close to tray" danger onClick={() => bridge.send({ type: "window", action: "close" })}>
            <X size={16} strokeWidth={1.6} />
          </WindowButton>
        </div>
      </div>

      {snapshot && (
        <nav aria-label="Main" className="flex items-end gap-1 pt-1">
          {tabs.map(({ view: v, label, icon: Icon, shortcut }) => {
            const selected = view === v;
            return (
              <button key={v} className="tab" onClick={() => setView(v)} aria-current={selected ? "page" : undefined} title={`${label} (Ctrl+${shortcut})`}>
                {selected && <motion.span layoutId="tab-fill" className="tab-fill" transition={spring} />}
                <Icon size={15} strokeWidth={2.3} className="relative" />
                <span className={clsx("relative", compact && "sr-only")}>{label}</span>
                {v === "activity" && unreadWarnings > 0 && (
                  <span className="font-pixel relative grid h-[18px] min-w-[18px] place-items-center rounded-full bg-coral px-1 text-[10px] text-on-accent">{unreadWarnings}</span>
                )}
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}

function WindowButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx(
        "grid w-[46px] place-items-center text-fg-2 transition-colors duration-100",
        danger ? "hover:bg-coral hover:text-on-accent" : "hover:bg-fg/[0.07] hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/** Invisible 5px resize handles around the borderless window. */
export function ResizeEdges() {
  const maximized = useApp((s) => s.maximized);
  if (maximized || bridge.isPreview) return null;
  const E = 5;
  const edges: { edge: ResizeEdge; style: React.CSSProperties; cursor: string }[] = [
    { edge: "top", style: { top: 0, left: E, right: E, height: E }, cursor: "ns-resize" },
    { edge: "bottom", style: { bottom: 0, left: E, right: E, height: E }, cursor: "ns-resize" },
    { edge: "left", style: { left: 0, top: E, bottom: E, width: E }, cursor: "ew-resize" },
    { edge: "right", style: { right: 0, top: E, bottom: E, width: E }, cursor: "ew-resize" },
    { edge: "top-left", style: { top: 0, left: 0, width: E * 2, height: E * 2 }, cursor: "nwse-resize" },
    { edge: "bottom-right", style: { bottom: 0, right: 0, width: E * 2, height: E * 2 }, cursor: "nwse-resize" },
    { edge: "top-right", style: { top: 0, right: 0, width: E * 2, height: E * 2 }, cursor: "nesw-resize" },
    { edge: "bottom-left", style: { bottom: 0, left: 0, width: E * 2, height: E * 2 }, cursor: "nesw-resize" },
  ];
  return (
    <>
      {edges.map(({ edge, style, cursor }) => (
        <div key={edge} aria-hidden className="fixed z-[100]" style={{ ...style, cursor }} onMouseDown={(e) => startDrag(e, edge)} />
      ))}
    </>
  );
}
