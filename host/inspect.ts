// lstat and realpath on the machine, for layout detection (layouts/types.ts LayoutProbe).
import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { LayoutProbe, PathKind } from "../layouts/types.ts";
import type { InspectInput, InspectOutput } from "./contract.ts";

/** What is at `path` itself: a symbolic link is a link, wherever it leads. */
async function kindOf(path: string): Promise<PathKind> {
  const stats = await lstat(path).catch(() => null);
  return stats === null ? "none" : stats.isSymbolicLink() ? "link" : stats.isDirectory() ? "folder" : "file";
}

/** The path with every link followed; a path that does not resolve comes back as itself. */
function realPathOf(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

export async function inspect(input: InspectInput): Promise<InspectOutput> {
  const kinds: Record<string, PathKind> = {};
  for (const path of input.paths) kinds[path] = await kindOf(path);
  const realPaths: Record<string, string> = {};
  for (const path of input.realPaths) realPaths[path] = await realPathOf(path);
  return { kinds, realPaths };
}

/** Layout detection's questions, answered on this machine directly. */
export const localProbe: LayoutProbe = {
  kinds: async (paths) => (await inspect({ paths: [...paths], realPaths: [] })).kinds,
  realPath: realPathOf,
};
