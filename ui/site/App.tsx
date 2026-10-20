import { MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { Download, Moon, Sun } from "lucide-react";
import { Wordmark } from "../src/components/Wordmark";
import { DOWNLOAD, INSTALL_GUIDE, REPO } from "./parts/acts";
import { Gig } from "./parts/Gig";
import { HouseRules } from "./parts/HouseRules";
import { Lineup } from "./parts/Lineup";
import { RunningOrder } from "./parts/RunningOrder";
import { Ticket } from "./parts/Ticket";
import { pushLevel } from "./stubs/store";

type Theme = "light" | "dark";
const KEY = "waypoint-site-theme";

function readSaved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function useTheme() {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const [saved, setSaved] = useState<Theme | null>(readSaved);
  const [system, setSystem] = useState<Theme>(media.matches ? "light" : "dark");
  const theme = saved ?? system;

  useEffect(() => {
    const onChange = () => setSystem(media.matches ? "light" : "dark");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [media]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    setSaved(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private window: the choice just isn't remembered */
    }
  };
  return { theme, toggle };
}

/** A steady fake beat so the masthead letters bob like they do in the app. */
function useBeat() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const id = window.setInterval(() => {
      const t = (performance.now() - start) / 1000;
      const kick = Math.max(0, Math.sin(t * Math.PI * 2 * 1.9)) ** 6;
      pushLevel("output", 0.05 + kick * 0.35);
    }, 50);
    return () => window.clearInterval(id);
  }, []);
}

export function App() {
  const { theme, toggle } = useTheme();
  useBeat();

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-backdrop" aria-hidden />
      <div className="app-grain" aria-hidden />

      <header className="masthead">
        <a href="#top" className="shrink-0" aria-label="Waypoint, back to top">
          <Wordmark />
        </a>
        <nav className="flex items-center gap-2 sm:gap-3">
          <button type="button" className="icon-btn icon-btn-lg" onClick={toggle} aria-label={theme === "light" ? "Use dark theme" : "Use light theme"}>
            {theme === "light" ? <Moon size={17} strokeWidth={2.3} /> : <Sun size={17} strokeWidth={2.3} />}
          </button>
          <a href={REPO} className="hidden font-mono text-[13px] text-fg-2 hover:text-fg sm:inline">
            GitHub
          </a>
          <a href={DOWNLOAD} className="btn-ink btn-sm">
            <Download size={15} strokeWidth={2.5} />
            <span className="hidden sm:inline">Download for Windows</span>
            <span className="sm:hidden">Download</span>
          </a>
        </nav>
      </header>

      <main id="top" className="relative z-[1]">
        <Gig />
        <RunningOrder />
        <HouseRules />
        <Lineup />
        <Ticket />
      </main>

      <footer className="relative z-[1] mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 pt-10 pb-14 md:flex-row md:items-end md:justify-between md:px-8">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-[40ch] text-[0.95rem] text-fg-3">Ranks your audio devices so Windows always plays on the best one connected.</p>
        </div>
        <div className="flex flex-col gap-1 font-mono text-[13px] text-fg-2 md:items-end">
          <a className="link" href={REPO}>
            Source on GitHub
          </a>
          <a className="link" href={INSTALL_GUIDE}>
            How to install
          </a>
          <a className="link" href={`${REPO}/releases`}>
            Release notes
          </a>
          <span className="text-fg-3">MIT licence. Made by Anish Juyal.</span>
        </div>
      </footer>
    </MotionConfig>
  );
}
