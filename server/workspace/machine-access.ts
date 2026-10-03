// WorkspaceAccess through the machine holding the workspace: reads and
// compare-and-swap writes with BB's sdk.files, lstat kinds and real paths with
// the host entry's inspect (sdk.files has neither).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { PathKind } from "../../layouts/types.ts";
import { WorkspaceUnreachableError, WriteConflictError, type WorkspaceAccess } from "./access.ts";
import type { TutorHostClient } from "./host-client.ts";

/** inspect's limit on paths per call (host/contract.ts). */
const INSPECT_PATHS = 256;

/** BB 0.44.0's codes for a call to a machine that is not connected (HTTP 502). */
const OFFLINE_CODES = new Set(["host_unavailable", "host_disconnected"]);

/** A BB error's code: BbHttpError carries it as `code`, the server's ApiError in `body.code`. */
export function codeOf(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null) return null;
  const { code, body } = cause as { code?: unknown; body?: { code?: unknown } | null };
  if (typeof code === "string") return code;
  return typeof body?.code === "string" ? body.code : null;
}

function isOffline(cause: unknown): boolean {
  const code = codeOf(cause);
  if (code !== null && OFFLINE_CODES.has(code)) return true;
  return cause instanceof Error && /\b(host is (not connected|offline|unreachable))\b/i.test(cause.message);
}

/** Runs a call to the machine, turning BB's "not connected" into WorkspaceUnreachableError. */
export async function onMachine<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    throw isOffline(cause) ? new WorkspaceUnreachableError({ cause }) : cause;
  }
}

export function createMachineAccess(bb: BbPluginApi, host: TutorHostClient, hostId: string): WorkspaceAccess {
  const files = bb.sdk.files;
  return {
    async kinds(paths) {
      const out: Record<string, PathKind> = {};
      for (let start = 0; start < paths.length; start += INSPECT_PATHS) {
        const chunk = paths.slice(start, start + INSPECT_PATHS);
        Object.assign(out, (await onMachine(() => host.inspect(hostId, { paths: chunk, realPaths: [] }))).kinds);
      }
      return out;
    },
    async realPath(path) {
      const { realPaths } = await onMachine(() => host.inspect(hostId, { paths: [], realPaths: [path] }));
      return realPaths[path] ?? path;
    },
    async read(path) {
      const file = await onMachine(() => files.read({ hostId, path })).catch((cause: unknown) => {
        if (codeOf(cause) === "ENOENT") return null;
        throw cause;
      });
      if (file === null) return null;
      const text = file.contentEncoding === "base64" ? Buffer.from(file.content, "base64").toString("utf8") : file.content;
      return { text, sha256: file.sha256 };
    },
    async write(path, text, expected) {
      const result = await onMachine(() =>
        files.write({
          hostId,
          path,
          content: text,
          contentEncoding: "utf8",
          createParents: true,
          ...(expected === undefined ? {} : { expectedSha256: expected }),
        }),
      );
      if (result.outcome === "conflict") throw new WriteConflictError(`${path} changed since it was read.`);
    },
    async remove(path) {
      await onMachine(() => files.remove({ hostId, path })).catch((cause: unknown) => {
        if (codeOf(cause) !== "ENOENT") throw cause;
      });
    },
  };
}
