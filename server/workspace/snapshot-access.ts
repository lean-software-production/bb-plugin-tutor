// One host call per page load: a WorkspaceAccess that answers a load's reads
// from one snapshot of what the last load of the same workspace asked for
// (host/snapshot.ts), and asks the live access for anything else. Writes and
// removes always go to the live access, so their compare-and-swap checks run
// against the machine's file, never against the snapshot. A snapshot lives
// for one load only.
import type { PathKind } from "../../layouts/types.ts";
import type { FileText, WorkspaceAccess } from "./access.ts";

/** host/contract.ts's limits on a snapshot call. */
const LIMITS = { kinds: 256, realPaths: 16, files: 64 } as const;

export interface SnapshotWant {
  kinds: string[];
  realPaths: string[];
  files: string[];
}

/** What the machine answered; a file left out of `files` was not served and is read live. */
export interface Snapshot {
  kinds: Record<string, PathKind>;
  realPaths: Record<string, string>;
  files: Record<string, FileText | null>;
}

export type SnapshotMemory = ReturnType<typeof createSnapshotMemory>;

/** What the last load of each workspace asked the machine, to fetch in one call next time. */
export function createSnapshotMemory() {
  const seen = new Map<string, SnapshotWant>();
  return {
    get: (key: string): SnapshotWant | undefined => seen.get(key),
    set: (key: string, want: SnapshotWant): void => {
      seen.set(key, want);
    },
  };
}

export function createSnapshotAccess(
  live: WorkspaceAccess,
  fetch: (want: SnapshotWant) => Promise<Snapshot>,
  memory: SnapshotMemory,
  hostId: string,
  root: string,
) {
  const key = `${hostId}\u0000${root}`;
  const asked = { kinds: new Set<string>(), realPaths: new Set<string>(), files: new Set<string>() };
  let snap: Snapshot | null = null;
  const access: WorkspaceAccess = {
    async kinds(paths) {
      for (const path of paths) asked.kinds.add(path);
      const missing = paths.filter((path) => snap?.kinds[path] === undefined);
      const fetched = missing.length === 0 ? {} : await live.kinds(missing);
      return Object.fromEntries(paths.map((path) => [path, snap?.kinds[path] ?? fetched[path] ?? "none"]));
    },
    async realPath(path) {
      asked.realPaths.add(path);
      return snap?.realPaths[path] ?? live.realPath(path);
    },
    async read(path) {
      asked.files.add(path);
      if (snap !== null && Object.hasOwn(snap.files, path)) return snap.files[path] ?? null;
      return live.read(path);
    },
    write: (path, text, expected) => live.write(path, text, expected),
    remove: (path) => live.remove(path),
  };
  return {
    access,
    /** Fetches, in one call, what the last load of this workspace asked for; nothing on its first load. */
    async prefetch(): Promise<void> {
      const want = memory.get(key);
      if (want === undefined || want.kinds.length + want.realPaths.length + want.files.length === 0) return;
      snap = await fetch({
        kinds: want.kinds.slice(0, LIMITS.kinds),
        realPaths: want.realPaths.slice(0, LIMITS.realPaths),
        files: want.files.slice(0, LIMITS.files),
      });
    },
    /** Call when the load ends: what it asked becomes the next load's prefetch. */
    remember(): void {
      memory.set(key, { kinds: [...asked.kinds], realPaths: [...asked.realPaths], files: [...asked.files] });
    },
  };
}
