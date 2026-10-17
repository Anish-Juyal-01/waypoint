import { Mod, type HotkeyAction, type HotkeyBinding } from "../bridge/protocol";

/** KeyboardEvent.code → Windows virtual-key code (layout-independent physical keys). */
export function codeToVk(code: string): number | null {
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3); // 'A'..'Z' = 0x41..0x5A
  if (/^Digit[0-9]$/.test(code)) return 0x30 + Number(code[5]);
  if (/^Numpad[0-9]$/.test(code)) return 0x60 + Number(code[6]);
  const f = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (f) return 0x6f + Number(f[1]); // F1 = 0x70
  return named[code] ?? null;
}

const named: Record<string, number> = {
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Insert: 0x2d,
  Delete: 0x2e,
  NumpadMultiply: 0x6a,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d,
  NumpadDecimal: 0x6e,
  NumpadDivide: 0x6f,
  Semicolon: 0xba,
  Equal: 0xbb,
  Comma: 0xbc,
  Minus: 0xbd,
  Period: 0xbe,
  Slash: 0xbf,
  Backquote: 0xc0,
  BracketLeft: 0xdb,
  Backslash: 0xdc,
  BracketRight: 0xdd,
  Quote: 0xde,
  Pause: 0x13,
  ScrollLock: 0x91,
  MediaPlayPause: 0xb3,
  MediaTrackNext: 0xb0,
  MediaTrackPrevious: 0xb1,
};

const vkNames: Record<number, string> = {
  0x20: "Space",
  0x21: "Page Up",
  0x22: "Page Down",
  0x23: "End",
  0x24: "Home",
  0x25: "←",
  0x26: "↑",
  0x27: "→",
  0x28: "↓",
  0x2d: "Insert",
  0x2e: "Delete",
  0x6a: "Num *",
  0x6b: "Num +",
  0x6d: "Num −",
  0x6e: "Num .",
  0x6f: "Num /",
  0xba: ";",
  0xbb: "=",
  0xbc: ",",
  0xbd: "-",
  0xbe: ".",
  0xbf: "/",
  0xc0: "`",
  0xdb: "[",
  0xdc: "\\",
  0xdd: "]",
  0xde: "'",
  0x13: "Pause",
  0x91: "Scroll Lock",
  0xb3: "Play/Pause",
  0xb0: "Next Track",
  0xb1: "Prev Track",
};

export function vkLabel(vk: number): string {
  if (vk >= 0x41 && vk <= 0x5a) return String.fromCharCode(vk);
  if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk);
  if (vk >= 0x60 && vk <= 0x69) return `Num ${vk - 0x60}`;
  if (vk >= 0x70 && vk <= 0x87) return `F${vk - 0x6f}`;
  return vkNames[vk] ?? `Key ${vk}`;
}

/** ["Ctrl", "Alt", "F9"] */
export function bindingParts(b: HotkeyBinding): string[] {
  const parts: string[] = [];
  if (b.modifiers & Mod.Ctrl) parts.push("Ctrl");
  if (b.modifiers & Mod.Alt) parts.push("Alt");
  if (b.modifiers & Mod.Shift) parts.push("Shift");
  if (b.modifiers & Mod.Win) parts.push("Win");
  parts.push(vkLabel(b.key));
  return parts;
}

export function formatBinding(b: HotkeyBinding | null): string {
  return b ? bindingParts(b).join(" + ") : "Not set";
}

/**
 * Turns a keydown into a binding. Requires Ctrl or Alt (global shortcuts without them would steal
 * normal typing); Shift alone is allowed only with function keys. Returns null for modifier-only presses.
 */
export function bindingFromEvent(e: KeyboardEvent): HotkeyBinding | { error: string } | null {
  if (["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(e.code)) return null;
  const key = codeToVk(e.code);
  if (key === null) return { error: "That key can't be used for a shortcut." };
  let modifiers = 0;
  if (e.ctrlKey) modifiers |= Mod.Ctrl;
  if (e.altKey) modifiers |= Mod.Alt;
  if (e.shiftKey) modifiers |= Mod.Shift;
  if (e.metaKey) modifiers |= Mod.Win;
  const isFn = key >= 0x70 && key <= 0x87;
  if (!(modifiers & (Mod.Ctrl | Mod.Alt | Mod.Win)) && !(isFn && modifiers & Mod.Shift))
    return { error: "Add Ctrl or Alt so the shortcut doesn't interfere with typing." };
  return { modifiers, key };
}

export const hotkeyMeta: Record<HotkeyAction, { title: string; description: string }> = {
  nextOutput: { title: "Next output", description: "Switch to the next connected device in your priority list." },
  previousOutput: { title: "Previous output", description: "Switch to the previous connected device." },
  restorePriority: { title: "Restore priority", description: "Clear any manual pick and go back to your #1 device." },
  toggleMicMute: { title: "Mute / unmute microphone", description: "Toggles mute on the current default microphone." },
  cycleMode: { title: "Cycle mode", description: "Off → Balanced → Strict for outputs." },
  nextProfile: { title: "Next profile", description: "Switch to the next profile." },
  showWindow: { title: "Show / hide Waypoint", description: "Open the window from anywhere, or hide it again." },
};

export const hotkeyOrder: HotkeyAction[] = ["nextOutput", "previousOutput", "restorePriority", "toggleMicMute", "cycleMode", "nextProfile", "showWindow"];
