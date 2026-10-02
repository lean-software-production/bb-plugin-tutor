// The server reaches the workspace only through the machine (spec: "The plugin split").
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

/** Server modules allowed to use the local filesystem or processes: none of them reads the workspace. */
const ALLOWED = new Set([
  "server/activity/heartbeat.ts",        // BB's data dir
  "server/coach/course-path.ts",         // the Feature's config file
  "server/course/builtin.ts",
  "server/course/files.ts",              // the course checkout, on the server
  "server/course/load-course.ts",
  "server/course/yaml-file.ts",
  "server/coach/coach-text.ts",          // the course's coach file (Task 12)
  "server/content/fetch.ts",             // Task 13
  "server/content/store.ts",             // Task 13
  "server/content/make-bundle.ts",       // Task 9
  "server/paths.ts",                     // realPath of the course path only
  "server/workspace/local-access.ts",    // removed in Task 8
  "server/progress/spec-copy.ts",        // moves to layouts/ in Task 10
  "server/progress/factory-move.ts",     // moves to layouts/ in Task 10
  "server/progress/own-folder.ts",       // spec-copy's; moves to layouts/ in Task 10
  "server/progress/atomic-write.ts",     // the heartbeat's writes to BB's data dir
]);
const IO = /from "node:(fs|fs\/promises|child_process)"/;

async function* sources(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) yield path;
  }
}

test("no server module reads or writes the workspace itself", async () => {
  const offenders: string[] = [];
  for await (const path of sources("server")) {
    if (!ALLOWED.has(path) && IO.test(await readFile(path, "utf8"))) offenders.push(path);
  }
  assert.deepEqual(offenders, []);
});
