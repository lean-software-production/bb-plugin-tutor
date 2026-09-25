// The fallback when a course has no course.yaml: the lessons table in
// docs/iterations/README.md, "| Iteration | Spec |", with an optional
// "Set after" column.
import { dirname, resolve } from "node:path";
import { CourseLoadError } from "../../shared/ports.ts";
import { isInside } from "../paths.ts";
import type { LessonEntry } from "./manifest.ts";

const COLUMNS = { id: "iteration", spec: "spec", set: "set after" } as const;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(line: string): boolean {
  return cells(line).every((cell) => /^:?-+:?$/.test(cell));
}

/**
 * Reads the ledger table. A Spec link's target is a lesson's README.md, or
 * its folder; either way the folder is the lesson's `dir`, resolved against
 * `ledgerDir`, and it may not leave `courseRoot` as written.
 */
export function parseLedger(markdown: string, ledgerDir: string, displayPath: string, courseRoot: string): LessonEntry[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const headerIndex = lines.findIndex((line) => {
    if (!line.trim().startsWith("|")) return false;
    const header = cells(line).map((cell) => cell.toLowerCase());
    return header.includes(COLUMNS.id) && header.includes(COLUMNS.spec);
  });
  const headerLine = lines[headerIndex];
  if (headerLine === undefined) {
    throw new CourseLoadError(
      `${displayPath} has no lesson table with the columns Iteration and Spec.`,
    );
  }
  const header = cells(headerLine).map((cell) => cell.toLowerCase());
  const column = (name: string): number => header.indexOf(name);

  const lessons: LessonEntry[] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim().startsWith("|")) break;
    if (isSeparator(line)) continue;
    const row = cells(line);
    const where = `${displayPath}, line ${index + 1}`;
    const id = row[column(COLUMNS.id)] ?? "";
    if (!/^\d{3}$/.test(id)) {
      throw new CourseLoadError(`${where}: the iteration "${id}" should be three digits, like 001.`);
    }
    const link = LINK.exec(row[column(COLUMNS.spec)] ?? "");
    if (link === null) {
      throw new CourseLoadError(`${where}: the Spec column should be a link, like [Title](001-name/README.md).`);
    }
    const [, title = "", target = ""] = link;
    const targetPath = resolve(ledgerDir, target);
    if (!isInside(courseRoot, targetPath)) {
      throw new CourseLoadError(`${where}: ${target} is outside the course folder.`);
    }
    lessons.push({
      id,
      title: title.trim(),
      set: row[column(COLUMNS.set)] || null,
      dir: /\.md$/i.test(target) ? dirname(targetPath) : targetPath,
    });
  }
  if (lessons.length === 0) {
    throw new CourseLoadError(`${displayPath}'s lesson table has no rows.`);
  }
  return lessons;
}
