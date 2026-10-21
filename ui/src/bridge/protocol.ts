// TypeScript side of the host ⇄ UI contract. Mirrors src-tauri/src/engine/types.rs (RuntimeSnapshot) and
// src-tauri/src/host/bridge.rs (UiMessage); JSON is camelCase, enums are camelCase strings.

export type SwitchMode = "off" | "balanced" | "strict";
export type EndpointState = "active" | "disabled" | "notPresent" | "unplugged";
export type ConnectionType = "bluetooth" | "bluetoothHandsFree" | "usb" | "builtIn" | "display" | "virtual" | "other";
export type DeviceKind = "speakers" | "headphones" | "earbuds" | "headset" | "display" | "lineOut" | "digital" | "microphone" | "other";
export type OverrideSource = "app" | "external";

/** Which list a command targets. */
export type Flow = "output" | "input";
/** How the host names flows inside snapshots. */
export type AudioFlow = "render" | "capture";

export type ActivityKind =
  | "connected"
  | "disconnected"
  | "discovered"
  | "switched"
  | "switchFailed"
  | "externalChange"
  | "reverted"
  | "override"
  | "restored"
  | "modeChanged"
  | "priorityChanged"
  | "settings"
  | "warning"
  | "info";

export interface VolumeInfo {
  level: number;
  muted: boolean;
}

export interface DeviceView {
  id: string;
  name: string;
  friendlyName: string;
  alias: string | null;
  adapterName: string;
  description: string;
  kind: DeviceKind;
  connection: ConnectionType;
  state: EndpointState;
  rank: number;
  isDefault: boolean;
  isCommunicationsDefault: boolean;
  excluded: boolean;
  autoExcluded: boolean;
  isTarget: boolean;
  lastConnected: string | null;
  /** Live master volume, connected devices only. */
  volume: VolumeInfo | null;
  /** Volume applied whenever Waypoint switches to this device. */
  switchVolume: number | null;
}

export interface ManualOverride {
  deviceId: string;
  source: OverrideSource;
  since: string;
}

export interface StuckApp {
  processName: string;
  processId: number;
  deviceId: string;
  deviceName: string;
  /** Pinned by Windows' per-app setting (Waypoint can release it) vs. chosen inside the app. */
  pinnedInWindows: boolean;
}

export interface FlowSnapshot {
  flow: AudioFlow;
  devices: DeviceView[];
  mode: SwitchMode;
  defaultId: string | null;
  targetId: string | null;
  priorityTargetId: string | null;
  override: ManualOverride | null;
  enforcementPausedUntil: string | null;
  busy: boolean;
  pendingReason: string | null;
  stuckApps: StuckApp[];
}

export interface SettingsView {
  startWithWindows: boolean;
  /** Existing Run entry that launches a different copy of Waypoint (read-only). */
  startupConflict?: string | null;
  startMinimized: boolean;
  /** A Start menu shortcut exists, so Windows search finds Waypoint. */
  startMenuShortcut: boolean;
  closeToTray: boolean;
  notifyOnSwitch: boolean;
  showOsd: boolean;
  includeCommunicationsRole: boolean;
  ignoreHandsFree: boolean;
  strictLoopGuard: boolean;
  showDisconnected: boolean;
  showVirtualDevices: boolean;
  settleDelayMs: number;
  onboardingDone: boolean;
  hotkeysEnabled: boolean;
  theme: "system" | "light" | "dark";
}

export interface ProfileView {
  id: string;
  name: string;
  /** Cast creature name; null = default by position. */
  pal: string | null;
  topOutput: string | null;
  topInput: string | null;
  outputMode: SwitchMode;
  inputMode: SwitchMode;
}

export type HotkeyAction = "nextOutput" | "previousOutput" | "restorePriority" | "toggleMicMute" | "cycleMode" | "nextProfile" | "showWindow";

/** RegisterHotKey modifier flags. */
export const Mod = { Alt: 1, Ctrl: 2, Shift: 4, Win: 8 } as const;

export interface HotkeyBinding {
  modifiers: number;
  /** Windows virtual-key code. */
  key: number;
}

export interface HotkeyView {
  action: HotkeyAction;
  binding: HotkeyBinding | null;
  status: "unbound" | "registered" | "conflict" | "disabled";
}

export interface RuntimeSnapshot {
  output: FlowSnapshot;
  input: FlowSnapshot;
  settings: SettingsView;
  profiles: ProfileView[];
  activeProfileId: string | null;
  hotkeys: HotkeyView[];
  canSwitch: boolean;
  switchUnavailableReason: string | null;
}

export interface ActivityEntry {
  id: number;
  time: string;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  deviceId: string | null;
  /** "capture" for microphone events. */
  flow?: AudioFlow | null;
}

/** Messages pushed by the host. */
export type HostMessage =
  | { type: "hello"; version: string; maximized: boolean; state: RuntimeSnapshot; activity: ActivityEntry[] }
  | { type: "state"; state: RuntimeSnapshot }
  | { type: "activityAdded"; entry: ActivityEntry }
  | { type: "activityCleared" }
  | { type: "level"; output: number | null; input: number | null }
  | { type: "window"; maximized: boolean }
  | { type: "switchResult"; flow: Flow; deviceId: string; name: string; verified: boolean; message: string }
  | { type: "notice"; tone: "success" | "error" | "info"; text: string };

export type SettingsPatch = Partial<Omit<SettingsView, "startupConflict">>;
export type ResizeEdge = "caption" | "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** Commands sent to the host. */
export type UiMessage =
  | { type: "ready" }
  | { type: "setMode"; flow: Flow; mode: SwitchMode }
  | { type: "reorder"; flow: Flow; ids: string[] }
  | { type: "setExcluded"; flow: Flow; id: string; excluded: boolean }
  | { type: "selectDevice"; flow: Flow; id: string }
  | { type: "restorePriority"; flow: Flow }
  | { type: "resetPriorities"; flow: Flow }
  | { type: "rename"; id: string; alias: string | null }
  | { type: "setVolume"; id: string; level: number }
  | { type: "setMute"; id: string; muted: boolean }
  /** Microphones page is showing: keep a silent stream open on the default mic so its level can be metered. */
  | { type: "micMonitor"; on: boolean }
  | { type: "setSwitchVolume"; id: string; level: number | null }
  | { type: "createProfile"; name: string }
  | { type: "renameProfile"; id: string; name: string }
  | { type: "deleteProfile"; id: string }
  | { type: "setProfilePal"; id: string; pal: string | null }
  | { type: "releaseApp"; flow: Flow; pid: number }
  | { type: "recheckApps"; flow: Flow }
  | { type: "switchProfile"; id: string }
  | { type: "setHotkey"; action: HotkeyAction; binding: HotkeyBinding | null }
  | { type: "resetHotkeys" }
  | { type: "hotkeyRecording"; active: boolean }
  | { type: "updateSettings"; patch: SettingsPatch }
  | { type: "clearLog" }
  | { type: "exportLog" }
  | { type: "rescan" }
  | { type: "openSettings"; page: "sound" | "bluetooth" | "volume" }
  | { type: "openDataFolder" }
  | { type: "window"; action: "drag" | "minimize" | "maximize" | "close" | "quit"; edge?: ResizeEdge };
