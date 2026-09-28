import type { ComponentPropsWithoutRef } from "react";
import { cx } from "../../sketch/tone.ts";

/** The kit's paper patch: cream paper behind a drawing, so its ink reads in dark mode. */
export function Patch({ className, ...rest }: ComponentPropsWithoutRef<"span">) {
  return <span className={cx("sk-patch", className)} {...rest} />;
}
