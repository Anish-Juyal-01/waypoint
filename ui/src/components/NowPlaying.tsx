import { AnimatePresence, motion } from "motion/react";
import { Bluetooth, Cable, Monitor, RotateCcw, Usb } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import type { Flow, SwitchMode } from "../bridge/protocol";
import { Critter } from "../pals/Critter";
import type { CritterName } from "../pals/data";
import { MicChoir } from "../pals/Scenes";
import { ease } from "../lib/motion";
import { selectCurrent, useApp } from "../store/store";
import { connectionLabel, flowText, modeMeta, splitName } from "../lib/format";
import { Headline } from "./Headline";
import { Pal, PixelBurst } from "./Pixel";
import { StuckAppsNotice } from "./StuckApps";
import { Button } from "./ui";
import { LevelBars } from "./LevelBars";
import { VolumeControl } from "./VolumeControl";

const MODES: { mode: SwitchMode; critter: CritterName; clip: string; fill: string; hint: string }[] = [
  { mode: "off", critter: "puff", clip: "sleep", fill: "var(--color-neutral)", hint: "Watches, never switches." },
  { mode: "balanced", critter: "sprout", clip: "idle", fill: "var(--color-lime)", hint: "Follows your ranking, respects manual changes." },
  { mode: "strict", critter: "owlet", clip: "alarm", fill: "var(--color-sun)", hint: "Your ranking always wins; outside changes get reverted." },
];

