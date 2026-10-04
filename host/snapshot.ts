// One page load's reads of the workspace in a single call (server/workspace/snapshot-access.ts):
// inspect's kinds and real paths, and the texts of files under `root`.
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { SnapshotInput, SnapshotOutput } from "./contract.ts";
import { inspect } from "./inspect.ts";

const within = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/** The error's code, or null: ENOENT means the file is not there. */
const codeOf = (cause: unknown) => (cause as NodeJS.ErrnoException | null)?.code ?? null;

/**
 * A file under `root` (its real path too) comes back as its text and the
 * sha256 of its bytes, as sdk.files.read reports them, or null when it is not
 * there. Anything else (outside the root, a link out of it, a folder, a read
 * that fails) is left out, so the server reads it the usual way.
 */
export async function snapshot(input: SnapshotInput): Promise<SnapshotOutput> {
  const { kinds, realPaths } = await inspect({ paths: input.kinds, realPaths: input.realPaths });
  const root = resolve(input.root);
  const realRoot = await realpath(root).catch(() => null);
  const files: SnapshotOutput["files"] = {};
  if (realRoot === null) return { kinds, realPaths, files };
  for (const path of input.files) {
    if (!within(resolve(path), root)) continue;
    let real: string;
    try {
      real = await realpath(path);
    } catch (cause) {
      if (codeOf(cause) === "ENOENT") files[path] = null;
      continue;
    }
    if (!within(real, realRoot)) continue;
    try {
      const bytes = await readFile(real);
      files[path] = { text: bytes.toString("utf8"), sha256: createHash("sha256").update(bytes).digest("hex") };
    } catch (cause) {
      if (codeOf(cause) === "ENOENT") files[path] = null;
    }
  }
  return { kinds, realPaths, files };
}
