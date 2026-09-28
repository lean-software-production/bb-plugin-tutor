import { cx } from "../../sketch/tone.ts";

/** The kit's hand-drawn tick. With a `label` it is announced; without one it is decoration. */
export function Tick({ label, className }: { label?: string; className?: string }) {
  return label === undefined ? (
    <span className={cx("sk-tick", className)} aria-hidden="true" />
  ) : (
    <span className={cx("sk-tick", className)} role="img" aria-label={label} />
  );
}
