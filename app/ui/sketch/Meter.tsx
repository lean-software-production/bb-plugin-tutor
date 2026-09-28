import type { CSSProperties } from "react";
import { meterCount, meterPercent } from "../../sketch/meter.ts";
import { cx, toneClass, type Tone } from "../../sketch/tone.ts";

type MeterProps = {
  value: number;
  max: number;
  /** What the meter measures, for assistive tech: "Examples that hold". */
  label: string;
  /** Words after the count: "0 of 10 Examples hold". */
  unit?: string;
  /** The fill's accent. */
  tone?: Tone;
  className?: string;
};

/** The kit's progress meter, always with its count in words beside the bar. */
export function Meter({ value, max, label, unit, tone, className }: MeterProps) {
  const count = meterCount(value, max, unit);
  return (
    <span className={cx("tp-meter", className)}>
      <span
        className={cx("sk-meter", "tp-meter-bar", toneClass(tone))}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={count}
        style={{ "--sk-value": `${meterPercent(value, max)}%` } as CSSProperties}
      />
      <span className="tp-meter-count" aria-hidden="true">
        {count}
      </span>
    </span>
  );
}
