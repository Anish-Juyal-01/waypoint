import type { Transition } from "motion/react";

/** Shared motion presets so every animation in the app moves with the same feel. */
export const ease = {
  /** Fast start, long soft landing: entrances. */
  out: [0.16, 1, 0.3, 1] as const,
  /** Quick and quiet: exits. */
  in: [0.4, 0, 1, 1] as const,
};

/** Default spring for things moving into place. */
export const spring: Transition = { type: "spring", stiffness: 260, damping: 30, mass: 0.9 };
/** A little bounce, for small playful accents. */
export const springPop: Transition = { type: "spring", stiffness: 320, damping: 20, mass: 0.8 };
