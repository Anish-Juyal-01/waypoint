import * as Slider from "@radix-ui/react-slider";
import clsx from "clsx";
import { Mic, MicOff, Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Flow, VolumeInfo } from "../bridge/protocol";
import { percent } from "../lib/format";
import { useApp } from "../store/store";
import { Tooltip } from "./ui";

/**
 * Live master volume + mute for one endpoint (IAudioEndpointVolume on the host).
 * While dragging the slider is local; otherwise it follows the host so volume keys / the mixer show up here.
 */
export function VolumeControl({ deviceId, volume, flow, label, className }: { deviceId: string; volume: VolumeInfo; flow: Flow; label: string; className?: string }) {
  const send = useApp((s) => s.send);
  const [dragging, setDragging] = useState(false);
  const [local, setLocal] = useState(volume.level);
  const pending = useRef<number | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!dragging) setLocal(volume.level);
  }, [volume.level, dragging]);

  // Throttle to ~20 updates/s while dragging.
  const push = (level: number) => {
    pending.current = level;
    if (timer.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      if (pending.current !== null) send({ type: "setVolume", id: deviceId, level: pending.current });
      pending.current = null;
    }, 50);
  };

  const muted = volume.muted;
  const Icon = flow === "input" ? (muted ? MicOff : Mic) : muted || local === 0 ? VolumeX : local < 0.5 ? Volume1 : Volume2;

  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <Tooltip content={muted ? "Unmute" : "Mute"}>
        <button
          onClick={() => send({ type: "setMute", id: deviceId, muted: !muted })}
          aria-label={`${muted ? "Unmute" : "Mute"} ${label}`}
          aria-pressed={muted}
          className={clsx(
            "grid size-8 shrink-0 place-items-center rounded-[9px] transition-colors",
            muted ? "bg-coral text-on-accent" : "text-fg-2 hover:bg-fg/[0.07] hover:text-fg",
          )}
        >
          <Icon size={16} />
        </button>
      </Tooltip>
      <Slider.Root
        className={clsx("relative flex h-5 flex-1 touch-none items-center select-none", muted && "opacity-50")}
        min={0}
        max={1}
        step={0.01}
        value={[local]}
        onValueChange={([v]) => {
          setDragging(true);
          setLocal(v);
          push(v);
        }}
        onValueCommit={([v]) => {
          send({ type: "setVolume", id: deviceId, level: v });
          window.setTimeout(() => setDragging(false), 250);
        }}
        aria-label={`${label} volume`}
      >
        <Slider.Track className="px-track">
          <Slider.Range className="px-range" />
        </Slider.Track>
        <Slider.Thumb className="px-thumb" />
      </Slider.Root>
      <span className="font-pixel w-12 text-right text-[11px] text-fg">{muted ? "Muted" : percent(local)}</span>
    </div>
  );
}
