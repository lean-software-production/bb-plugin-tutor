import type { ReactNode } from "react";
import { stepColour } from "../../sketch/step-colour.ts";
import { cx } from "../../sketch/tone.ts";

type StepBadgeProps = {
  /** 0-based place in the list: a lesson's position, or a Rule's n - 1. */
  position: number;
  /** The number, or ✓ / ! */
  label: ReactNode;
  className?: string;
};

/** The kit's numbered step badge, in the step colour of its place in the list. */
export function StepBadge({ position, label, className }: StepBadgeProps) {
  return <span className={cx("sk-num", stepColour(position), className)}>{label}</span>;
}
