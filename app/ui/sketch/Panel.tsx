import type { ComponentPropsWithoutRef } from "react";
import { cx, toneClass, type Tone } from "../../sketch/tone.ts";

type PanelProps = ComponentPropsWithoutRef<"div"> & {
  /** The accent of the outline and wash. */
  tone?: Tone;
  dashed?: boolean;
  /** A pale wash of the accent behind the content (on by default, as in the mockup). */
  wash?: boolean;
  as?: "div" | "article" | "section" | "aside";
};

/** The kit's wobbly-outlined panel. */
export function Panel({ tone, dashed, wash = true, as: Tag = "div", className, ...rest }: PanelProps) {
  return <Tag className={cx("sk-panel", toneClass(tone), dashed && "sk-dashed", wash && "sk-wash", className)} {...rest} />;
}
