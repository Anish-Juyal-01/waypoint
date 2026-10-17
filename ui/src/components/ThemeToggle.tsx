import clsx from "clsx";
import { motion } from "motion/react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { MouseEvent } from "react";
import { applyTheme, type ThemePref } from "../lib/theme";
import { useApp } from "../store/store";
import { Tooltip } from "./ui";

export const themeOptions: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Picks a theme: animates from the click point, then persists through the host. */
export function useSetTheme() {
  const update = useApp((s) => s.updateSettings);
  return (value: ThemePref, e?: MouseEvent) => {
    const r = (e?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect();
    applyTheme(value, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined);
    update({ theme: value });
  };
}

/** Compact three-way segmented control for the title bar. */
export function ThemeToggle() {
  const theme = useApp((s) => s.snapshot?.settings.theme ?? "system");
  const setTheme = useSetTheme();

  return (
    <div role="radiogroup" aria-label="Theme" className="flex h-8 items-center gap-0.5 rounded-[9px] border-[1.6px] border-fg p-[2px]">
      {themeOptions.map(({ value, label, icon: Icon }) => {
        const selected = theme === value;
        return (
          <Tooltip key={value} content={`${label} theme`} side="bottom">
            <button
              role="radio"
              aria-checked={selected}
              aria-label={`${label} theme`}
              onClick={(e) => setTheme(value, e)}
              className={clsx("relative grid h-full w-8 place-items-center rounded-[6px] transition-colors", selected ? "text-on-accent" : "text-fg-3 hover:text-fg")}
            >
              {selected && <motion.span layoutId="theme-pill" className="absolute inset-0 rounded-[6px] bg-fg" transition={{ type: "spring", stiffness: 520, damping: 36 }} />}
              <Icon size={14} strokeWidth={2.4} className={clsx("relative", selected && "text-ink-900")} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
