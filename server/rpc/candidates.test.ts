import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCandidate, rankCandidates, type ProjectProbe } from "./candidates.ts";

const context = { coursePath: "/workspaces/tutorial", coachName: "coach-me" };

// capstone-project-starter's tetris/.factory/AGENTS.md names the coach-me skill, not a file.
const STARTER_AGENTS = `# Agent instructions

- \`spec/\` holds the current homework iteration, fetched from the course. Don't edit it.
- \`ITERATION\` holds the student's progress, e.g. \`001 WIP\`.

Skills, in \`../.agents/skills/\`:

- **fetch-iteration** — when the student says "fetch iteration", or there is no iteration in progress.
- **coach-me** — when the student says "coach me", asks to be coached, or wants to work through their homework with guidance.
`;

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

test("a repo with an ITERATION or a coach-me AGENTS.md qualifies", () => {
  assert.deepEqual(describeCandidate(probe({ iterationText: "002 WIP\n" }), context), {
    projectId: "prj",
    name: "p",
    root: "/workspaces/p",
    qualifies: true,
    detail: "ITERATION · 002 WIP",
  });
  const agents = describeCandidate(probe({ agentsText: "read ../tutorial/.agents/coach-me.md" }), context);
  assert.equal(agents.qualifies, true);
  const starter = describeCandidate(probe({ agentsText: STARTER_AGENTS }), context);
  assert.deepEqual([starter.qualifies, starter.detail], [true, "AGENTS.md points at the course"]);
  assert.equal(describeCandidate(probe({ iterationText: "?" }), context).detail, "ITERATION · unreadable");
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
    [false, "no ITERATION"],
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
