import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDiskAccess } from "../../test/helpers/disk-access.ts";
import { resolveWorkspace, workspaceSetting, type Sdk } from "./workspace-project.ts";

/** Just enough of the SDK for resolveWorkspace: one project whose default source is `path`. */
function sdkWith(path: string): Sdk {
  const project = {
    id: "prj_1",
    name: "repo",
    sources: [{ id: "src_1", projectId: "prj_1", hostId: "host_1", type: "local_path", path, isDefault: true, createdAt: 1, updatedAt: 1 }],
  };
  return { projects: { get: async () => project } } as unknown as Sdk;
}

test("workspaceProject wins; an older Tutor's factoryProject is still read; empty is unset", () => {
  assert.equal(workspaceSetting({ workspaceProject: "prj_a", factoryProject: "prj_b" }), "prj_a");
  assert.equal(workspaceSetting({ factoryProject: "prj_b" }), "prj_b");
  assert.equal(workspaceSetting({ workspaceProject: "", factoryProject: "prj_b" }), "prj_b");
  assert.equal(workspaceSetting({}), undefined);
});

test("a workspace folder that is a link counts only when it leads somewhere", async (t) => {
  const top = await realpath(await mkdtemp(join(tmpdir(), "tutor-ws-")));
  t.after(() => rm(top, { recursive: true, force: true }));
  const disk = () => createDiskAccess();
  await mkdir(join(top, "repo"));
  await symlink(join(top, "repo"), join(top, "linked"));
  await symlink(join(top, "gone"), join(top, "dangling"));
  assert.equal((await resolveWorkspace(sdkWith(join(top, "repo")), "prj_1", disk)).workspace.status, "found");
  assert.equal((await resolveWorkspace(sdkWith(join(top, "linked")), "prj_1", disk)).workspace.status, "found");
  assert.equal((await resolveWorkspace(sdkWith(join(top, "dangling")), "prj_1", disk)).workspace.status, "missing");
  assert.equal((await resolveWorkspace(sdkWith(join(top, "nothing")), "prj_1", disk)).workspace.status, "missing");
});
