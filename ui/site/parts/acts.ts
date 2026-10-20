import type { CritterName } from "../../src/pals/data";

export const REPO = "https://github.com/Anish-Juyal-01/waypoint";
/** Straight to the file: GitHub serves the newest release's asset by name, as a download (no page in between). */
export const DOWNLOAD = `${REPO}/releases/latest/download/Waypoint.exe`;
export const RELEASES = `${REPO}/releases/latest`;
export const INSTALL_GUIDE = `${REPO}#download-and-run`;

export type ActId = "headphones" | "earbuds" | "desk" | "laptop" | "monitor";
export type Ink = "lime" | "violet" | "sun" | "sky" | "coral";

export interface Act {
  id: ActId;
  name: string;
  /** Short name painted on the amp's tape label. */
  tape: string;
  /** How it's connected, as Windows reports it. */
  via: string;
  pal: CritterName;
  ink: Ink;
  /** Where its amp stands on the stage, as a percentage of the stage width. */
  x: number;
}

/** The default running order: index 0 is #1. */
export const ACTS: Act[] = [
  { id: "headphones", name: "Headphones", tape: "HEADPHONES", via: "Bluetooth", pal: "fox", ink: "violet", x: 50 },
  { id: "earbuds", name: "Earbuds", tape: "EARBUDS", via: "Bluetooth", pal: "bun", ink: "lime", x: 68 },
  { id: "desk", name: "Desk speakers", tape: "DESK", via: "USB", pal: "beepo", ink: "sun", x: 32 },
  { id: "laptop", name: "Laptop speakers", tape: "LAPTOP", via: "Built-in", pal: "sprout", ink: "sky", x: 14 },
  { id: "monitor", name: "Monitor", tape: "MONITOR", via: "HDMI", pal: "owlet", ink: "coral", x: 86 },
];

export const act = (id: ActId) => ACTS.find((a) => a.id === id)!;

/** The rule Waypoint follows: the highest-ranked act that's connected plays. */
export function headliner(order: ActId[], connected: ReadonlySet<ActId>): ActId | null {
  return order.find((id) => connected.has(id)) ?? null;
}
