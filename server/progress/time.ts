/** ISO-8601 UTC to the second, as PROGRESS.yaml records it: "2026-09-25T10:12:00Z". */
export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
