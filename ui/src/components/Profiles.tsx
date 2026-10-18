import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "../store/store";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button, IconButton } from "./ui";
import { ProfilePal } from "../pals/Critter";
import { PalPicker, profilePal } from "../pals/PalPicker";

const PROFILE_COLORS = ["lime", "sky", "sun", "coral", "violet", "mint"] as const;

/** Each profile gets a stable accent by position, used for its avatar everywhere. */
export function profileColor(index: number) {
  return `var(--color-${PROFILE_COLORS[((index % PROFILE_COLORS.length) + PROFILE_COLORS.length) % PROFILE_COLORS.length]})`;
}

export function ProfileAvatar({ name, index, size = 32 }: { name: string; index: number; size?: number }) {
  return (
    <span
      className="font-pixel grid shrink-0 place-items-center rounded-[8px] border-[1.6px] border-fg text-on-accent"
      style={{ width: size, height: size, background: profileColor(index), fontSize: size * 0.42 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ManageProfilesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const profiles = useApp((s) => s.snapshot!.profiles);
  const activeId = useApp((s) => s.snapshot!.activeProfileId);
  const send = useApp((s) => s.send);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  const commit = (id: string) => {
    if (draft.trim()) send({ type: "renameProfile", id, name: draft.trim() });
    setEditing(null);
  };

  return (
    <>
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-ink-950/80" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="surface-raised fixed top-1/2 left-1/2 z-50 w-[min(500px,calc(100vw-32px))] rounded-[18px] p-6"
                initial={{ opacity: 0, scale: 0.96, x: "-50%", y: "-48%" }}
                animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
                exit={{ opacity: 0, scale: 0.96, x: "-50%", y: "-48%" }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-10 place-items-center rounded-[11px] border-[1.6px] border-fg bg-sky text-on-accent">
                    <Layers size={18} />
                  </span>
                  <div className="flex-1">
                    <Dialog.Title className="text-[22px] font-extrabold tracking-[-0.04em] text-fg">Profiles</Dialog.Title>
                    <Dialog.Description className="mt-1 text-[12.5px] leading-relaxed text-fg-3">
                      Each profile keeps its own output and microphone ranking and modes — e.g. "Work" with your headset first and "Movies" with the soundbar first. Switch from here, the tray, or a hotkey.
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <IconButton label="Close">
                      <X size={16} />
                    </IconButton>
                  </Dialog.Close>
                </div>

                <ul className="mt-5 flex flex-col gap-1.5">
                  {profiles.map((p, i) => (
                    <li key={p.id} className={clsx("flex items-center gap-3 rounded-[12px] border-[1.6px] bg-ink-850 px-3 py-2.5", p.id === activeId ? "border-tx-lime shadow-[2px_3px_0_0_var(--color-lime)]" : "border-[var(--line)]")}>
                      <ProfilePal name={profilePal(p, i)} active={p.id === activeId} box={36} />
                      <PalPicker profile={p} index={i} />
                      {editing === p.id ? (
                        <input
                          autoFocus
                          value={draft}
                          maxLength={40}
                          aria-label="Profile name"
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commit(p.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit(p.id);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="h-8 flex-1 rounded-[8px] border-[1.6px] border-tx-lime bg-ink-950 px-2.5 text-[14px] font-bold text-fg outline-none"
                        />
                      ) : (
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-medium text-fg">
                            {p.name}
                            {p.id === activeId && <span className="font-pixel ml-2 text-[9.5px] text-tx-lime">Active</span>}
                          </p>
                          <p className="truncate text-[12px] text-fg-3">{p.topOutput ? `#1 output: ${p.topOutput}` : "No connected output ranked first"}</p>
                        </div>
                      )}
                      {p.id !== activeId && editing !== p.id && (
                        <Button size="sm" variant="ghost" onClick={() => send({ type: "switchProfile", id: p.id })}>
                          Use
                        </Button>
                      )}
                      <IconButton
                        label="Rename"
                        onClick={() => {
                          setDraft(p.name);
                          setEditing(p.id);
                        }}
                      >
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton label={profiles.length <= 1 ? "Can't delete the only profile" : "Delete"} disabled={profiles.length <= 1} onClick={() => setDeleting({ id: p.id, name: p.name })} className="hover:!text-bad">
                        <Trash2 size={14} />
                      </IconButton>
                    </li>
                  ))}
                </ul>

                <form
                  className="mt-4 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send({ type: "createProfile", name: newName.trim() || `Profile ${profiles.length + 1}` });
                    setNewName("");
                  }}
                >
                  <input
                    value={newName}
                    maxLength={40}
                    placeholder="New profile name"
                    aria-label="New profile name"
                    onChange={(e) => setNewName(e.target.value)}
                    className="h-10 flex-1 rounded-[11px] border-[1.6px] border-[var(--line-strong)] bg-ink-950 px-3 text-[14px] text-fg outline-none placeholder:text-fg-4 focus:border-tx-lime"
                  />
                  <Button type="submit" variant="primary" icon={<Plus size={14} />}>
                    Create
                  </Button>
                </form>
                <p className="mt-2 text-[11.5px] text-fg-4">New profiles start as a copy of the active one.</p>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
    <ConfirmDialog
      open={deleting !== null}
      onOpenChange={(v) => !v && setDeleting(null)}
      title={`Delete "${deleting?.name ?? ""}"?`}
      description="Its output and microphone rankings and modes are removed for good. Your devices and other profiles aren't affected."
      confirmLabel="Delete profile"
      danger
      onConfirm={() => deleting && send({ type: "deleteProfile", id: deleting.id })}
    />
    </>
  );
}
