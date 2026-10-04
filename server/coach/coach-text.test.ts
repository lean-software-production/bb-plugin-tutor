import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { MAX_COACH_TEXT, readCoachText } from "./coach-text.ts";

async function fileWith(t: TestContext, text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tutor-coach-text-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "coach-me.md");
  await writeFile(path, text);
  return path;
}

test("a short coach file reaches the agent whole", async (t) => {
  const path = await fileWith(t, "## Coaching process\nBaby steps.\n");
  assert.equal(await readCoachText(path), "## Coaching process\nBaby steps.\n");
});

test("a coach file over 48 KiB is cut with a note", async (t) => {
  const path = await fileWith(t, "x".repeat(MAX_COACH_TEXT + 10_000));
  const text = await readCoachText(path);
  assert.ok(text.length <= MAX_COACH_TEXT);
  assert.match(text, /\[The coaching method is longer than Tutor passes on; the rest is left out\.\]$/);
});
