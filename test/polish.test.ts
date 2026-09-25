// The Codespace polish surfaces end to end: the heartbeat RPC writing the
// feature's activity file, the simpleNavigation setting, and the paper theme
// declared in the manifest.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { ACTIVITY_FILE, THEME_ID } from "../shared/constants.ts";
import { makeSandbox } from "./helpers/disk.ts";
import { makeTutorHost, NOW, PROJECT_ID } from "./helpers/fake-bb.ts";

async function tempDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tutor-data-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function host(t: TestContext, options: Parameters<typeof makeTutorHost>[3]) {
  const sandbox = await makeSandbox();
  const tutor = await makeTutorHost(sandbox.course, sandbox.factoryRoot, { factoryProject: PROJECT_ID }, options);
  t.after(async () => {
    await tutor.harness.lifecycle.dispose();
    await sandbox.cleanup();
  });
  return tutor;
}

test("the heartbeat RPC stamps <BB data dir>/.tutor-feature/activity, at most every 30 s", async (t) => {
  const dataDir = await tempDir(t);
  const tutor = await host(t, { dataDir });

  assert.deepEqual(await tutor.harness.behavior.callRpc("heartbeat", null), { recorded: true });
  const file = join(dataDir, ACTIVITY_FILE);
  assert.equal(await readFile(file, "utf8"), `${NOW.toISOString()}\n`);
  assert.equal((await stat(join(dataDir, ".tutor-feature"))).mode & 0o777, 0o700);

  // Same clock, so the second call is inside the 30 s throttle.
  assert.deepEqual(await tutor.harness.behavior.callRpc("heartbeat", null), { recorded: false });
});

test("the heartbeat falls back to the feature config's dataDir when BB's data dir is not absolute", async (t) => {
  const dataDir = await tempDir(t);
  const config = join(await tempDir(t), "config.json");
  await writeFile(config, JSON.stringify({ course: "/workspaces/tutorial", dataDir }));
  const tutor = await host(t, { dataDir: "", featureConfigFile: config });

  assert.deepEqual(await tutor.harness.behavior.callRpc("heartbeat", null), { recorded: true });
  assert.equal(await readFile(join(dataDir, ACTIVITY_FILE), "utf8"), `${NOW.toISOString()}\n`);
});

test("simpleNavigation defaults to on", async (t) => {
  const tutor = await host(t, {});
  assert.equal((await tutor.rt.settings.get()).simpleNavigation, true);
});

test("the manifest contributes the paper theme with a light code theme", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    bb: { themes?: { id: string; name: string; css: string; codeTheme?: { light?: string } }[] };
  };
  const theme = manifest.bb.themes?.find((entry) => entry.id === THEME_ID);
  assert.ok(theme, "bb.themes has the paper theme");
  assert.equal(theme.name, "Tutor paper");
  assert.equal(theme.css, "./themes/paper.css");
  assert.equal(typeof theme.codeTheme?.light, "string");
  await stat(new URL(`../${theme.css}`, import.meta.url));
});
