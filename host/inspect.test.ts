import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../host.ts";

test("inspect tells folders, links, files and nothing apart, and resolves real paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "inspect-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "dir"));
  await writeFile(join(root, "file"), "x");
  await symlink("dir", join(root, "link"));
  const host = experimental_createHostEntryHarness(entry);
  const out = await host.experimental_call("inspect", {
    paths: ["dir", "file", "link", "none"].map((name) => join(root, name)),
    realPaths: [join(root, "link")],
  });
  assert.deepEqual(Object.values(out.kinds), ["folder", "file", "link", "none"]);
  // fs.realpath: /tmp is itself a link on macOS.
  assert.equal(out.realPaths[join(root, "link")], join(await realpath(root), "dir"));
});

test("a path that does not resolve comes back as itself", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "inspect-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await symlink(join(root, "gone"), join(root, "dangling"));
  const host = experimental_createHostEntryHarness(entry);
  const out = await host.experimental_call("inspect", { paths: [], realPaths: [join(root, "dangling")] });
  assert.equal(out.realPaths[join(root, "dangling")], join(root, "dangling"));
});

test("inspect refuses relative paths at the contract", async () => {
  const host = experimental_createHostEntryHarness(entry);
  await assert.rejects(host.experimental_call("inspect", { paths: ["relative"], realPaths: [] }));
});
