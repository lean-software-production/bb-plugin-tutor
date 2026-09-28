// The numbers behind the kit's progress meter (app/ui/sketch/Meter.tsx).

/** The filled share of the bar, 0–100, clamped. */
export function meterPercent(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.round(Math.min(100, Math.max(0, (value / max) * 100)));
}

/** The count the meter always shows beside the bar: "3 of 10", "0 of 10 Examples hold". */
export function meterCount(value: number, max: number, unit?: string): string {
  return unit ? `${value} of ${max} ${unit}` : `${value} of ${max}`;
}
