// DEVELOPMENT PREVIEW ONLY.
// Used when the UI is opened in a normal browser (e.g. `npm run dev`) where there is no Waypoint host.
// It renders sample data so the interface can be designed and reviewed; the UI shows a persistent
// "Preview data" banner whenever this bridge is active. It never runs inside the Waypoint app.

import type { Bridge } from "./bridge";
import type {
  ActivityEntry,
  ActivityKind,
  DeviceView,
  Flow,
  FlowSnapshot,
  HostMessage,
  HotkeyAction,
  HotkeyBinding,
  ProfileView,
  RuntimeSnapshot,
  SwitchMode,
  UiMessage,
} from "./protocol";

const now = () => new Date().toISOString();

function device(partial: Partial<DeviceView> & Pick<DeviceView, "id" | "name">): DeviceView {
  const state = partial.state ?? "active";
  return {
    friendlyName: partial.name,
    alias: null,
    adapterName: "",
    description: "Headphones",
    kind: "headphones",
    connection: "bluetooth",
    state,
    rank: 0,
    isDefault: false,
    isCommunicationsDefault: false,
    excluded: false,
    autoExcluded: false,
    isTarget: false,
    lastConnected: now(),
    volume: state === "active" ? { level: 0.62, muted: false } : null,
    switchVolume: null,
    ...partial,
  };
}

interface FlowState {
  devices: DeviceView[];
  mode: SwitchMode;
  defaultId: string | null;
  override: FlowSnapshot["override"];
}

interface PreviewProfile {
  id: string;
  name: string;
  pal?: string | null;
  order: Record<Flow, string[]>;
  mode: Record<Flow, SwitchMode>;
}

