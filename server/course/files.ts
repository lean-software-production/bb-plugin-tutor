// File reading for the course loader: absent files are null, and every other
// failure becomes a CourseLoadError the student can read.
import { readFile, readdir, stat } from "node:fs/promises";
import { CourseLoadError } from "../../shared/ports.ts";

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function unreadable(displayPath: string, error: unknown): CourseLoadError {
  const reason = error instanceof Error ? error.message : String(error);
  return new CourseLoadError(`Could not read ${displayPath}: ${reason}`);
}

export async function readTextIfPresent(path: string, displayPath: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw unreadable(displayPath, error);
  }
}

/** File names in `path`, or null when the folder does not exist. */
export async function listFilesIfPresent(path: string, displayPath: string): Promise<string[] | null> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    if (isMissing(error)) return null;
    throw unreadable(displayPath, error);
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
