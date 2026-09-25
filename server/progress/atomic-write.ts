import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Writes via a sibling temp file and a rename, so readers never see half a
 * file. A file being replaced keeps its permissions.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const existingMode = await stat(path).then(
    (stats) => stats.mode & 0o777,
    () => null,
  );
  try {
    await writeFile(temp, content, "utf8");
    if (existingMode !== null) await chmod(temp, existingMode);
    await rename(temp, path);
  } catch (cause) {
    await rm(temp, { force: true });
    throw cause;
  }
}
