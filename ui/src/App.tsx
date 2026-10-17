import * as RadixTooltip from "@radix-ui/react-tooltip";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { ResizeEdges, TitleBar } from "./components/Chrome";
import { BootSplash } from "./components/BootSplash";
import { Onboarding, PreviewBanner, Toasts } from "./components/Overlays";
import { startBridge, useApp, type View } from "./store/store";
import { ActivityView } from "./views/ActivityView";
import { DevicesView, MicrophonesView } from "./views/DevicesView";
import { SettingsView } from "./views/SettingsView";
import { ease, spring } from "./lib/motion";

const views: Record<View, () => React.JSX.Element> = {
  devices: DevicesView,
  microphones: MicrophonesView,
  activity: ActivityView,
  settings: SettingsView,
};

function useCompact() {
  const query = "(max-width: 760px)";
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return compact;
}

export default function App() {
  const snapshot = useApp((s) => s.snapshot);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const compact = useCompact();

  useEffect(() => startBridge(), []);

  // Ctrl+1/2/3 switches views.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const map: Record<string, View> = { "1": "devices", "2": "microphones", "3": "activity", "4": "settings" };
      if (map[e.key]) {
        e.preventDefault();
        setView(map[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView]);

  const Current = views[view];

  return (
    <MotionConfig reducedMotion="user">
      <RadixTooltip.Provider delayDuration={350} skipDelayDuration={150}>
        <div className="app-backdrop" />
        <div className="app-grain" />
        <ResizeEdges />
        <div className="relative z-10 flex h-full flex-col">
          <PreviewBanner />
          <TitleBar compact={compact} />
          {snapshot ? (
            <div className="flex min-h-0 flex-1">
              <main className="scroll-area min-w-0 flex-1 overflow-y-auto">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={view}
                    initial={{ opacity: 0, y: 18, rotate: 0.4 }}
                    animate={{ opacity: 1, y: 0, rotate: 0, transition: spring }}
                    exit={{ opacity: 0, y: -8, transition: { duration: 0.14, ease: ease.in } }}
                    className="mx-auto w-full max-w-[1120px] px-6 pt-8 pb-16 sm:px-10"
                  >
                    <Current />
                  </motion.div>
                </AnimatePresence>
              </main>
            </div>
          ) : (
            <BootSplash />
          )}
        </div>
        <Toasts />
        <Onboarding />
      </RadixTooltip.Provider>
    </MotionConfig>
  );
}
