import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { snapshot } from "../../host/snapshot.ts";
import { createDiskAccess } from "../../test/helpers/disk-access.ts";
import { WriteConflictError, type WorkspaceAccess } from "./access.ts";
import { createSnapshotAccess, createSnapshotMemory, type Snapshot, type SnapshotWant } from "./snapshot-access.ts";

const PROGRESS_TEXT = 'iteration: "000"\nnote: "café ✓"\n';

async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "snap-access-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".tutor"));
  await writeFile(join(root, ".tutor/progress.yaml"), PROGRESS_TEXT);
  return root;
}

/** The disk, recording each call that would go to the machine. */
function countingAccess(live: WorkspaceAccess, calls: string[]): WorkspaceAccess {
  return {
    kinds: (paths) => (calls.push("kinds"), live.kinds(paths)),
    realPath: (path) => (calls.push("realPath"), live.realPath(path)),
    read: (path) => (calls.push("read"), live.read(path)),
    write: (path, text, expected) => (calls.push("write"), live.write(path, text, expected)),
    remove: (path) => (calls.push("remove"), live.remove(path)),
  };
}

/** The host entry's snapshot, called in-process. */
const snapshotOf = (root: string) => (want: SnapshotWant): Promise<Snapshot> => snapshot({ root, ...want });

test("the second load asks the machine once; misses fall through to the live access", async (t) => {
  const root = await workspace(t);
  const calls: string[] = [];
  const live = countingAccess(createDiskAccess(), calls);
  const fetches: SnapshotWant[] = [];
  const memory = createSnapshotMemory();
  const load = async (extra?: string) => {
    const snapshotted = createSnapshotAccess(
      live,
      (want) => {
        fetches.push(want);
        return snapshotOf(root)(want);
      },
      memory,
      "host_1",
      root,
    );
    await snapshotted.prefetch();
    const { access } = snapshotted;
    const kinds = await access.kinds([join(root, ".tutor")]);
    const real = await access.realPath(root);
    const file = await access.read(join(root, ".tutor/progress.yaml"));
    const missing = extra === undefined ? undefined : await access.read(extra);
    snapshotted.remember();
    return { kinds, real, file, missing };
  };
  const first = await load(); // learns the paths: live calls, no fetch
  assert.equal(fetches.length, 0);
  assert.deepEqual(calls, ["kinds", "realPath", "read"]);
  calls.length = 0;
  const second = await load(); // one fetch, no live calls
  assert.equal(fetches.length, 1);
  assert.deepEqual(calls, []);
  assert.deepEqual(second, first, "the snapshot answers as the live access did");
  calls.length = 0;
  const third = await load(join(root, "new.txt")); // a path the last load didn't ask for goes live
  assert.equal(fetches.length, 2);
  assert.deepEqual(calls, ["read"]);
  assert.equal(third.missing, null);
  calls.length = 0;
  await load();
  assert.ok(fetches.at(-1)?.files.includes(join(root, "new.txt")), "and is in the next load's snapshot");
  assert.deepEqual(calls, []);
});

test("a file the snapshot leaves out is read live", async (t) => {
  const root = await workspace(t);
  const calls: string[] = [];
  const live = countingAccess(createDiskAccess(), calls);
  const memory = createSnapshotMemory();
  memory.set(`host_1\u0000${root}`, { kinds: [], realPaths: [], files: [join(root, ".tutor/progress.yaml")] });
  const { access, prefetch } = createSnapshotAccess(live, async () => ({ kinds: {}, realPaths: {}, files: {} }), memory, "host_1", root);
  await prefetch();
  assert.equal((await access.read(join(root, ".tutor/progress.yaml")))?.text, PROGRESS_TEXT);
  assert.deepEqual(calls, ["read"]);
});

test("a write after a snapshotted read still checks the live file", async (t) => {
  const root = await workspace(t);
  const path = join(root, ".tutor/progress.yaml");
  const calls: string[] = [];
  const live = countingAccess(createDiskAccess(), calls);
  const memory = createSnapshotMemory();
  memory.set(`host_1\u0000${root}`, { kinds: [], realPaths: [], files: [path] });
  const { access, prefetch } = createSnapshotAccess(live, snapshotOf(root), memory, "host_1", root);
  await prefetch();
  const read = await access.read(path);
  assert.ok(read !== null);
  assert.deepEqual(calls, [], "the read came from the snapshot");
  await writeFile(path, 'iteration: "001"\n'); // the file changes on the machine after the snapshot
  await assert.rejects(access.write(path, "x", read.sha256), WriteConflictError);
  assert.deepEqual(calls, ["write"], "the write went to the machine");
  // The snapshot is still the one this load took: a new load takes a new one.
  const next = createSnapshotAccess(live, snapshotOf(root), memory, "host_1", root);
  await next.prefetch();
  assert.equal((await next.access.read(path))?.text, 'iteration: "001"\n');
});

test("the snapshot's sha256 is the hex sha256 of the file's bytes, as sdk.files.read and the disk access report it", async (t) => {
  const root = await workspace(t);
  const path = join(root, ".tutor/progress.yaml");
  const out = await snapshot({ root, kinds: [], realPaths: [], files: [path] });
  const bytes = Buffer.from(PROGRESS_TEXT, "utf8");
  assert.equal(out.files[path]?.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(out.files[path]?.sha256, (await createDiskAccess().read(path))?.sha256);
  // So a compare-and-swap write expecting it goes through.
  await createDiskAccess().write(path, "next\n", out.files[path]?.sha256);
});

test("the snapshot asks within the host entry's limits", async (t) => {
  const root = await workspace(t);
  const many = (n: number) => Array.from({ length: n }, (_, i) => join(root, `f${i}`));
  const memory = createSnapshotMemory();
  memory.set(`host_1\u0000${root}`, { kinds: many(300), realPaths: many(20), files: many(70) });
  let asked: SnapshotWant | null = null;
  const { prefetch } = createSnapshotAccess(createDiskAccess(), async (want) => ((asked = want), { kinds: {}, realPaths: {}, files: {} }), memory, "host_1", root);
  await prefetch();
  assert.deepEqual([asked!.kinds.length, asked!.realPaths.length, asked!.files.length], [256, 16, 64]);
});
