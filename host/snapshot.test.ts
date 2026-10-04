import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import entry from "../host.ts";

test("snapshot returns kinds, real paths and file texts in one call, and nothing outside the root", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "snap-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const root = join(sandbox, "root");
  await mkdir(join(root, ".tutor"), { recursive: true });
  await writeFile(join(root, ".tutor/progress.yaml"), 'iteration: "000"\n');
  await writeFile(join(sandbox, "outside.txt"), "secret");
  await symlink(join(sandbox, "outside.txt"), join(root, "escape"));
  await symlink(".tutor/progress.yaml", join(root, "inside-link"));
  await mkdir(join(root, "dir"));
  const host = experimental_createHostEntryHarness(entry);
  const out = await host.experimental_call("snapshot", {
    root,
    kinds: [join(root, ".tutor"), join(root, "escape")],
    realPaths: [root],
    files: [join(root, ".tutor/progress.yaml"), join(root, "inside-link"), join(root, "escape"), "/etc/passwd", join(root, "nope"), join(root, "dir")],
  });
  assert.equal(out.kinds[join(root, ".tutor")], "folder");
  assert.equal(out.kinds[join(root, "escape")], "link");
  assert.ok(out.realPaths[root] !== undefined);
  const progress = out.files[join(root, ".tutor/progress.yaml")];
  assert.equal(progress?.text, 'iteration: "000"\n');
  assert.equal(progress?.sha256, createHash("sha256").update('iteration: "000"\n').digest("hex"));
  assert.equal(out.files[join(root, "inside-link")]?.text, 'iteration: "000"\n', "a link that stays inside the root is followed");
  assert.equal(out.files[join(root, "nope")], null, "a file that is not there is null");
  // Not served: left out, so the server reads them the usual way (and never gets them from here).
  assert.ok(!(join(root, "escape") in out.files), "a link out of the root is not served");
  assert.ok(!("/etc/passwd" in out.files), "a path outside the root is not served");
  assert.ok(!(join(root, "dir") in out.files), "a folder is not served");
});
