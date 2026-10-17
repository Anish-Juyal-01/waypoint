import clsx from "clsx";
import { AudioLines, Cable, Headphones, Headset, Mic, Monitor, Speaker } from "lucide-react";
import type { DeviceKind } from "../bridge/protocol";

/** Lucide has no earbuds glyph; this one is drawn on the same 24px / 2px-stroke grid. */
function Earbuds({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="7" cy="7.5" r="3.5" />
      <path d="M9.5 10v8.5" />
      <circle cx="17" cy="7.5" r="3.5" />
      <path d="M14.5 10v8.5" />
    </svg>
  );
}

const kindIcon = {
  earbuds: Earbuds,
  headphones: Headphones,
  headset: Headset,
  speakers: Speaker,
  display: Monitor,
  lineOut: Cable,
  digital: AudioLines,
  microphone: Mic,
  other: AudioLines,
} satisfies Record<DeviceKind, unknown>;

/** Per-kind colour so cards are recognisable at a glance (flat pixel palette, no gradients). */
const kindColor: Record<DeviceKind, string> = {
  earbuds: "lime",
  headphones: "violet",
  headset: "coral",
  speakers: "sun",
  display: "sky",
  lineOut: "",
  digital: "",
  microphone: "sky",
  other: "",
};

export function DeviceIcon({ kind, size = 20, className }: { kind: DeviceKind; size?: number; className?: string }) {
  const Icon = kindIcon[kind] ?? AudioLines;
  return <Icon className={className} size={size} strokeWidth={2.2} />;
}

export function DeviceTile({ kind, dim, active, size = "md" }: { kind: DeviceKind; dim?: boolean; active?: boolean; size?: "sm" | "md" | "lg" }) {
  const name = kindColor[kind];
  // Fill uses the accent; outline/icon use the theme-aware text shade.
  const fill = name ? `var(--color-${name})` : "var(--color-neutral)";
  const color = name ? `var(--color-tx-${name})` : "var(--color-fg-2)";
  return (
    <div
      className={clsx(
        "relative grid shrink-0 place-items-center border-[1.6px] transition-colors duration-200",
        size === "lg" ? "size-16 rounded-[14px]" : size === "sm" ? "size-8 rounded-[8px]" : "size-11 rounded-[11px]",
        dim && "border-dashed border-fg-4 text-fg-4",
      )}
      style={dim ? undefined : active ? { background: fill, borderColor: "var(--color-fg)", color: "var(--color-on-accent)" } : { borderColor: color, color }}
    >
      <DeviceIcon kind={kind} size={size === "lg" ? 30 : size === "sm" ? 15 : 20} />
    </div>
  );
}
