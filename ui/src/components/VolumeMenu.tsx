import * as Popover from "@radix-ui/react-popover";
import * as Slider from "@radix-ui/react-slider";
import clsx from "clsx";
import { SlidersVertical } from "lucide-react";
import { useEffect, useState } from "react";
import type { DeviceView, Flow } from "../bridge/protocol";
import { percent } from "../lib/format";
import { useApp } from "../store/store";
import { Switch, Tooltip } from "./ui";
import { VolumeControl } from "./VolumeControl";

/**
 * Per-device volume popover: live volume/mute (connected devices) and the optional
 * "set volume when Waypoint switches to this device" level.
 */
export function VolumeMenu({ device, flow, label }: { device: DeviceView; flow: Flow; label: string }) {
  const send = useApp((s) => s.send);
  const enabled = device.switchVolume !== null;
  const [level, setLevel] = useState(device.switchVolume ?? 0.4);
  useEffect(() => {
    if (device.switchVolume !== null) setLevel(device.switchVolume);
  }, [device.switchVolume]);

  return (
    <Popover.Root>
      <Tooltip content={enabled ? `Volume · set to ${percent(device.switchVolume!)} on switch` : "Volume"}>
        <Popover.Trigger asChild>
          <button
            aria-label={`Volume options for ${label}`}
            className={clsx(
              "relative grid size-8 place-items-center rounded-[9px] transition-colors hover:bg-fg/[0.07] hover:text-fg data-[state=open]:bg-fg/[0.08] data-[state=open]:text-fg",
              enabled ? "text-tx-sky" : "text-fg-3",
            )}
          >
            <SlidersVertical size={15} />
            {enabled && <span className="absolute top-1 right-1 size-[6px] bg-sky" />}
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="surface-raised z-50 w-[310px] rounded-[14px] p-4 outline-none"
        >
          <p className="truncate text-[15px] font-extrabold tracking-[-0.02em] text-fg">{label}</p>

          <div className="mt-3">
            <p className="font-pixel mb-2 text-[10px] text-fg-4">Current volume</p>
            {device.volume ? (
              <VolumeControl deviceId={device.id} volume={device.volume} flow={flow} label={label} />
            ) : (
              <p className="text-[12.5px] text-fg-3">Connect the device to adjust its volume.</p>
            )}
          </div>

          <div className="mt-4 border-t-[1.6px] border-[var(--line)] pt-4">
            <label className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-[13px] font-medium text-fg">Set volume when switched to</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-fg-3">
                  Whenever Waypoint makes this the default, set its volume first. Windows still remembers volume per device on its own.
                </p>
              </div>
              <Switch
                label="Set volume when switched to"
                checked={enabled}
                onCheckedChange={(v) => send({ type: "setSwitchVolume", id: device.id, level: v ? level : null })}
              />
            </label>
            <div className={clsx("mt-3 flex items-center gap-3 transition-opacity", !enabled && "pointer-events-none opacity-35")}>
              <Slider.Root
                className="relative flex h-5 flex-1 touch-none items-center select-none"
                min={0}
                max={1}
                step={0.01}
                value={[level]}
                disabled={!enabled}
                onValueChange={([v]) => setLevel(v)}
                onValueCommit={([v]) => send({ type: "setSwitchVolume", id: device.id, level: v })}
                aria-label="Volume to apply when switched to"
              >
                <Slider.Track className="px-track">
                  <Slider.Range className="px-range px-range-sky" />
                </Slider.Track>
                <Slider.Thumb className="px-thumb" />
              </Slider.Root>
              <span className="w-10 text-right font-mono text-[12px] tabular-nums text-fg-2">{percent(level)}</span>
            </div>
          </div>
          <Popover.Arrow className="fill-fg" width={12} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
