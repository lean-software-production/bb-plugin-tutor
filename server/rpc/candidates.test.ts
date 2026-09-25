import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCandidate, rankCandidates, type ProjectProbe } from "./candidates.ts";

const context = { coursePath: "/workspaces/tutorial", coachFileName: "coach-me.md" };

function probe(overrides: Partial<ProjectProbe>): ProjectProbe {
  return {
    projectId: "prj",
    name: "p",
    root: "/workspaces/p",
    rootExists: true,
    iterationText: null,
    agentsText: null,
    ...overrides,
  };
}

test("a repo with spec/ITERATION or a coach-me AGENTS.md qualifies", () => {
  assert.deepEqual(describeCandidate(probe({ iterationText: "002 WIP\n" }), context), {
    projectId: "prj",
    name: "p",
    root: "/workspaces/p",
    qualifies: true,
    detail: "spec/ITERATION · 002 WIP",
  });
  const agents = describeCandidate(probe({ agentsText: "read ../tutorial/.agents/coach-me.md" }), context);
  assert.equal(agents.qualifies, true);
  assert.equal(describeCandidate(probe({ iterationText: "?" }), context).detail, "spec/ITERATION · unreadable");
});

test("the course itself, folderless projects and plain repos do not", () => {
  assert.equal(describeCandidate(probe({ root: "/workspaces/tutorial/" }), context).detail, "the course itself");
  for (const root of ["/workspaces/tutorial/docs", "/workspaces"]) {
    const inside = describeCandidate(probe({ root, iterationText: "001 WIP\n" }), context);
    assert.deepEqual([inside.qualifies, inside.detail], [false, "shares a folder with the course"]);
  }
  assert.equal(describeCandidate(probe({ root: "/workspaces/tutorial-factory", iterationText: "001 WIP\n" }), context).qualifies, true);
  assert.equal(describeCandidate(probe({ root: null, rootExists: false }), context).detail, "no folder on this machine");
  assert.deepEqual(
    [describeCandidate(probe({}), context).qualifies, describeCandidate(probe({}), context).detail],
    [false, "no spec/ITERATION"],
  );
});

test("the feature's hinted folder comes first, then qualifying projects, then by name", () => {
  const ranked = rankCandidates(
    [
      { projectId: "a", name: "alpha", root: "/w/alpha", qualifies: false, detail: "" },
      { projectId: "b", name: "beta", root: "/w/beta", qualifies: true, detail: "" },
      { projectId: "c", name: "gamma", root: "/w/gamma", qualifies: false, detail: "" },
    ],
    "/w/gamma",
  );
  assert.deepEqual(ranked.map((candidate) => candidate.projectId), ["c", "b", "a"]);
});
