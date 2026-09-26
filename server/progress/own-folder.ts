// spec/, stand-ins/ and ../seeds are written only as real folders: a symbolic
// link there could point anywhere (spec -> ../src), and clearing or writing
// through it would touch the student's other work.
import { lstat } from "node:fs/promises";
import { join } from "node:path";

/**
 * `name` under `parentDir`, refusing anything there but a real folder (or
 * nothing yet). `label` names the folder in the refusal, as the student reads it.
 */
export async function ownFolder(parentDir: string, name: string, label: string): Promise<string> {
  const path = join(parentDir, name);
  const stats = await lstat(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
  if (stats?.isSymbolicLink() === true) {
    throw new Error(`${label} is a symbolic link, so Tutor will not write through it. Make it a real folder.`);
  }
  if (stats !== null && !stats.isDirectory()) {
    throw new Error(`${label} is a file, not a folder. Move it aside so Tutor can write there.`);
  }
  return path;
}
