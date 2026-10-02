// A WorkspaceAccess over this machine's disk: what the machine's host entry
// does, without BB. Temporary: production uses it until Task 8 reaches the
// workspace through the machine, and then its body moves to
// test/helpers/disk-access.ts.
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PathKind } from "../../layouts/types.ts";
import { WriteConflictError, type WorkspaceAccess } from "./access.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export function createLocalAccess(): WorkspaceAccess {
  return {
    async kinds(paths) {
      const out: Record<string, PathKind> = {};
      for (const path of paths) {
        const stats = await lstat(path).catch(() => null);
        out[path] = stats === null ? "none" : stats.isSymbolicLink() ? "link" : stats.isDirectory() ? "folder" : "file";
      }
      return out;
    },
    realPath: (path) => realpath(path).catch(() => resolve(path)),
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
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, text, "utf8");
      await rename(temp, path);
    },
    async remove(path) {
      await unlink(path).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== "ENOENT") throw cause;
      });
    },
  };
}
