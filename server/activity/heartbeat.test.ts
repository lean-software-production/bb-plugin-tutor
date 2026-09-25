import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIN_WRITE_INTERVAL_MS, activityFilePath, createActivityRecorder, resolveDataDir, shouldWrite } from "./heartbeat.ts";

async function sandbox(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tutor-activity-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("writes are at least 30 s apart", () => {
  assert.equal(MIN_WRITE_INTERVAL_MS, 30_000);
  assert.ok(shouldWrite(null, 0));
  assert.ok(!shouldWrite(1_000, 30_999));
  assert.ok(shouldWrite(1_000, 31_000));
  // A clock that went backwards must not block writes for good.
  assert.ok(shouldWrite(50_000, 10_000));
});

test("the activity file lives at <BB data dir>/.tutor-feature/activity", () => {
  assert.equal(activityFilePath("/workspaces/.bb-state"), "/workspaces/.bb-state/.tutor-feature/activity");
});

test("the data dir comes from BB, then BB_DATA_DIR, then the feature config's dataDir", () => {
  assert.equal(resolveDataDir({ fromBb: () => "/bb", env: { BB_DATA_DIR: "/env" }, configDataDir: "/cfg" }), "/bb");
  const unbound = () => {
    throw new Error("server not bound");
  };
  assert.equal(resolveDataDir({ fromBb: unbound, env: { BB_DATA_DIR: "/env" }, configDataDir: "/cfg" }), "/env");
  assert.equal(resolveDataDir({ fromBb: () => "", env: { BB_DATA_DIR: " " }, configDataDir: "/cfg" }), "/cfg");
  assert.equal(resolveDataDir({ fromBb: unbound, env: {}, configDataDir: undefined }), null);
  // Only absolute paths count.
  assert.equal(resolveDataDir({ fromBb: () => "relative/bb", env: { BB_DATA_DIR: "rel" }, configDataDir: "/cfg" }), "/cfg");
});

test("a heartbeat writes one ISO-8601 UTC line atomically, creating the directory 0700", async (t) => {
  const dataDir = await sandbox(t);
  let now = new Date("2026-09-25T12:00:00.000Z");
  const recorder = createActivityRecorder({ dataDir: async () => dataDir, now: () => now });

  assert.deepEqual(await recorder.record(), { recorded: true });
  const file = activityFilePath(dataDir);
  assert.equal(await readFile(file, "utf8"), "2026-09-25T12:00:00.000Z\n");
  assert.equal((await stat(join(dataDir, ".tutor-feature"))).mode & 0o777, 0o700);

  now = new Date("2026-09-25T12:00:20.000Z");
  assert.deepEqual(await recorder.record(), { recorded: false }, "throttled");
  assert.equal(await readFile(file, "utf8"), "2026-09-25T12:00:00.000Z\n");

  now = new Date("2026-09-25T12:00:30.000Z");
  assert.deepEqual(await recorder.record(), { recorded: true });
  assert.equal(await readFile(file, "utf8"), "2026-09-25T12:00:30.000Z\n");
});

test("an existing feature directory keeps its mode", async (t) => {
  const dataDir = await sandbox(t);
  await mkdir(join(dataDir, ".tutor-feature"), { mode: 0o750 });
  await writeFile(join(dataDir, ".tutor-feature", "autostart.log"), "kept\n");
  const recorder = createActivityRecorder({ dataDir: async () => dataDir, now: () => new Date(0) });
  await recorder.record();
  assert.equal((await stat(join(dataDir, ".tutor-feature"))).mode & 0o777, 0o750);
  assert.equal(await readFile(join(dataDir, ".tutor-feature", "autostart.log"), "utf8"), "kept\n");
});

test("with no known data dir a heartbeat is a quiet no-op", async () => {
  const recorder = createActivityRecorder({ dataDir: async () => null, now: () => new Date(0) });
  assert.deepEqual(await recorder.record(), { recorded: false });
});

test("a failed write is retried on the next heartbeat instead of being throttled", async (t) => {
  const dataDir = await sandbox(t);
  // A file where the directory should be makes the write fail.
  await writeFile(join(dataDir, ".tutor-feature"), "not a directory");
  let now = new Date("2026-09-25T12:00:00.000Z");
  const recorder = createActivityRecorder({ dataDir: async () => dataDir, now: () => now });
  await assert.rejects(recorder.record());
  await rm(join(dataDir, ".tutor-feature"));
  now = new Date("2026-09-25T12:00:01.000Z");
  assert.deepEqual(await recorder.record(), { recorded: true });
});
