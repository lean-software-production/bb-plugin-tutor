// A lesson's or Rule's step colour comes from its place in the list (D8):
// lessons pass their 0-based position, Rules pass n - 1. So lesson 0 is
// mustard, as in the mockup, and the colours wrap after five.
import type { Tone } from "./tone.ts";

export const STEPS = ["mustard", "teal", "forest", "coral", "blue"] as const satisfies readonly Tone[];

/** The kit modifier class for the step at `position` (0-based). */
export function stepColour(position: number): `sk-${(typeof STEPS)[number]}` {
  const index = ((Math.trunc(position) % STEPS.length) + STEPS.length) % STEPS.length;
  return `sk-${STEPS[index]!}`;
}
