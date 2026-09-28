// The kit's colour modifiers and a class joiner for the sketch wrappers.

/** A kit accent: the class `sk-<tone>` sets --sk-accent and its text colours on a piece. */
export type Tone = "mustard" | "teal" | "forest" | "coral" | "blue" | "rust" | "deep-teal";

export function toneClass(tone: Tone | undefined): string | undefined {
  return tone === undefined ? undefined : `sk-${tone}`;
}

/** Joins the truthy class names. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
