import * as Slider from "@radix-ui/react-slider";
import { Bluetooth, ExternalLink, FolderOpen, Power, ShieldCheck, ShieldAlert, Volume2, ListRestart } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Pal } from "../components/Pixel";
import { Parade } from "../pals/Parade";
import { AppearancePicker } from "../components/AppearancePicker";
import { ShortcutsGroup } from "../components/Shortcuts";
import { Button, SectionTitle, Switch } from "../components/ui";
import { useApp } from "../store/store";
import { PageHeader } from "./PageHeader";

function Row({ title, description, control, htmlFor }: { title: string; description?: ReactNode; control: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex items-center gap-6 px-5 py-4">
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="text-[14.5px] font-bold tracking-[-0.015em] text-fg">
          {title}
        </label>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-fg-3">{description}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function Group({ title, color, children }: { title: string; color?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <SectionTitle color={color}>{title}</SectionTitle>
      <div className="surface divide-y-2 divide-dotted divide-[var(--line-strong)]">{children}</div>
    </section>
  );
}

export function SettingsView() {
  const s = useApp((x) => x.snapshot!.settings);
  const canSwitch = useApp((x) => x.snapshot!.canSwitch);
  const reason = useApp((x) => x.snapshot!.switchUnavailableReason);
  const version = useApp((x) => x.version);
  const update = useApp((x) => x.updateSettings);
  const send = useApp((x) => x.send);
  const [confirmReset, setConfirmReset] = useState(false);

  // Slider is local while dragging and committed on release, so the host isn't spammed.
  const [delay, setDelay] = useState(s.settleDelayMs);
  useEffect(() => setDelay(s.settleDelayMs), [s.settleDelayMs]);

  const toggle = (key: keyof typeof s, title: string, description: ReactNode) => (
    <Row
      htmlFor={key}
      title={title}
      description={description}
      control={<Switch id={key} label={title} checked={s[key] as boolean} onCheckedChange={(v) => update({ [key]: v })} />}
    />
  );

  return (
    <>
      <PageHeader title="Settings" subtitle="Tune how Waypoint behaves. Changes apply immediately." />

      <div className="max-w-[820px]">
        <section className="mb-8">
          <SectionTitle color="var(--color-sun)">Appearance</SectionTitle>
          <div className="surface">
            <AppearancePicker />
            <p className="border-t-[1.6px] border-[var(--line)] px-5 py-3 text-[13px] text-fg-3">
              System follows your Windows light/dark setting and switches with it automatically. Also in the title bar.
            </p>
          </div>
        </section>

        <Group title="General" color="var(--color-lime)">
          {toggle(
            "startWithWindows",
            "Start with Windows",
            s.startupConflict ? (
              <>
                Launch Waypoint when you sign in.{" "}
                <span className="text-tx-sun">
                  A startup entry already launches another copy: <span className="font-mono text-[11.5px] break-all">{s.startupConflict}</span>. Turning this on replaces it.
                </span>
              </>
            ) : (
              "Launch Waypoint when you sign in, so priority applies from the first sound."
            ),
          )}
          {toggle("startMenuShortcut", "Show in Start menu", "Adds Waypoint to the Start menu, so you can find it with Windows search.")}
          {toggle("startMinimized", "Start in the tray", "When launched at sign-in, stay in the notification area instead of opening the window.")}
          {toggle("closeToTray", "Keep running when closed", "The close button hides Waypoint to the tray. Quit from the tray menu.")}
          {toggle("showOsd", "On-screen indicator", "Show a small overlay above the taskbar when a shortcut runs or Waypoint switches devices while its window is in the background.")}
          {toggle("notifyOnSwitch", "Windows notifications", "Use Windows notifications for switches when the on-screen indicator is off, and always for failed switches.")}
        </Group>

        <Group title="Switching" color="var(--color-sky)">
          <Row
            title="Connection settle delay"
            description="Bluetooth devices report ready before audio is. Waypoint waits this long after a device connects before switching to it."
            control={
              <div className="flex w-[220px] items-center gap-3">
                <Slider.Root
                  className="relative flex h-5 flex-1 touch-none items-center select-none"
                  min={0}
                  max={5000}
                  step={250}
                  value={[delay]}
                  onValueChange={([v]) => setDelay(v)}
                  onValueCommit={([v]) => update({ settleDelayMs: v })}
                  aria-label="Connection settle delay"
                >
                  <Slider.Track className="px-track">
                    <Slider.Range className="px-range" />
                  </Slider.Track>
                  <Slider.Thumb className="px-thumb" aria-label="Connection settle delay" />
                </Slider.Root>
                <span className="font-pixel w-14 text-right text-[11px] text-fg">{(delay / 1000).toFixed(2)}s</span>
              </div>
            }
          />
          {toggle("includeCommunicationsRole", "Move calls and chat too", "Also set the Windows communications device (Teams, Discord, Zoom) to the chosen output.")}
          {toggle("ignoreHandsFree", "Ignore Bluetooth Hands-Free outputs", "Hands-Free (HFP) outputs are low-quality call audio for the same earbuds. Recommended. Bluetooth headset microphones are never hidden.")}
          {toggle("showVirtualDevices", "Include virtual devices", "Show software outputs such as voice changers and virtual cables in your priority list.")}
          {toggle("strictLoopGuard", "Strict loop protection", "If another program keeps changing the output, pause Strict enforcement for 60 seconds instead of fighting it.")}
        </Group>

        <ShortcutsGroup />

        <Group title="Priority & Windows" color="var(--color-coral)">
          <Row
            title="Reset priority list"
            description="Re-rank outputs and microphones in the active profile in the recommended order (Bluetooth audio first, built-in speakers last) and clear exclusions."
            control={
              <Button size="sm" variant="secondary" icon={<ListRestart size={14} />} onClick={() => setConfirmReset(true)}>
                Reset…
              </Button>
            }
          />
          <Row
            title="Windows sound settings"
            description="Volume, device properties and app-specific outputs."
            control={
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" icon={<Volume2 size={14} />} onClick={() => send({ type: "openSettings", page: "sound" })}>
                  Sound
                </Button>
                <Button size="sm" variant="ghost" icon={<Bluetooth size={14} />} onClick={() => send({ type: "openSettings", page: "bluetooth" })}>
                  Bluetooth
                </Button>
              </div>
            }
          />
          <Row
            title="Data folder"
            description="Settings and activity log are stored locally in %APPDATA%\Waypoint."
            control={
              <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={() => send({ type: "openDataFolder" })}>
                Open
              </Button>
            }
          />
        </Group>

        <Group title="About" color="var(--color-violet)">
          <div className="flex flex-wrap items-center gap-5 px-5 py-5">
            <Pal scale={4} />
            <div className="min-w-0 flex-1">
              <p className="text-[24px] leading-none font-extrabold tracking-[-0.05em] text-fg">
                waypoint <span className="font-pixel ml-1 align-middle text-[11px] font-normal tracking-normal text-tx-lime">v{version}</span>
              </p>
              <p className="mt-2 text-[13px] text-fg-3">Audio priority manager for Windows. Runs entirely on this PC.</p>
            </div>
            <div className="font-pixel flex items-center gap-2 rounded-[8px] border-[1.6px] border-[var(--line-strong)] px-3 py-1.5 text-[10px]">
              {canSwitch ? <ShieldCheck size={14} className="text-tx-lime" /> : <ShieldAlert size={14} className="text-tx-sun" />}
              <span className={canSwitch ? "text-fg" : "text-tx-sun"}>{canSwitch ? "Audio policy engine ready" : `Switching unavailable: ${reason ?? "unknown"}`}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 px-5 py-4">
            <Button size="sm" variant="danger" icon={<Power size={14} />} onClick={() => send({ type: "window", action: "quit" })}>
              Quit Waypoint
            </Button>
            <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => update({ onboardingDone: false })}>
              Show welcome tour
            </Button>
          </div>
          <div className="px-5 py-5">
            <Parade />
          </div>
        </Group>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset priority list?"
        description="Your custom order and exclusions will be replaced with Waypoint's recommended ranking. Device names you set are kept."
        confirmLabel="Reset priorities"
        onConfirm={() => {
          send({ type: "resetPriorities", flow: "output" });
          send({ type: "resetPriorities", flow: "input" });
        }}
      />
    </>
  );
}
