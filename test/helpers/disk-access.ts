// A WorkspaceAccess over this machine's disk, for tests: what the machine's
// host entry and sdk.files do, without BB.
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { inspect } from "../../host/inspect.ts";
import { WriteConflictError, type WorkspaceAccess } from "../../server/workspace/access.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export function createDiskAccess(): WorkspaceAccess {
  return {
    // The host entry's own probe, called in-process.
    kinds: async (paths) => (await inspect({ paths: [...paths], realPaths: [] })).kinds,
    realPath: async (path) => (await inspect({ paths: [], realPaths: [path] })).realPaths[path] ?? path,
    async read(path) {
      const text = await readFile(path, "utf8").catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") return null;
        throw cause;
      });
      return text === null ? null : { text, sha256: sha(text) };
    },
    async write(path, text, expected) {
      if (expected !== undefined) {
        const current = await readFile(path, "utf8").then(sha, () => null);
        if (current !== expected) throw new WriteConflictError(`${path} changed since it was read.`);
      }
      // Via a hidden sibling temp file and a rename, so readers never see half a
      // file; a file being replaced keeps its permissions.
      const dir = dirname(path);
      await mkdir(dir, { recursive: true });
      const temp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
      const existingMode = await stat(path).then(
        (stats) => stats.mode & 0o777,
        () => null,
      );
      try {
        await writeFile(temp, text, "utf8");
        if (existingMode !== null) await chmod(temp, existingMode);
        await rename(temp, path);
      } catch (cause) {
        await rm(temp, { force: true });
        throw cause;
      }
    },
    async remove(path) {
      await unlink(path).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== "ENOENT") throw cause;
      });
    },
  };
}
