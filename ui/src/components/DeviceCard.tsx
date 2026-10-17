import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { Bluetooth, Check, GripVertical, Pencil, Play, Usb, X } from "lucide-react";
import { forwardRef, useEffect, useRef, useState, type HTMLAttributes } from "react";
import type { DeviceView, Flow } from "../bridge/protocol";
import { connectionLabel, flowText, isAvailable, relativeTime, splitName, stateLabel } from "../lib/format";
import { useApp } from "../store/store";
import { MiniVu } from "./Pixel";
import { Badge, Button, IconButton, Switch, Tooltip } from "./ui";
import { VolumeMenu } from "./VolumeMenu";

interface CardProps {
  device: DeviceView;
  flow: Flow;
  /** Rendered inside the DragOverlay (floating copy). */
  overlay?: boolean;
  /** The original stays in place as a dashed slot while its copy is dragged. */
  placeholder?: boolean;
  handleProps?: HTMLAttributes<HTMLElement> & { ref?: (el: HTMLElement | null) => void };
  sortable?: boolean;
}

export function SortableDeviceCard({ device, flow, sortable = true }: { device: DeviceView; flow: Flow; sortable?: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: device.id,
    disabled: !sortable,
  });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <DeviceCard
        device={device}
        flow={flow}
        placeholder={isDragging}
        sortable={sortable}
        handleProps={{ ...attributes, ...listeners, ref: setActivatorNodeRef }}
      />
    </div>
  );
}

