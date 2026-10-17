import { Critter } from "./Critter";
import type { CritterName } from "./data";

const PARADE: { name: CritterName; clip: string }[] = [
  { name: "sprout", clip: "idle" },
  { name: "fox", clip: "idle" },
  { name: "owlet", clip: "idle" },
  { name: "chick", clip: "idle" },
  { name: "slime", clip: "idle" },
  { name: "bun", clip: "idle" },
  { name: "puff", clip: "sleep" },
  { name: "radish", clip: "idle" },
  { name: "shroom", clip: "idle" },
  { name: "jelly", clip: "idle" },
  { name: "beepo", clip: "idle" },
  { name: "mikey", clip: "sing" },
];

/** The whole cast in a row. */
export function Parade() {
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2" aria-hidden>
      {PARADE.map((p) => (
        <Critter key={p.name} name={p.name} clip={p.clip} scale={3} />
      ))}
    </div>
  );
}
