import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readFeatureConfig, resolveCoursePath, resolveFactoryHint } from "./course-path.ts";

test("course path: setting, then env, then config file, then the default", () => {
  const env = { TUTOR_COURSE_PATH: "/env/course" };
  const config = { course: "/config/course" };
  assert.equal(resolveCoursePath("/setting/course", env, config), "/setting/course");
  assert.equal(resolveCoursePath("  ", env, config), "/env/course");
  assert.equal(resolveCoursePath(undefined, {}, config), "/config/course");
  assert.equal(resolveCoursePath(undefined, {}, {}), "/workspaces/tutorial");
});

test("factory hint: env, then config file, else none", () => {
  assert.equal(resolveFactoryHint({ TUTOR_FACTORY_PATH: "/env/f" }, { factory: "/config/f" }), "/env/f");
  assert.equal(resolveFactoryHint({}, { factory: "/config/f" }), "/config/f");
  assert.equal(resolveFactoryHint({}, {}), null);
});

test("reads the feature config, ignoring empty keys and unreadable files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tutor-config-"));
  try {
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify({ course: "/workspaces/tutorial", factory: "" }));
    assert.deepEqual(await readFeatureConfig(path), { course: "/workspaces/tutorial" });
    await writeFile(path, JSON.stringify({ course: "/workspaces/tutorial", dataDir: "/workspaces/.bb-state" }));
    assert.deepEqual(await readFeatureConfig(path), { course: "/workspaces/tutorial", dataDir: "/workspaces/.bb-state" });
    await writeFile(path, "{ not json");
    assert.deepEqual(await readFeatureConfig(path), {});
    assert.deepEqual(await readFeatureConfig(join(dir, "missing.json")), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
