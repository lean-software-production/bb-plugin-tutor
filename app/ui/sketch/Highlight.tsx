import type { ComponentPropsWithoutRef } from "react";
import { cx } from "../../sketch/tone.ts";

/** The kit's highlighter swash on a phrase. `sweep` draws it in once (still under reduced motion). */
export function Highlight({ sweep, className, ...rest }: ComponentPropsWithoutRef<"span"> & { sweep?: boolean }) {
  return <span className={cx("sk-hl", sweep && "sk-sweep", className)} {...rest} />;
}
