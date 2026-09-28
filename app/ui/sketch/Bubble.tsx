import type { ComponentPropsWithoutRef } from "react";
import { cx } from "../../sketch/tone.ts";

/** The kit's speech bubble. The tail sits bottom left, or bottom right with `tailRight`. */
export function Bubble({ tailRight, className, ...rest }: ComponentPropsWithoutRef<"div"> & { tailRight?: boolean }) {
  return <div className={cx("sk-bubble", tailRight && "sk-tail-right", className)} {...rest} />;
}
