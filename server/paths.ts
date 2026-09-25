// Path containment, for keeping the course and the factory apart and course
// files inside the course folder.
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Whether `path` is `folder` or somewhere under it, comparing the paths as written. */
export function isInside(folder: string, path: string): boolean {
  const rel = relative(resolve(folder), resolve(path));
  return rel === "" || (!isAbsolute(rel) && rel.split(sep)[0] !== "..");
}

/** Whether one of the two folders is, or holds, the other. */
export function overlaps(a: string, b: string): boolean {
  return isInside(a, b) || isInside(b, a);
}

/** `path` with every symbolic link resolved, or just resolved when it does not exist. */
export async function realPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}
