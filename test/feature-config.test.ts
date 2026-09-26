// The tutor Feature's config.json carries a schemaVersion. Absent or 1 works;
// any other value stops Tutor: the course surfaces show why, and the coach
// tools refuse without writing anything.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test, type TestContext } from "node:test";
import type { PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { findLesson, lessonExamples } from "../shared/derive.ts";
import type { Overview } from "../shared/rpc.ts";
import { makeSandbox } from "./helpers/disk.ts";
import { makeTutorHost, PROJECT_ID } from "./helpers/fake-bb.ts";

async function setup(t: TestContext, config: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), "tutor-config-"));
  const configFile = join(dir, "config.json");
  await writeFile(configFile, JSON.stringify(config));
  const sandbox = await makeSandbox();
  const host = await makeTutorHost(sandbox.course, sandbox.factoryRoot, { factoryProject: PROJECT_ID }, { featureConfigFile: configFile });
  t.after(async () => {
    await host.harness.lifecycle.dispose();
    await sandbox.cleanup();
    await rm(dir, { recursive: true, force: true });
  });
  return { sandbox, host, configFile };
}

function text(result: PluginAgentToolResult): string {
  return typeof result === "string" ? result : result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/** Every file under root with its contents, to prove nothing was written. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[relative(root, path)] = await readFile(path, "utf8");
  }
  return files;
}

for (const config of [{ course: "/workspaces/tutorial" }, { schemaVersion: 1, course: "/workspaces/tutorial" }]) {
  test(`a feature config with ${"schemaVersion" in config ? "schemaVersion 1" : "no schemaVersion"} loads the course`, async (t) => {
    const { host } = await setup(t, config);
    const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
    assert.equal(overview.courseError, null);
    assert.notEqual(overview.course, null);
  });
}

test("an unsupported schemaVersion stops Tutor: the course surfaces say why and the coach tools write nothing", async (t) => {
  const { sandbox, host, configFile } = await setup(t, { schemaVersion: 1, course: "/workspaces/tutorial" });
  // A coach thread from before the Feature was upgraded past this plugin.
  const { threadId } = (await host.harness.behavior.callRpc("openCoach", { lessonId: "000" })) as { threadId: string };
  await writeFile(configFile, JSON.stringify({ schemaVersion: 2, course: "/workspaces/tutorial" }));
  const before = await snapshot(sandbox.root);

  const overview = (await host.harness.behavior.callRpc("getOverview", null)) as Overview;
  assert.equal(overview.course, null);
  assert.match(overview.courseError ?? "", /schemaVersion 2/);
  assert.match(overview.courseError ?? "", /supports schemaVersion 1/);
  assert.match(overview.courseError ?? "", /[Uu]pdate the Tutor plugin/);
  await assert.rejects(host.harness.behavior.callRpc("openCoach", { lessonId: "000" }), /schemaVersion 2/);

  const example = lessonExamples(findLesson(sandbox.course, "000") ?? assert.fail("lesson 000"))[0] ?? assert.fail("an Example");
  const rule = example.key.split("/").slice(0, 2).join("/");
  const calls: [string, unknown][] = [
    ["tutor_status", {}],
    ["tutor_adopt_iteration", { iteration: "000" }],
    ["tutor_focus_rule", { rule }],
    ["tutor_mark_example", { example: example.key, status: "passing", evidence: "ran it" }],
    ["tutor_complete_iteration", { iteration: "000", summary: "Done." }],
    ["tutor_side_chat", { title: "Why?", prompt: "Explain." }],
  ];
  for (const [name, input] of calls) {
    const result = await host.harness.behavior.callAgentTool(name, input, { threadId, projectId: PROJECT_ID });
    assert.ok(typeof result !== "string" && result.isError === true, `${name} refuses`);
    assert.match(text(result), /schemaVersion 2/, `${name} names the received version`);
  }
  assert.deepEqual(await snapshot(sandbox.root), before, "no file was written");
  assert.equal(host.harness.inspection.sdk.callsTo("threads.spawn").length, 1, "no thread spawned after the first coach");
});
