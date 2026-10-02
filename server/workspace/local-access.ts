// A WorkspaceAccess over this machine's disk: what the machine's host entry
// does, without BB. Temporary: production uses it until Task 8 reaches the
// workspace through the machine, and then its body moves to
// test/helpers/disk-access.ts.
import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
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
