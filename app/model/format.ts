// Small text formatters shared by every Tutor surface.

/** "003" → 3. Ids are validated three-digit strings upstream. */
export function homeworkNumber(id: string): number {
  return Number.parseInt(id, 10);
}

/** "003" → "Lesson 3": students read "lesson" for a homework (docs/tutor/GLOSSARY.md). */
export function homeworkLabel(id: string): string {
  return `Lesson ${homeworkNumber(id)}`;
}

/** Ledger "Day 3" reads "Set after day 3"; anything else ("Start here") is shown as written. */
export function setLabel(set: string | null): string | null {
  if (set === null || set.trim() === "") return null;
  const day = /^day\s+(\d+)$/i.exec(set.trim());
  return day === null ? set.trim() : `Set after day ${day[1]}`;
}

/** "Lesson 3 · Set after day 3", or just "Lesson 3". */
export function homeworkEyebrow(id: string, set: string | null): string {
  const label = setLabel(set);
  return label === null ? homeworkLabel(id) : `${homeworkLabel(id)} · ${label}`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Share of `total`, 0–100, safe for an empty lesson. */
export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function parseTime(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

/** "just now", "6m ago", "3h ago", "2d ago"; null for a missing or unreadable time. */
export function relativeTime(iso: string | null | undefined, now: number): string | null {
  const time = parseTime(iso);
  if (time === null) return null;
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  return `${Math.floor(elapsed / DAY)}d ago`;
}

/** Whole days since `iso` as "today", "1 day", "3 days"; null for a missing time. */
export function daysSince(iso: string | null | undefined, now: number): string | null {
  const time = parseTime(iso);
  if (time === null) return null;
  const days = Math.floor(Math.max(0, now - time) / DAY);
  return days === 0 ? "today" : plural(days, "day");
}

/** The first sentence of a prose paragraph, whitespace collapsed; "" when there is none. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = /^.*?[.!?](?=\s|$)/.exec(flat);
  return match === null ? flat : match[0];
}

/** The first `maxLines` lines of a block, and whether anything was cut. */
export function clipLines(text: string, maxLines: number): { text: string; clipped: boolean } {
  const lines = text.replace(/\s+$/, "").split("\n");
  if (lines.length <= maxLines) return { text: lines.join("\n"), clipped: false };
  return { text: lines.slice(0, maxLines).join("\n"), clipped: true };
}
