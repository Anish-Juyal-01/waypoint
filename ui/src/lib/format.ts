import type { ConnectionType, DeviceView, EndpointState, Flow, SwitchMode } from "../bridge/protocol";

export const connectionLabel: Record<ConnectionType, string> = {
  bluetooth: "Bluetooth",
  bluetoothHandsFree: "Hands-Free",
  usb: "USB",
  builtIn: "Built-in",
  display: "HDMI / DP",
  virtual: "Virtual",
  other: "Wired",
};

export const modeMeta: Record<SwitchMode, { label: string; tagline: string; description: string }> = {
  off: {
    label: "Off",
    tagline: "Monitor only",
    description: "Waypoint watches your devices but never switches on its own. Manual switching still works.",
  },
  balanced: {
    label: "Balanced",
    tagline: "Smart, respectful",
    description: "Switches when devices connect or disconnect. If you change the output yourself, Waypoint respects it until the next device connects.",
  },
  strict: {
    label: "Strict",
    tagline: "Priority always wins",
    description: "Your ranking is enforced at all times. Changes made outside Waypoint are reverted instantly.",
  },
};

/** Copy that differs between the output and microphone pages. */
export const flowText: Record<Flow, { noun: string; plural: string; nowLabel: string; playingBadge: string; emptyTitle: string; emptyText: string }> = {
  output: {
    noun: "output",
    plural: "outputs",
    nowLabel: "Now playing on",
    playingBadge: "Playing",
    emptyTitle: "No devices connected",
    emptyText: "Connect your earbuds, headphones or speakers and they'll appear here instantly.",
  },
  input: {
    noun: "microphone",
    plural: "microphones",
    nowLabel: "Recording from",
    playingBadge: "In use",
    emptyTitle: "No microphones connected",
    emptyText: "Plug in a USB mic or connect a headset and it will appear here instantly.",
  },
};

export function percent(v: number) {
  return `${Math.round(v * 100)}%`;
}

export function isAvailable(d: DeviceView) {
  return d.state === "active";
}

export function stateLabel(state: EndpointState): string {
  switch (state) {
    case "active":
      return "Connected";
    case "disabled":
      return "Disabled";
    case "unplugged":
      return "Disconnected";
    default:
      return "Not present";
  }
}

/** "Headphones (OnePlus Nord Buds 3 Pro)" → { primary: "OnePlus Nord Buds 3 Pro", secondary: "Headphones" } */
function rawSplit(d: DeviceView): { primary: string; secondary: string } {
  if (d.alias) return { primary: d.alias, secondary: d.friendlyName };
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(d.friendlyName);
  if (m) return { primary: m[2], secondary: m[1] };
  return { primary: d.friendlyName, secondary: d.description };
}

const displayNames = new WeakMap<DeviceView, { primary: string; secondary: string }>();

/**
 * Computes display names for a whole device list. One adapter often exposes several endpoints
 * ("Speaker (Realtek(R) Audio)" and "Headphone (Realtek(R) Audio)"); those get the endpoint type
 * appended so every row stays unambiguous.
 */
export function assignDisplayNames(devices: DeviceView[]) {
  const raw = devices.map(rawSplit);
  const counts = new Map<string, number>();
  raw.forEach((r) => counts.set(r.primary, (counts.get(r.primary) ?? 0) + 1));
  devices.forEach((d, i) => {
    const r = raw[i];
    const duplicate = !d.alias && (counts.get(r.primary) ?? 0) > 1 && r.secondary;
    displayNames.set(d, duplicate ? { primary: `${r.primary} ${r.secondary}`, secondary: r.secondary } : r);
  });
}

export function splitName(d: DeviceView): { primary: string; secondary: string } {
  return displayNames.get(d) ?? rawSplit(d);
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(iso).toLocaleDateString();
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}