/** Mode switch: three round "coins", each with its pal. A radiogroup with arrow-key support. */
function ModeSwitch({ flow }: { flow: Flow }) {
  const mode = useApp((s) => s.snapshot![flow].mode);
  const setMode = useApp((s) => s.setMode);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (i + d + MODES.length) % MODES.length;
    setMode(flow, MODES[next].mode);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <div role="radiogroup" aria-label={flow === "input" ? "Microphone switching mode" : "Switching mode"} className="flex gap-4">
        {MODES.map(({ mode: m, critter, clip, fill }, i) => {
          const selected = mode === m;
          return (
            <button
              key={m}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setMode(flow, m)}
              onKeyDown={(e) => onKey(e, i)}
              className="coin-btn relative flex flex-col items-center gap-1.5 rounded-[14px] focus-visible:outline-offset-4"
            >
              <PixelBurst trigger={selected ? m : null} count={10} distance={44} />
              <span className="coin" style={selected ? { background: fill } : undefined}>
                <Critter name={critter} clip={clip} scale={2} blink={selected} />
              </span>
              <span className={selected ? "text-[12.5px] font-bold text-fg" : "text-[12.5px] font-semibold text-fg-3"}>{modeMeta[m].label}</span>
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={mode}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: ease.out } }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          className="mt-3 text-[13px] text-fg-3"
        >
          {MODES.find((x) => x.mode === mode)!.hint}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function ConnectionIcon({ connection }: { connection: string }) {
  if (connection === "bluetooth" || connection === "bluetoothHandsFree") return <Bluetooth size={11} strokeWidth={2.6} />;
  if (connection === "usb") return <Usb size={11} strokeWidth={2.6} />;
  if (connection === "hdmi" || connection === "display") return <Monitor size={11} strokeWidth={2.6} />;
  return <Cable size={11} strokeWidth={2.6} />;
}

/**
 * The poster at the top of a device page, on a soft pink panel: the pal standing on two overlapping ink plates (a halftone sun and a
 * solid disc); the details sit in a paper card: the device headline with a rubber-stamped connection, then volume
 * the mode coins and "Back to #1".
 */
export function NowPlayingCard({ flow }: { flow: Flow }) {
  const snapshot = useApp((s) => s.snapshot)!;
  const current = useApp(selectCurrent(flow));
  const send = useApp((s) => s.send);
  const f = snapshot[flow];
  const text = flowText[flow];

  const override = f.override;
  const priorityTop = f.devices.find((d) => d.id === f.priorityTargetId);
  const name = current ? splitName(current) : null;
  const muted = !!current?.volume?.muted;
  // Only offer "back to #1" when it would actually change something.
  const canRestore = snapshot.canSwitch && (override !== null || (priorityTop && current?.id !== priorityTop.id));
  const title = name?.primary ?? `No ${text.noun}`;

  return (
    <section aria-labelledby={`now-${flow}`} className="np-panel grid grid-cols-[230px_minmax(0,1fr)] items-center gap-x-6 gap-y-4 p-5 max-[860px]:grid-cols-1">
      {/* Art: two plates + the pal */}
      <div className="relative h-[230px] w-[230px] max-[860px]:mx-auto" aria-hidden>
        <div className="ht-dots" style={{ width: 176, height: 176, left: 4, top: 40 }} />
        <div className="ink-disc" style={{ width: 132, height: 132, left: 80, top: 8, background: flow === "input" ? "var(--color-sky)" : "var(--color-lime)" }} />
        <div className="absolute" style={{ left: 50, top: 62 }}>
          <PixelBurst trigger={current?.id} count={12} distance={80} />
          {flow === "input" ? (
            <MicChoir muted={muted} absent={!current} scale={9} />
          ) : (
            <Pal flow={flow} scale={8} hopKey={current?.id ?? null} muted={muted} absent={!current} />
          )}
        </div>
      </div>

      {/* Details, held in their own paper card */}
      <div className="np-card min-w-0">
        <div className="flex flex-wrap items-center gap-3 px-6 pt-5">
          <span id={`now-${flow}`} className="font-pixel text-[11px] text-tx-lime">
            {text.nowLabel}
          </span>
          {current && (
            <span key={current.id} className="stamp">
              <ConnectionIcon connection={current.connection} />
              {connectionLabel[current.connection]}
            </span>
          )}
          {canRestore && (
            <Button variant="primary" size="sm" icon={<RotateCcw size={14} strokeWidth={2.4} />} onClick={() => send({ type: "restorePriority", flow })} className="ml-auto">
              Back to #1{priorityTop ? ` · ${splitName(priorityTop).primary}` : ""}
            </Button>
          )}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.h1
            key={current?.id ?? "none"}
            className="px-6 pt-2.5 pb-4 text-[clamp(30px,4.2vw,46px)]"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.7, ease: ease.out } }}
            exit={{ opacity: 0, y: -10, transition: { duration: 0.16, ease: ease.in } }}
          >
            <Headline text={title} />
          </motion.h1>
        </AnimatePresence>

        <div className="np-split">
          <div className="flex min-w-0 flex-col px-6 py-4">
            <div className="font-pixel mb-2.5 text-[10.5px] text-fg-3">Volume</div>
            {current?.volume ? (
              <div className="my-auto">
                <VolumeControl key={current.id} deviceId={current.id} volume={current.volume} flow={flow} label={name?.primary ?? text.noun} />
                <LevelBars flow={flow} active={!muted} className="mt-3.5" />
              </div>
            ) : (
              <p className="text-[13px] text-fg-4">Not available for this {text.noun}.</p>
            )}
          </div>
          <div className="min-w-0 px-6 py-4">
            <div className="font-pixel mb-2.5 text-[10.5px] text-fg-3">Mode</div>
            <ModeSwitch flow={flow} />
          </div>
        </div>

        {(flow === "input" && f.mode !== "off") || (!snapshot.canSwitch && snapshot.switchUnavailableReason) || (f.stuckApps?.length ?? 0) > 0 ? (
          <div className="np-foot px-6 py-4">
            {flow === "input" && f.mode !== "off" && (
              <p className="text-[12.5px] text-tx-sky">Tip: Bluetooth headset mics drop your earbuds into call quality — rank a USB or built-in mic first.</p>
            )}
            {!snapshot.canSwitch && snapshot.switchUnavailableReason && <p className="mt-1 text-[13px] text-tx-sun">{snapshot.switchUnavailableReason}</p>}
            <StuckAppsNotice flow={flow} apps={f.stuckApps ?? []} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
