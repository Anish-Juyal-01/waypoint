import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useState } from "react";
import { bridge } from "../bridge/bridge";
import { useApp } from "../store/store";
import { Pal, PixelBurst } from "./Pixel";
import { Critter } from "../pals/Critter";
import type { CritterName } from "../pals/data";
import { Button, Eyebrow } from "./ui";

const toneStyle = {
  success: { bar: "var(--color-lime)", icon: CircleCheck },
  error: { bar: "var(--color-coral)", icon: CircleAlert },
  info: { bar: "var(--color-sky)", icon: Info },
} as const;

/** In-app toasts (verified switch results, notices). Announced politely to screen readers. */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-[340px] flex-col gap-3">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const { bar, icon: Icon } = toneStyle[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 60, rotate: 2 }}
              animate={{ opacity: 1, x: 0, rotate: 0 }}
              exit={{ opacity: 0, x: 60, transition: { duration: 0.16 } }}
              transition={{ type: "spring", stiffness: 480, damping: 30 }}
              className="pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-[12px] border-[1.6px] border-fg bg-ink-800 p-3.5 pl-4"
              style={{ boxShadow: `0 4px 0 0 ${bar}` }}
              role={t.tone === "error" ? "alert" : "status"}
            >
              <span className="absolute inset-y-0 left-0 w-[5px]" style={{ background: bar }} />
              <Icon size={17} strokeWidth={2.4} className="mt-[1px] shrink-0 text-fg" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold tracking-[-0.015em] text-fg">{t.title}</p>
                {t.text && <p className="font-pixel mt-1 text-[10px] text-fg-3">{t.text}</p>}
              </div>
              <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded-md p-0.5 text-fg-4 hover:text-fg">
                <X size={15} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function PreviewBanner() {
  if (!bridge.isPreview) return null;
  return (
    <div role="note" className="font-pixel relative z-30 flex h-7 shrink-0 items-center justify-center gap-2 bg-sun text-[10px] text-on-accent">
      <span className="size-[6px] bg-ink-900" />
      Preview data · not connected to Windows audio · run Waypoint.exe for real devices
    </div>
  );
}

const steps: { eyebrow: string; color: string; title: string; text: string; critter: CritterName; clip: string }[] = [
  {
    critter: "sprout",
    clip: "cheer",
    eyebrow: "01 · Rank",
    color: "var(--color-lime)",
    title: "Put your devices in order.",
    text: "Drag earbuds above headphones, headphones above speakers — whatever fits your day. Microphones get their own list.",
  },
  {
    critter: "fox",
    clip: "idle",
    eyebrow: "02 · Relax",
    color: "var(--color-sky)",
    title: "Waypoint switches for you.",
    text: "When a higher-ranked device connects it becomes the Windows default — and Waypoint checks that the switch really happened. Disconnect it and you fall back to the next one.",
  },
  {
    critter: "owlet",
    clip: "alarm",
    eyebrow: "03 · Tune",
    color: "var(--color-coral)",
    title: "Pick how firm it is.",
    text: "Balanced respects your manual changes until the next connection. Strict always enforces your ranking. Off just watches. Ctrl+Alt+F9 cycles devices from anywhere.",
  },
];

export function Onboarding() {
  const done = useApp((s) => s.snapshot?.settings.onboardingDone ?? true);
  const update = useApp((s) => s.updateSettings);
  const [step, setStep] = useState(0);
  const open = !done;
  const finish = () => {
    update({ onboardingDone: true });
    setStep(0);
  };
  const s = steps[step];

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && finish()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-ink-950/80" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed top-1/2 left-1/2 z-50 w-[min(560px,calc(100vw-32px))] rounded-[20px] border-[1.6px] border-fg bg-ink-800"
                style={{ boxShadow: "0 6px 0 0 var(--color-lime)" }}
                initial={{ opacity: 0, scale: 0.9, x: "-50%", y: "-45%" }}
                animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
                exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-48%" }}
                transition={{ type: "spring", stiffness: 360, damping: 28 }}
              >
                <div className="flex items-end gap-5 border-b-[1.6px] border-[var(--line)] px-8 pt-8 pb-6">
                  <div className="relative">
                    <PixelBurst trigger={step} count={12} distance={56} />
                    <Pal scale={5} hopKey={String(step)} />
                  </div>
                  <div className="pb-1">
                    <Dialog.Title className="text-[30px] leading-none font-extrabold tracking-[-0.05em] text-fg">hi, i'm echo.</Dialog.Title>
                    <p className="mt-2 text-[14px] text-fg-3">I keep your audio on the right device.</p>
                  </div>
                </div>

                <div className="relative min-h-[150px] overflow-hidden px-8 pt-6">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={step} className="relative pr-24" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ type: "spring", stiffness: 420, damping: 34 }}>
                      <span className="absolute top-1 right-0">
                        <Critter name={s.critter} clip={s.clip} scale={4} />
                      </span>
                      <Eyebrow color={s.color}>{s.eyebrow}</Eyebrow>
                      <p className="mt-3 text-[22px] leading-tight font-extrabold tracking-[-0.035em] text-fg">{s.title}</p>
                      <Dialog.Description className="mt-2 text-[14px] leading-relaxed text-fg-2">{s.text}</Dialog.Description>
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="flex items-center justify-between px-8 py-6">
                  <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
                    {steps.map((st, i) => (
                      <motion.span key={i} className={clsx("h-[8px]", i === step ? "" : "bg-ink-600")} animate={{ width: i === step ? 26 : 8 }} style={i === step ? { background: st.color } : undefined} />
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={finish}>
                      Skip
                    </Button>
                    {step < steps.length - 1 ? (
                      <Button variant="primary" onClick={() => setStep(step + 1)}>
                        Next →
                      </Button>
                    ) : (
                      <Button variant="primary" onClick={finish}>
                        Let's go
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
