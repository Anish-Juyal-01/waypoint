import * as RadixSwitch from "@radix-ui/react-switch";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Headline } from "./Headline";

/* ── Button ──────────────────────────────────────────────
   Chunky, outlined, hard shadow that collapses on press. */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "light";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "press inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold tracking-[-0.01em]",
        "disabled:pointer-events-none disabled:opacity-35",
        size === "sm" ? "h-8 rounded-[9px] px-3 text-[12.5px]" : "h-10 rounded-[11px] px-4 text-[13.5px]",
        variant === "primary" && "border-[1.6px] border-fg bg-lime text-on-accent shadow-[2px_3px_0_0_var(--ink-2)] hover:bg-lime-2",
        variant === "light" && "border-[1.6px] border-fg bg-neutral text-on-accent shadow-[2px_3px_0_0_var(--color-lime)]",
        variant === "secondary" && "border-[1.6px] border-[var(--line-strong)] bg-ink-800 text-fg shadow-[2px_3px_0_0_var(--color-ink-600)] hover:border-fg",
        variant === "ghost" && "!shadow-none text-fg-2 hover:bg-fg/[0.06] hover:text-fg",
        variant === "danger" && "border-[1.6px] border-tx-coral bg-coral/10 text-tx-coral shadow-[2px_3px_0_0_var(--color-coral)] hover:bg-coral/20",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  function IconButton({ label, className, children, ...rest }, ref) {
    return (
      <Tooltip content={label}>
        <button
          ref={ref}
          aria-label={label}
          className={clsx(
            "inline-flex size-8 items-center justify-center rounded-[9px] text-fg-3 transition-[background,color,transform] duration-150",
            "hover:bg-fg/[0.07] hover:text-fg active:translate-y-[1px] disabled:pointer-events-none disabled:opacity-35",
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </Tooltip>
    );
  },
);

/* ── Switch: outlined pill, square-ish thumb that springs across. ── */

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <RadixSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={clsx(
        "group relative inline-flex h-[24px] w-[42px] shrink-0 items-center rounded-[8px] border-[1.6px] transition-colors duration-150",
        "border-fg-4 bg-ink-900 data-[state=checked]:border-fg data-[state=checked]:bg-lime",
        "disabled:cursor-not-allowed disabled:opacity-35",
      )}
    >
      <RadixSwitch.Thumb
        className={clsx(
          "block size-[14px] translate-x-[4px] rounded-[4px] bg-fg-3",
          "transition-transform duration-200 [transition-timing-function:var(--ease-spring)]",
          "group-active:scale-x-125 data-[state=checked]:translate-x-[20px] data-[state=checked]:bg-on-accent",
        )}
      />
    </RadixSwitch.Root>
  );
}

/* ── Tooltip ─────────────────────────────────────────────── */

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={7}
          className="z-50 max-w-[260px] rounded-[8px] border-[1.6px] border-fg bg-ink-900 px-2.5 py-1.5 text-[12px] leading-snug font-medium text-fg shadow-[2px_3px_0_0_var(--color-lime)]"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/* ── Badge: pixel-type chip with a square status dot. ── */

export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "echo";

const toneClass: Record<Tone, string> = {
  neutral: "border-[var(--line-strong)] text-fg-2",
  ok: "border-tx-mint/60 text-tx-mint",
  warn: "border-tx-sun/50 text-tx-sun",
  bad: "border-tx-coral/50 text-tx-coral",
  info: "border-tx-sky/50 text-tx-sky",
  echo: "border-fg bg-lime text-on-accent",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx("font-pixel inline-flex h-[24px] items-center gap-1.5 whitespace-nowrap rounded-full border-2 px-2.5 text-[10.5px] leading-none", toneClass[tone], className)}>
      {dot && <span className="size-[6px] rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ── Section label: coloured pixel square + pixel caps, like a chapter marker. ── */

export function Eyebrow({ children, color = "var(--color-lime)", className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={clsx("font-pixel inline-flex items-center gap-2 text-[11px] text-fg-2", className)}>
      <span className="size-[8px] shrink-0" style={{ background: color }} />
      {children}
    </span>
  );
}

export function SectionTitle({ children, aside, color }: { children: ReactNode; aside?: ReactNode; color?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="headline text-[24px]" style={color ? ({ "--mark": color } as React.CSSProperties) : undefined}>
        {children}
      </h2>
      {aside}
    </div>
  );
}

/** Zine section heading: a display title, an optional mono note, and controls on the right. */
export function ZineHeading({ title, note, aside, id, size = 30 }: { title: string; note?: ReactNode; aside?: ReactNode; id?: string; size?: number }) {
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={id} style={{ fontSize: size }}>
          <Headline text={title} />
        </h2>
        {note && <span className="font-pixel text-[10.5px] text-fg-3">{note}</span>}
      </div>
      {aside}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="font-pixel inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] border-[1.6px] border-fg-3 bg-ink-900 px-1.5 text-[10.5px] text-fg shadow-[2px_2px_0_0_var(--color-fg-3)]">
      {children}
    </kbd>
  );
}