export function createPreviewBridge(): Bridge {
  const handlers = new Set<(m: HostMessage) => void>();
  let nextId = 1;

  const flows: Record<Flow, FlowState> = {
    output: {
      mode: "balanced",
      defaultId: "a",
      override: null,
      devices: [
        device({ id: "a", name: "Headphones (OnePlus Nord Buds 3 Pro)", adapterName: "OnePlus Nord Buds 3 Pro", kind: "earbuds" }),
        device({ id: "b", name: "Headphones (Sony WH-1000XM5)", adapterName: "WH-1000XM5", state: "unplugged", lastConnected: new Date(Date.now() - 3 * 3600_000).toISOString() }),
        device({ id: "c", name: "Speakers (USB Audio)", adapterName: "USB Audio", kind: "speakers", connection: "usb", description: "Speakers", switchVolume: 0.3 }),
        device({ id: "d", name: "Speaker (Realtek(R) Audio)", adapterName: "Realtek(R) Audio", kind: "speakers", connection: "builtIn", description: "Speaker" }),
        device({ id: "e", name: "LG ULTRAGEAR (NVIDIA High Definition Audio)", kind: "display", connection: "display", state: "notPresent", lastConnected: null }),
        device({ id: "f", name: "Headset (OnePlus Nord Buds 3 Pro Hands-Free)", kind: "headset", connection: "bluetoothHandsFree", autoExcluded: true }),
      ],
    },
    input: {
      mode: "off",
      defaultId: "m2",
      override: null,
      devices: [
        device({ id: "m1", name: "Microphone (Blue Yeti)", kind: "microphone", connection: "usb", description: "Microphone", state: "unplugged" }),
        device({ id: "m2", name: "Microphone Array (Intel® Smart Sound Technology)", kind: "microphone", connection: "builtIn", description: "Microphone Array", volume: { level: 0.8, muted: false } }),
        device({ id: "m3", name: "Headset (OnePlus Nord Buds 3 Pro)", kind: "earbuds", connection: "bluetoothHandsFree", description: "Headset" }),
      ],
    },
  };

  const settings: RuntimeSnapshot["settings"] = {
    startWithWindows: true,
    startMinimized: true,
    startMenuShortcut: true,
    closeToTray: true,
    notifyOnSwitch: true,
    showOsd: true,
    includeCommunicationsRole: true,
    ignoreHandsFree: true,
    strictLoopGuard: true,
    showDisconnected: true,
    showVirtualDevices: false,
    settleDelayMs: 1500,
    onboardingDone: false,
    hotkeysEnabled: true,
    theme: "system",
  };

  const C = 2,
    A = 1;
  const hotkeys: Record<HotkeyAction, HotkeyBinding | null> = {
    previousOutput: { modifiers: C | A, key: 0x77 },
    nextOutput: { modifiers: C | A, key: 0x78 },
    restorePriority: { modifiers: C | A, key: 0x79 },
    toggleMicMute: { modifiers: C | A, key: 0x7a },
    cycleMode: { modifiers: C | A, key: 0x76 },
    nextProfile: { modifiers: C | A, key: 0x75 },
    showWindow: null,
  };

  const profiles: PreviewProfile[] = [
    { id: "p1", name: "Default", order: { output: ["a", "b", "c", "d", "e", "f"], input: ["m1", "m2", "m3"] }, mode: { output: "balanced", input: "off" } },
  ];
  let activeProfile = "p1";

  const activity: ActivityEntry[] = [];
  const log = (kind: ActivityKind, title: string, detail: string | null = null, flow: Flow = "output") => {
    const entry: ActivityEntry = { id: nextId++, time: now(), kind, title, detail, deviceId: null, flow: flow === "input" ? "capture" : null };
    activity.push(entry);
    emit({ type: "activityAdded", entry });
  };

  const eligible = (d: DeviceView) => d.state === "active" && !d.excluded && !d.autoExcluded;

  function flowSnapshot(flow: Flow): FlowSnapshot {
    const f = flows[flow];
    const top = f.devices.find(eligible) ?? null;
    const pinned = f.override ? f.devices.find((d) => d.id === f.override!.deviceId && d.state === "active") : undefined;
    const target = pinned ?? top;
    return {
      flow: flow === "input" ? "capture" : "render",
      mode: f.mode,
      defaultId: f.defaultId,
      targetId: target?.id ?? null,
      priorityTargetId: top?.id ?? null,
      override: f.override,
      enforcementPausedUntil: null,
      busy: false,
      pendingReason: null,
      stuckApps: flow === "output" ? [{ processName: "Discord", processId: 1234, deviceId: "d", deviceName: "Speaker (Realtek(R) Audio)", pinnedInWindows: false }] : [],
      devices: f.devices.map((d, i) => ({ ...d, rank: i + 1, isDefault: d.id === f.defaultId, isCommunicationsDefault: d.id === f.defaultId, isTarget: d.id === target?.id })),
    };
  }

  function snapshot(): RuntimeSnapshot {
    const out = flowSnapshot("output");
    const top = (flow: Flow, order: string[]) => {
      const id = order.find((i) => {
        const d = flows[flow].devices.find((x) => x.id === i);
        return d && eligible(d);
      });
      return flows[flow].devices.find((d) => d.id === id)?.name ?? null;
    };
    const profileViews: ProfileView[] = profiles.map((p) => ({
      id: p.id,
      name: p.name,
      pal: p.pal ?? null,
      topOutput: top("output", p.id === activeProfile ? flows.output.devices.map((d) => d.id) : p.order.output),
      topInput: top("input", p.id === activeProfile ? flows.input.devices.map((d) => d.id) : p.order.input),
      outputMode: p.id === activeProfile ? flows.output.mode : p.mode.output,
      inputMode: p.id === activeProfile ? flows.input.mode : p.mode.input,
    }));
    return {
      output: out,
      input: flowSnapshot("input"),
      settings: { ...settings },
      profiles: profileViews,
      activeProfileId: activeProfile,
      hotkeys: (Object.keys(hotkeys) as HotkeyAction[]).map((action) => ({
        action,
        binding: hotkeys[action],
        status: !hotkeys[action] ? "unbound" : !settings.hotkeysEnabled ? "disabled" : action === "cycleMode" ? "conflict" : "registered",
      })),
      canSwitch: true,
      switchUnavailableReason: null,
    };
  }

  function apply(flow: Flow) {
    const s = flowSnapshot(flow);
    if (flows[flow].mode !== "off" && s.targetId && s.targetId !== flows[flow].defaultId) switchTo(flow, s.targetId, "Priority applied");
  }

  function switchTo(flow: Flow, id: string, cause: string) {
    const f = flows[flow];
    const d = f.devices.find((x) => x.id === id)!;
    f.defaultId = id;
    if (d.switchVolume !== null && d.volume) d.volume = { ...d.volume, level: d.switchVolume };
    log("switched", `Switched to ${d.alias ?? d.name}`, `${cause} · preview`, flow);
    emit({ type: "switchResult", flow, deviceId: id, name: d.alias ?? d.name, verified: true, message: "Preview" });
  }

  function findDevice(id: string) {
    return flows.output.devices.find((d) => d.id === id) ?? flows.input.devices.find((d) => d.id === id);
  }

  function publish() {
    emit({ type: "state", state: structuredClone(snapshot()) });
  }

  function emit(m: HostMessage) {
    setTimeout(() => handlers.forEach((h) => h(m)), 0);
  }

  function saveProfile() {
    const p = profiles.find((x) => x.id === activeProfile)!;
    p.order = { output: flows.output.devices.map((d) => d.id), input: flows.input.devices.map((d) => d.id) };
    p.mode = { output: flows.output.mode, input: flows.input.mode };
  }

  function loadProfile(id: string) {
    saveProfile();
    activeProfile = id;
    const p = profiles.find((x) => x.id === id)!;
    for (const flow of ["output", "input"] as Flow[]) {
      flows[flow].devices = p.order[flow].map((did) => flows[flow].devices.find((d) => d.id === did)!).filter(Boolean);
      flows[flow].mode = p.mode[flow];
      flows[flow].override = null;
      apply(flow);
    }
  }

  function handle(m: UiMessage) {
    switch (m.type) {
      case "ready":
        if (activity.length === 0) log("info", "Waypoint started in Balanced mode", "Preview data");
        emit({ type: "hello", version: "2.0.0-preview", maximized: false, state: structuredClone(snapshot()), activity: [...activity] });
        startLevel();
        break;
      case "setMode":
        flows[m.flow].mode = m.mode;
        flows[m.flow].override = null;
        log("modeChanged", `${m.flow === "input" ? "Microphone mode" : "Mode"} set to ${m.mode[0].toUpperCase() + m.mode.slice(1)}`, null, m.flow);
        apply(m.flow);
        publish();
        break;
      case "reorder":
        flows[m.flow].devices = m.ids.map((id) => flows[m.flow].devices.find((d) => d.id === id)!).filter(Boolean);
        log("priorityChanged", "Priority order updated", null, m.flow);
        apply(m.flow);
        publish();
        break;
      case "setExcluded":
        flows[m.flow].devices = flows[m.flow].devices.map((d) => (d.id === m.id ? { ...d, excluded: m.excluded } : d));
        apply(m.flow);
        publish();
        break;
      case "selectDevice": {
        const f = flows[m.flow];
        const top = f.devices.find(eligible);
        f.override = f.mode !== "off" && m.id !== top?.id ? { deviceId: m.id, source: "app", since: now() } : null;
        switchTo(m.flow, m.id, "Selected manually");
        publish();
        break;
      }
      case "restorePriority": {
        const f = flows[m.flow];
        f.override = null;
        log("restored", "Priority restored", null, m.flow);
        const top = f.devices.find(eligible);
        if (top && top.id !== f.defaultId) switchTo(m.flow, top.id, "Priority restored");
        publish();
        break;
      }
      case "rename": {
        const d = findDevice(m.id);
        if (d) {
          d.alias = m.alias;
          d.name = m.alias ?? d.friendlyName;
        }
        publish();
        break;
      }
      case "setVolume": {
        const d = findDevice(m.id);
        if (d?.volume) d.volume = { ...d.volume, level: m.level };
        publish();
        break;
      }
      case "setMute": {
        const d = findDevice(m.id);
        if (d?.volume) d.volume = { ...d.volume, muted: m.muted };
        publish();
        break;
      }
      case "setSwitchVolume": {
        const d = findDevice(m.id);
        if (d) d.switchVolume = m.level;
        publish();
        break;
      }
      case "createProfile": {
        saveProfile();
        const id = `p${profiles.length + 1}-${Date.now() % 1000}`;
        profiles.push({ id, name: m.name, order: { output: flows.output.devices.map((d) => d.id), input: flows.input.devices.map((d) => d.id) }, mode: { output: flows.output.mode, input: flows.input.mode } });
        activeProfile = id;
        log("settings", `Profile created: ${m.name}`);
        publish();
        break;
      }
      case "renameProfile": {
        const p = profiles.find((x) => x.id === m.id);
        if (p) p.name = m.name;
        publish();
        break;
      }
      case "deleteProfile":
        if (profiles.length > 1) {
          const i = profiles.findIndex((x) => x.id === m.id);
          profiles.splice(i, 1);
          if (activeProfile === m.id) {
            activeProfile = profiles[0].id;
            loadProfile(profiles[0].id);
          }
        }
        publish();
        break;
      case "setProfilePal": {
        const p = profiles.find((x) => x.id === m.id);
        if (p) p.pal = m.pal;
        publish();
        break;
      }
      case "switchProfile":
        loadProfile(m.id);
        log("modeChanged", `Profile: ${profiles.find((p) => p.id === m.id)!.name}`);
        publish();
        break;
      case "setHotkey":
        for (const a of Object.keys(hotkeys) as HotkeyAction[])
          if (m.binding && hotkeys[a]?.key === m.binding.key && hotkeys[a]?.modifiers === m.binding.modifiers) hotkeys[a] = null;
        hotkeys[m.action] = m.binding;
        publish();
        break;
      case "updateSettings":
        Object.assign(settings, m.patch);
        publish();
        break;
      case "clearLog":
        activity.length = 0;
        emit({ type: "activityCleared" });
        break;
      case "exportLog":
        emit({ type: "notice", tone: "info", text: "Export is available in the desktop app." });
        break;
      case "rescan":
        publish();
        break;
      default:
        break;
    }
  }

  let levelTimer: number | undefined;
  function startLevel() {
    if (levelTimer) return;
    let t = 0;
    levelTimer = window.setInterval(() => {
      t += 0.05;
      const out = Math.max(0, 0.35 + 0.25 * Math.sin(t * 2.1) + 0.2 * Math.sin(t * 7.3) * Math.random());
      const mic = Math.max(0, 0.15 + 0.2 * Math.sin(t * 3.3) * Math.random());
      emit({ type: "level", output: Math.min(1, out), input: Math.min(1, mic) });
    }, 50);
  }

  return {
    isPreview: true,
    send: handle,
    subscribe(h) {
      handlers.add(h);
      return () => handlers.delete(h);
    },
  };
}
