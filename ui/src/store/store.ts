import { create } from "zustand";
import { bridge } from "../bridge/bridge";
import type { ActivityEntry, DeviceView, Flow, FlowSnapshot, HostMessage, RuntimeSnapshot, SettingsPatch, SwitchMode, UiMessage } from "../bridge/protocol";
import { mergeVisibleOrder } from "../lib/order";
import { assignDisplayNames } from "../lib/format";
import { syncThemeFromHost } from "../lib/theme";

export type View = "devices" | "microphones" | "activity" | "settings";

export interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  text?: string;
}

interface AppState {
  connected: boolean;
  version: string;
  maximized: boolean;
  view: View;
  snapshot: RuntimeSnapshot | null;
  activity: ActivityEntry[];
  toasts: Toast[];
  /** Highest activity id the user has looked at (drives the sidebar issue badge). */
  seenActivityId: number;

  setView(view: View): void;
  send(message: UiMessage): void;
  setMode(flow: Flow, mode: SwitchMode): void;
  reorderVisible(flow: Flow, visibleIds: string[]): void;
  updateSettings(patch: SettingsPatch): void;
  pushToast(t: Omit<Toast, "id">): void;
  dismissToast(id: number): void;
  receive(message: HostMessage): void;
}

let toastId = 1;
const MAX_ACTIVITY = 2000;

function prepare(s: RuntimeSnapshot): RuntimeSnapshot {
  assignDisplayNames(s.output.devices);
  assignDisplayNames(s.input.devices);
  // The host owns the preference (it also themes the window frame); keep the page in sync with it.
  syncThemeFromHost(s.settings.theme);
  return s;
}

function withFlow(s: RuntimeSnapshot, flow: Flow, update: (f: FlowSnapshot) => FlowSnapshot): RuntimeSnapshot {
  return flow === "input" ? { ...s, input: update(s.input) } : { ...s, output: update(s.output) };
}

export const useApp = create<AppState>((set, get) => ({
  connected: false,
  version: "",
  maximized: false,
  view: "devices",
  snapshot: null,
  activity: [],
  toasts: [],
  seenActivityId: 0,

  setView: (view) =>
    set(view === "activity" ? { view, seenActivityId: get().activity.at(-1)?.id ?? get().seenActivityId } : { view }),

  send: (message) => bridge.send(message),

  setMode(flow, mode) {
    const s = get().snapshot;
    if (!s || s[flow].mode === mode) return;
    set({ snapshot: withFlow(s, flow, (f) => ({ ...f, mode })) }); // optimistic; the host confirms with a new snapshot
    bridge.send({ type: "setMode", flow, mode });
  },

  reorderVisible(flow, visibleIds) {
    const s = get().snapshot;
    if (!s) return;
    const list = s[flow].devices;
    const full = mergeVisibleOrder(list.map((d) => d.id), visibleIds);
    const byId = new Map(list.map((d) => [d.id, d] as const));
    const devices: DeviceView[] = full.map((id, i) => ({ ...byId.get(id)!, rank: i + 1 }));
    assignDisplayNames(devices);
    set({ snapshot: withFlow(s, flow, (f) => ({ ...f, devices })) });
    bridge.send({ type: "reorder", flow, ids: full });
  },

  updateSettings(patch) {
    const s = get().snapshot;
    if (s) set({ snapshot: { ...s, settings: { ...s.settings, ...patch } } });
    bridge.send({ type: "updateSettings", patch });
  },

  pushToast(t) {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    window.setTimeout(() => get().dismissToast(id), t.tone === "error" ? 7000 : 4200);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  receive(m) {
    switch (m.type) {
      case "hello":
        set({
          connected: true,
          version: m.version,
          maximized: m.maximized,
          snapshot: prepare(m.state),
          activity: m.activity,
          seenActivityId: Math.max(get().seenActivityId, m.activity.at(-1)?.id ?? 0),
        });
        break;
      case "state":
        set({ snapshot: prepare(m.state) });
        break;
      case "activityAdded": {
        const activity = get().activity;
        if (activity.some((a) => a.id === m.entry.id && m.entry.id !== 0)) break;
        const next = [...activity, m.entry];
        set({
          activity: next.length > MAX_ACTIVITY ? next.slice(-MAX_ACTIVITY) : next,
          seenActivityId: get().view === "activity" ? Math.max(get().seenActivityId, m.entry.id) : get().seenActivityId,
        });
        break;
      }
      case "activityCleared":
        set({ activity: [] });
        break;
      case "window":
        set({ maximized: m.maximized });
        break;
      case "level":
        setLevel("output", m.output ?? 0);
        setLevel("input", m.input ?? 0);
        break;
      case "switchResult": {
        const verb = m.flow === "input" ? "Recording from" : "Now playing on";
        get().pushToast(
          m.verified
            ? { tone: "success", title: `${verb} ${m.name}`, text: "Switch verified by Windows" }
            : { tone: "error", title: `Couldn't switch to ${m.name}`, text: m.message },
        );
        break;
      }
      case "notice":
        get().pushToast({ tone: m.tone, title: m.text });
        break;
    }
  },
}));

// ── Live levels: kept outside React state so 30 Hz updates don't re-render the tree. ──
type LevelListener = (v: number) => void;
const levelListeners: Record<Flow, Set<LevelListener>> = { output: new Set(), input: new Set() };
const currentLevel: Record<Flow, number> = { output: 0, input: 0 };

function setLevel(flow: Flow, v: number) {
  currentLevel[flow] = v;
  levelListeners[flow].forEach((l) => l(v));
}

export function subscribeLevel(flow: Flow, l: LevelListener): () => void {
  levelListeners[flow].add(l);
  l(currentLevel[flow]);
  return () => levelListeners[flow].delete(l);
}

export function startBridge() {
  const unsubscribe = bridge.subscribe((m) => useApp.getState().receive(m));
  bridge.send({ type: "ready" });
  return unsubscribe;
}

// ── Derived selectors ──
export const selectCurrent = (flow: Flow) => (s: AppState) => s.snapshot?.[flow].devices.find((d) => d.isDefault) ?? null;
