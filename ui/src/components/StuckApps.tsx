import * as Popover from "@radix-ui/react-popover";
import { RefreshCw, TriangleAlert } from "lucide-react";
import type { Flow, StuckApp } from "../bridge/protocol";
import { useApp } from "../store/store";
import { Button } from "./ui";

/** App-specific steps for the common "picked a device in its own settings" case. */
function howTo(app: string, flow: Flow): string[] {
  const which = flow === "input" ? "Input Device" : "Output Device";
  const name = app.toLowerCase();
  if (name.includes("discord")) return ["Open Discord → User Settings (gear) → Voice & Video.", `Set ${which} to "Default".`, "From now on Discord follows Waypoint automatically."];
  if (name.includes("teams")) return ["Open Teams → Settings → Devices.", `Set ${flow === "input" ? "Microphone" : "Speaker"} to "Default device".`];
  if (name.includes("zoom")) return ["Open Zoom → Settings → Audio.", `Set ${flow === "input" ? "Microphone" : "Speaker"} to "Same as System".`];
  if (name.includes("spotify")) return ["Spotify uses its own device list.", 'In Settings → Playback, choose the default device, or restart Spotify after switching.'];
  return [`${app} chose this device in its own settings.`, `Look for its audio/${flow === "input" ? "microphone" : "speaker"} setting and pick "Default" (or "System default").`];
}

/**
 * Shown after a switch when an app kept using the old device. Apps pinned by Windows' per-app setting can be
 * released in one click; apps that chose a device themselves get the exact steps to fix it.
 */
export function StuckAppsNotice({ flow, apps }: { flow: Flow; apps: StuckApp[] }) {
  const send = useApp((s) => s.send);
  if (apps.length === 0) return null;

  return (
    <div role="status" className="mt-5 rounded-[12px] border-[1.6px] border-tx-sun bg-sun/10 p-3.5">
      {apps.map((a) => (
        <div key={a.processId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-0.5">
          <TriangleAlert size={16} strokeWidth={2.4} className="shrink-0 text-tx-sun" />
          <p className="min-w-0 flex-1 text-[13.5px] text-fg">
            <span className="font-bold">{a.processName}</span> is still {flow === "input" ? "listening on" : "playing on"} <span className="font-bold">{a.deviceName}</span>
          </p>
          {a.pinnedInWindows ? (
            <Button size="sm" variant="primary" onClick={() => send({ type: "releaseApp", flow, pid: a.processId })}>
              Let it follow
            </Button>
          ) : (
            <Popover.Root>
              <Popover.Trigger asChild>
                <Button size="sm">How to fix</Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content side="bottom" align="end" sideOffset={8} collisionPadding={16} className="surface-raised z-50 w-[320px] rounded-[12px] p-4 outline-none">
                  <p className="text-[14px] font-extrabold tracking-[-0.02em] text-fg">{a.processName} picks its own {flow === "input" ? "microphone" : "speaker"}</p>
                  <p className="mt-1 text-[12.5px] text-fg-3">Windows (and Waypoint) can only move apps that use the default device.</p>
                  <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-[13px] text-fg-2">
                    {howTo(a.processName, flow).map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  <Popover.Arrow className="fill-fg" width={12} height={6} />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}
        </div>
      ))}
      <button onClick={() => send({ type: "recheckApps", flow })} className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-fg-3 hover:text-fg">
        <RefreshCw size={12} /> Check again
      </button>
    </div>
  );
}
