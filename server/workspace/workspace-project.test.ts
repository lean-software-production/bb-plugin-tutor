import assert from "node:assert/strict";
import { test } from "node:test";
import { workspaceSetting } from "./workspace-project.ts";

test("workspaceProject wins; an older Tutor's factoryProject is still read; empty is unset", () => {
  assert.equal(workspaceSetting({ workspaceProject: "prj_a", factoryProject: "prj_b" }), "prj_a");
  assert.equal(workspaceSetting({ factoryProject: "prj_b" }), "prj_b");
  assert.equal(workspaceSetting({ workspaceProject: "", factoryProject: "prj_b" }), "prj_b");
  assert.equal(workspaceSetting({}), undefined);
});
