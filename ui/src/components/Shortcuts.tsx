import clsx from "clsx";
import { AlertTriangle, Keyboard, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { HotkeyAction, HotkeyView } from "../bridge/protocol";
import { bindingFromEvent, bindingParts, hotkeyMeta, hotkeyOrder } from "../lib/hotkeys";
import { useApp } from "../store/store";
import { Button, IconButton, Kbd, SectionTitle, Switch, Tooltip } from "./ui";

/** Settings group listing every global shortcut with a click-to-record editor. */
export function ShortcutsGroup() {
  const hotkeys = useApp((s) => s.snapshot!.hotkeys);
  const enabled = useApp((s) => s.snapshot!.settings.hotkeysEnabled);
  const update = useApp((s) => s.updateSettings);
  const send = useApp((s) => s.send);
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  const byAction = new Map(hotkeys.map((h) => [h.action, h] as const));
  const conflicts = hotkeys.filter((h) => h.status === "conflict").length;

  return (
    <section className="mb-7">
      <SectionTitle
        color="var(--color-sun)"
        aside={
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => send({ type: "resetHotkeys" })}>
            Restore defaults
          </Button>
        }
      >
        Keyboard shortcuts
      </SectionTitle>
      <div className="surface divide-y-2 divide-dotted divide-[var(--line-strong)]">
        <div className="flex items-center gap-6 px-5 py-4">
          <div className="min-w-0 flex-1">
            <label htmlFor="hotkeysEnabled" className="text-[14px] font-bold tracking-[-0.015em] text-fg">
              Global shortcuts
            </label>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-3">
              Work everywhere, even when Waypoint is in the tray.
              {conflicts > 0 && <span className="text-warn"> {conflicts} shortcut{conflicts > 1 ? "s are" : " is"} already used by another app — pick a different combination.</span>}
            </p>
          </div>
          <Switch id="hotkeysEnabled" label="Global shortcuts" checked={enabled} onCheckedChange={(v) => update({ hotkeysEnabled: v })} />
        </div>
        {hotkeyOrder.map((action) => (
          <ShortcutRow
            key={action}
            view={byAction.get(action) ?? { action, binding: null, status: "unbound" }}
            disabled={!enabled}
            recording={recording === action}
            onRecord={(on) => setRecording(on ? action : null)}
          />
        ))}
      </div>
    </section>
  );
}

function ShortcutRow({ view, disabled, recording, onRecord }: { view: HotkeyView; disabled: boolean; recording: boolean; onRecord: (on: boolean) => void }) {
  const send = useApp((s) => s.send);
  const [error, setError] = useState<string | null>(null);
  const meta = hotkeyMeta[view.action];
  const onRecordRef = useRef(onRecord);
  onRecordRef.current = onRecord;

  // While recording, global hotkeys are released so pressing an existing combination reaches the page.
  useEffect(() => {
    if (!recording) return;
    send({ type: "hotkeyRecording", active: true });
    setError(null);
    const stop = () => onRecordRef.current(false);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape" && !e.ctrlKey && !e.altKey) return stop();
      if ((e.code === "Backspace" || e.code === "Delete") && !e.ctrlKey && !e.altKey) {
        send({ type: "setHotkey", action: view.action, binding: null });
        return stop();
      }

      const result = bindingFromEvent(e);
      if (!result) return;
      if ("error" in result) return setError(result.error);
      send({ type: "setHotkey", action: view.action, binding: result });
      stop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      send({ type: "hotkeyRecording", active: false });
    };
  }, [recording, send, view.action]);

  return (
    <div className={clsx("flex items-center gap-4 px-5 py-3.5", disabled && "opacity-50")}>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold tracking-[-0.015em] text-fg">{meta.title}</p>
        <p className={clsx("mt-0.5 text-[12.5px]", error ? "text-warn" : "text-fg-3")}>{error ?? meta.description}</p>
      </div>

      {view.status === "conflict" && !recording && (
        <Tooltip content="Another program already registered this combination, so Windows gave it to them. Choose a different one.">
          <span className="font-pixel flex items-center gap-1 text-[10px] text-tx-sun">
            <AlertTriangle size={14} /> In use
          </span>
        </Tooltip>
      )}

      <button
        disabled={disabled}
        onClick={() => onRecord(!recording)}
        aria-label={recording ? `Recording shortcut for ${meta.title}. Press keys, Escape to cancel, Backspace to clear.` : `Change shortcut for ${meta.title}`}
        className={clsx(
          "flex h-10 min-w-[160px] items-center justify-center gap-1 rounded-[10px] border-[1.6px] px-3 transition-colors",
          recording ? "border-tx-lime bg-lime text-on-accent" : "border-[var(--line-strong)] bg-ink-900 hover:border-fg",
        )}
      >
        {recording ? (
          <span className="font-pixel flex items-center gap-2 text-[10.5px]">
            <Keyboard size={14} className="animate-pulse-soft" /> Press keys…
          </span>
        ) : view.binding ? (
          bindingParts(view.binding).map((p, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-[11px] text-fg-4">+</span>}
              <Kbd>{p}</Kbd>
            </span>
          ))
        ) : (
          <span className="font-pixel text-[10px] text-fg-4">Not set</span>
        )}
      </button>

      <IconButton label="Clear shortcut" disabled={disabled || !view.binding} onClick={() => send({ type: "setHotkey", action: view.action, binding: null })}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
