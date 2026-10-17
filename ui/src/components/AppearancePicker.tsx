import clsx from "clsx";
import { Check } from "lucide-react";
import type { ThemePref } from "../lib/theme";
import { useApp } from "../store/store";
import { themeOptions, useSetTheme } from "./ThemeToggle";

const palettes = {
  dark: { bg: "#1d1023", card: "#29172f", line: "#ffe4ef", text: "#ffe4ef", muted: "#826584" },
  light: { bg: "#f6f0e4", card: "#fdf9f1", line: "#1f2a78", text: "#1f2a78", muted: "#9599b8" },
};

/** A tiny pixel mock of the app in one palette. */
function Mock({ p }: { p: (typeof palettes)["dark"] }) {
  return (
    <div className="flex h-full w-full gap-1.5 p-2" style={{ background: p.bg }}>
      <div className="flex w-[22%] flex-col gap-1">
        <span className="h-[6px] rounded-[2px]" style={{ background: "#ff4f9a", border: `1px solid ${p.line}` }} />
        <span className="h-[4px] w-3/4 rounded-[1px]" style={{ background: p.muted }} />
        <span className="h-[4px] w-2/3 rounded-[1px]" style={{ background: p.muted }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="rounded-[4px] p-1.5" style={{ background: p.card, border: `1px solid ${p.line}`, boxShadow: "1px 2px 0 0 #ff4f9a" }}>
          <span className="block h-[5px] w-1/2 rounded-[1px]" style={{ background: p.text }} />
          <div className="mt-1 flex gap-[2px]">
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="size-[4px]" style={{ background: i < 5 ? "#ff4f9a" : p.muted }} />
            ))}
          </div>
        </div>
        <div className="h-[10px] rounded-[3px]" style={{ background: p.card, border: `1px solid ${p.muted}` }} />
      </div>
    </div>
  );
}

export function AppearancePicker() {
  const theme = useApp((s) => s.snapshot!.settings.theme);
  const setTheme = useSetTheme();

  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3 p-5 max-sm:grid-cols-1">
      {themeOptions.map(({ value, label, icon: Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={selected}
            onClick={(e) => setTheme(value as ThemePref, e)}
            className={clsx(
              "press group overflow-hidden rounded-[12px] border-[1.6px] text-left",
              selected ? "border-fg shadow-[2px_3px_0_0_var(--color-lime)]" : "border-[var(--line-strong)] shadow-[2px_3px_0_0_var(--color-ink-600)] hover:border-fg",
            )}
          >
            <div className="relative h-[86px] border-b-[1.6px] border-[var(--line)]">
              {value === "system" ? (
                <div className="flex h-full">
                  <div className="w-1/2 overflow-hidden">
                    <div className="h-full w-[200%]">
                      <Mock p={palettes.light} />
                    </div>
                  </div>
                  <div className="relative w-1/2 overflow-hidden">
                    <div className="absolute inset-y-0 right-0 h-full w-[200%]">
                      <Mock p={palettes.dark} />
                    </div>
                  </div>
                </div>
              ) : (
                <Mock p={palettes[value as "light" | "dark"]} />
              )}
            </div>
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <Icon size={16} strokeWidth={2.4} className="text-fg" />
              <span className="flex-1 text-[14px] font-bold tracking-[-0.015em] text-fg">{label}</span>
              <span className={clsx("grid size-5 place-items-center rounded-[5px] border-[1.6px]", selected ? "border-fg bg-lime text-on-accent" : "border-fg-4")}>
                {selected && <Check size={12} strokeWidth={3.2} />}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
