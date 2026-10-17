import clsx from "clsx";
import { Plus, Settings2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ProfilePal } from "../pals/Critter";
import { profilePal } from "../pals/PalPicker";
import { useApp } from "../store/store";
import { PixelBurst } from "./Pixel";
import { ManageProfilesDialog, profileColor } from "./Profiles";
import { IconButton } from "./ui";

/** Compact profile switcher: one chip per profile (with its pal), click to switch. Details live in Manage. */
export function ProfileBar({ actions }: { actions?: ReactNode }) {
  const profiles = useApp((s) => s.snapshot!.profiles);
  const activeId = useApp((s) => s.snapshot!.activeProfileId);
  const send = useApp((s) => s.send);
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <div className="mb-8 flex flex-wrap items-center gap-2" role="group" aria-label="Profiles">
      <span className="font-pixel mr-1 text-[10.5px] text-fg-4">Profile</span>
      {profiles.map((p, i) => {
        const active = p.id === activeId;
        return (
          <button
            key={p.id}
            onClick={() => send({ type: "switchProfile", id: p.id })}
            aria-pressed={active}
            title={active ? `${p.name} (active)` : `Switch to ${p.name}`}
            className={clsx(
              "press relative flex h-10 items-center gap-2 rounded-full border-2 pr-4 pl-1.5 text-[13.5px] font-bold tracking-[-0.015em]",
              active ? "border-fg text-fg" : "border-[var(--line)] text-fg-3 hover:border-fg hover:text-fg",
            )}
            style={active ? { boxShadow: `2px 3px 0 0 ${profileColor(i)}` } : undefined}
          >
            <PixelBurst trigger={active ? p.id : null} count={10} distance={40} />
            <ProfilePal name={profilePal(p, i)} active={active} box={28} />
            {p.name}
          </button>
        );
      })}
      <IconButton label="New profile" onClick={() => send({ type: "createProfile", name: `Profile ${profiles.length + 1}` })} className="!size-10 rounded-full border-2 border-dashed border-[var(--line-strong)]">
        <Plus size={16} strokeWidth={2.6} />
      </IconButton>
      <IconButton label="Manage profiles" onClick={() => setManageOpen(true)} className="!size-10">
        <Settings2 size={16} />
      </IconButton>
      {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      <ManageProfilesDialog open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  );
}
