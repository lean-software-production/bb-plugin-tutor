// spec/ and seeds/ are written only as real folders directly under the
// factory root: a symbolic link there could point anywhere (spec -> ../src),
// and clearing or writing spec/ through it would touch the student's other work.
import { lstat } from "node:fs/promises";
import { join } from "node:path";

/** `name` under the factory root, refusing anything there but a real folder (or nothing yet). */
export async function ownFolder(factoryRoot: string, name: string): Promise<string> {
  const path = join(factoryRoot, name);
  const stats = await lstat(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
  if (stats?.isSymbolicLink() === true) {
    throw new Error(`${name}/ in the factory is a symbolic link, so Tutor will not write through it. Make it a real folder.`);
  }
  if (stats !== null && !stats.isDirectory()) {
    throw new Error(`${name} in the factory is a file, not a folder. Move it aside so Tutor can write to ${name}/.`);
  }
  return path;
}
