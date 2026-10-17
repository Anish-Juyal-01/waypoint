import { Bluetooth, RefreshCw, Settings2 } from "lucide-react";
import { useEffect } from "react";
import type { Flow } from "../bridge/protocol";
import { DeviceList } from "../components/DeviceList";
import { NowPlayingCard } from "../components/NowPlaying";
import { ProfileBar } from "../components/ProfileBar";
import { IconButton } from "../components/ui";
import { useApp } from "../store/store";

function FlowView({ flow }: { flow: Flow }) {
  const send = useApp((s) => s.send);
  const input = flow === "input";

  // Windows only reports a mic's level while something has it open, so ask the host to listen while this page shows.
  useEffect(() => {
    if (!input) return;
    send({ type: "micMonitor", on: true });
    return () => send({ type: "micMonitor", on: false });
  }, [input, send]);
  return (
    <>
      <ProfileBar
        actions={
          <>
            <IconButton label="Rescan devices" onClick={() => send({ type: "rescan" })}>
              <RefreshCw size={16} />
            </IconButton>
            {input ? (
              <IconButton label="Windows sound settings" onClick={() => send({ type: "openSettings", page: "sound" })}>
                <Settings2 size={16} />
              </IconButton>
            ) : (
              <IconButton label="Connect a Bluetooth device" onClick={() => send({ type: "openSettings", page: "bluetooth" })}>
                <Bluetooth size={16} />
              </IconButton>
            )}
          </>
        }
      />
      <NowPlayingCard flow={flow} />
      <div className="mt-12">
        <DeviceList flow={flow} />
      </div>
    </>
  );
}

export function DevicesView() {
  return <FlowView flow="output" />;
}

export function MicrophonesView() {
  return <FlowView flow="input" />;
}
