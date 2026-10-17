import * as Popover from "@radix-ui/react-popover";
import clsx from "clsx";
import { Palette } from "lucide-react";
import type { ProfileView } from "../bridge/protocol";
import { useApp } from "../store/store";
import { Critter, defaultPal, fitScale, isCritter, PICKABLE } from "./Critter";
import type { CritterName } from "./data";

/** The creature a profile shows: its saved choice, or a default by position. */
export function profilePal(profile: ProfileView, index: number): CritterName {
  return isCritter(profile.pal) && PICKABLE.includes(profile.pal) ? profile.pal : defaultPal(index);
}

/** Popover grid of pixel creatures to pick a profile's pal from. */
export function PalPicker({ profile, index, className }: { profile: ProfileView; index: number; className?: string }) {
  const send = useApp((s) => s.send);
  const current = profilePal(profile, index);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          aria-label={`Change ${profile.name}'s pal`}
          title="Change pal"
          className={clsx(
            "grid size-7 place-items-center rounded-[7px] border-[1.6px] border-[var(--line-strong)] bg-ink-800 text-fg-3 transition-colors hover:border-fg hover:text-fg data-[state=open]:border-fg data-[state=open]:text-fg",
            className,
          )}
        >
          <Palette size={13} strokeWidth={2.4} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="start" sideOffset={8} collisionPadding={16} className="surface-raised z-50 w-[352px] rounded-[14px] p-3.5 outline-none">
          <p className="text-[15px] font-extrabold tracking-[-0.02em] text-fg">Pick a pal for {profile.name}</p>
          <p className="mt-0.5 text-[12.5px] text-fg-3">It wakes up when this profile is active.</p>
          <div role="radiogroup" aria-label="Pals" className="mt-3 grid grid-cols-6 gap-1.5">
            {PICKABLE.map((name) => {
              const selected = name === current;
              return (
                <Popover.Close asChild key={name}>
                  <button
                    role="radio"
                    aria-checked={selected}
                    aria-label={name}
                    title={name}
                    onClick={() => send({ type: "setProfilePal", id: profile.id, pal: name })}
                    className={clsx(
                      "grid aspect-square place-items-center rounded-[9px] border-[1.6px] transition-[transform,border-color] duration-150 hover:-translate-y-[2px]",
                      selected ? "border-fg bg-lime/25 shadow-[2px_2px_0_0_var(--color-lime)]" : "border-transparent hover:border-[var(--line-strong)]",
                    )}
                  >
                    <Critter name={name} scale={fitScale(name, 38)} blink={false} />
                  </button>
                </Popover.Close>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="font-pixel text-[9px] text-fg-4">{PICKABLE.length} pals</p>
            {profile.pal && (
              <Popover.Close asChild>
                <button onClick={() => send({ type: "setProfilePal", id: profile.id, pal: null })} className="text-[12px] font-semibold text-fg-3 underline-offset-2 hover:text-fg hover:underline">
                  Use default
                </button>
              </Popover.Close>
            )}
          </div>
          <Popover.Arrow className="fill-fg" width={12} height={6} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