export const DeviceCard = forwardRef<HTMLDivElement, CardProps>(function DeviceCard({ device, flow, overlay, placeholder, handleProps, sortable = true }, ref) {
  const send = useApp((s) => s.send);
  const canSwitch = useApp((s) => s.snapshot?.canSwitch ?? false);
  const available = isAvailable(device);
  const name = splitName(device);
  const [editing, setEditing] = useState(false);
  const skipped = device.excluded || device.autoExcluded;
  const muted = !!device.volume?.muted;

  return (
    <div
      ref={ref}
      className={clsx(
        "set-row group relative flex flex-wrap items-center gap-x-4 gap-y-2 pr-2",
        available || overlay ? "py-3.5" : "py-2",
        "transition-[transform,opacity,background-color] duration-300 [transition-timing-function:var(--ease-spring)]",
        !overlay && !placeholder && "hover:translate-x-[6px]",
        !available && !overlay && "opacity-55 hover:opacity-90",
        placeholder && "rounded-[14px] !border-2 !border-dashed !border-tx-lime [&>*]:opacity-0",
        overlay && "cursor-grabbing rounded-[16px] !border-2 !border-solid !border-fg bg-ink-800 px-3 shadow-[6px_8px_0_0_var(--color-lime)] [transform:rotate(-1.2deg)_scale(1.02)]",
      )}
    >
      {/* Drag handle + rank */}
      <button
        type="button"
        {...handleProps}
        disabled={!sortable}
        aria-label={`Reorder ${name.primary}, priority ${device.rank}. Press space to pick up, arrow keys to move.`}
        className={clsx(
          "flex items-center gap-1 rounded-[10px] pr-1 text-fg-4 transition-colors",
          sortable ? "cursor-grab hover:text-fg-2 active:cursor-grabbing" : "cursor-default",
          overlay && "cursor-grabbing",
        )}
      >
        <GripVertical size={16} className={clsx("transition-opacity", !sortable ? "opacity-0" : "opacity-40 group-hover:opacity-100")} />
        <span className={clsx("set-num w-[64px] text-left", available ? "text-[44px]" : "text-[30px]")} data-live={device.isDefault}>
          {String(device.rank).padStart(2, "0")}
        </span>
      </button>

      {/* Name + meta */}
      <div className="min-w-0 flex-1 basis-[220px]">
        {editing ? (
          <RenameField device={device} onDone={() => setEditing(false)} />
        ) : (
          <div className="flex items-center gap-2">
            <span
              key={device.isDefault ? "live" : "idle"}
              className={clsx(
                "font-display truncate font-extrabold tracking-[-0.035em]",
                available ? "text-[21px] text-fg" : "text-[16px] text-fg-3",
                device.isDefault && "hl",
              )}
            >
              {name.primary}
            </span>
            {!available && device.lastConnected && <span className="font-pixel shrink-0 text-[10px] text-fg-4">· seen {relativeTime(device.lastConnected)}</span>}
            {!overlay && (
              <IconButton label="Rename" className="!size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setEditing(true)}>
                <Pencil size={12.5} />
              </IconButton>
            )}
          </div>
        )}
        <div className={clsx("font-pixel mt-1 flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-fg-3", available ? "flex" : "hidden")}>
          <span className="inline-flex items-center gap-1">
            {(device.connection === "bluetooth" || device.connection === "bluetoothHandsFree") && <Bluetooth size={12} strokeWidth={2.4} />}
            {device.connection === "usb" && <Usb size={12} strokeWidth={2.4} />}
            {connectionLabel[device.connection]}
          </span>
          <span className="text-fg-4">·</span>
          <span className="truncate">{name.secondary || device.description}</span>
        </div>
      </div>

      {/* Status + actions */}
      <div className="ml-auto flex items-center gap-2.5">
        {device.isDefault ? (
          <Badge tone="echo" className="!gap-2">
            {!muted && <MiniVu flow={flow} active className="vu-on-lime" />}
            {muted ? "Muted" : flowText[flow].playingBadge}
          </Badge>
        ) : available ? (
          <Badge tone="ok" dot>
            {stateLabel(device.state)}
          </Badge>
        ) : (
          <Badge>{stateLabel(device.state)}</Badge>
        )}

        {skipped && (
          <Tooltip content={device.autoExcluded ? "Ignored by a global rule (see Settings)." : "Excluded — Waypoint never switches to it automatically."}>
            <span>
              <Badge tone="warn">Skipped</Badge>
            </span>
          </Tooltip>
        )}

        {!overlay && (
          <div className="flex items-center gap-2.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <Button
              size="sm"
              variant="secondary"
              icon={<Play size={12} className="fill-current" />}
              disabled={!available || device.isDefault || !canSwitch}
              onClick={() => send({ type: "selectDevice", flow, id: device.id })}
              className={clsx("w-[92px]", (device.isDefault || !available) && "invisible")}
              aria-label={`Switch to ${name.primary} now`}
            >
              Use now
            </Button>
            <VolumeMenu device={device} flow={flow} label={name.primary} />
            <Tooltip content={device.autoExcluded ? "Ignored by a global rule (see Settings)" : device.excluded ? "Include in automatic switching" : "Exclude from automatic switching"}>
              <span className="inline-flex">
                <Switch
                  label={`Automatic switching for ${name.primary}`}
                  checked={!skipped}
                  disabled={device.autoExcluded}
                  onCheckedChange={(v) => send({ type: "setExcluded", flow, id: device.id, excluded: !v })}
                />
              </span>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
});

function RenameField({ device, onDone }: { device: DeviceView; onDone: () => void }) {
  const send = useApp((s) => s.send);
  const [value, setValue] = useState(device.alias ?? splitName(device).primary);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const save = () => {
    const trimmed = value.trim();
    const original = splitName({ ...device, alias: null }).primary;
    send({ type: "rename", id: device.id, alias: trimmed === "" || trimmed === original ? null : trimmed });
    onDone();
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={input}
        value={value}
        maxLength={64}
        aria-label="Device name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onDone();
          e.stopPropagation();
        }}
        onBlur={save}
        className="h-8 w-full max-w-[280px] rounded-[8px] border-[1.6px] border-tx-lime bg-ink-950 px-2.5 text-[15px] font-bold text-fg outline-none"
      />
      <IconButton label="Save name" onMouseDown={(e) => e.preventDefault()} onClick={save} className="!size-7">
        <Check size={14} />
      </IconButton>
      <IconButton label="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={onDone} className="!size-7">
        <X size={14} />
      </IconButton>
    </div>
  );
}
