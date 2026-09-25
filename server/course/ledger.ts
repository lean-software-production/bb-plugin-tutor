// The fallback when a course has no course.yaml: the homeworks table in
// docs/iterations/README.md, "| Iteration | Spec | Set after |".
import { dirname, resolve } from "node:path";
import { CourseLoadError } from "../../shared/ports.ts";
import { isInside } from "../paths.ts";
import type { HomeworkEntry } from "./manifest.ts";

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
 * Reads the ledger table. A Spec link's target is a homework's README.md, or
 * its folder; either way the folder is the homework's `dir`, resolved against
 * `ledgerDir`, and it may not leave `courseRoot` as written.
 */
export function parseLedger(markdown: string, ledgerDir: string, displayPath: string, courseRoot: string): HomeworkEntry[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const headerIndex = lines.findIndex((line) => {
    if (!line.trim().startsWith("|")) return false;
    const header = cells(line).map((cell) => cell.toLowerCase());
    return Object.values(COLUMNS).every((name) => header.includes(name));
  });
  const headerLine = lines[headerIndex];
  if (headerLine === undefined) {
    throw new CourseLoadError(
      `${displayPath} has no homework table with the columns Iteration, Spec and Set after.`,
    );
  }
  const header = cells(headerLine).map((cell) => cell.toLowerCase());
  const column = (name: string): number => header.indexOf(name);

  const homeworks: HomeworkEntry[] = [];
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
    homeworks.push({
      id,
      title: title.trim(),
      set: row[column(COLUMNS.set)] || null,
      dir: /\.md$/i.test(target) ? dirname(targetPath) : targetPath,
    });
  }
  if (homeworks.length === 0) {
    throw new CourseLoadError(`${displayPath}'s homework table has no rows.`);
  }
  return homeworks;
}
