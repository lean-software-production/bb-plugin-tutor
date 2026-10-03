import assert from "node:assert/strict";
import { test } from "node:test";
import { createDiskAccess } from "../../test/helpers/disk-access.ts";
import { WorkspaceUnreachableError } from "../workspace/access.ts";
import type { Sdk } from "../workspace/workspace-project.ts";
import { describeCandidate, listCandidates, rankCandidates, type ProjectProbe } from "./candidates.ts";

const context = { coursePath: "/workspaces/tutorial", coachName: "coach-me", layoutId: "capstone-factory" as const };

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
    hasTutorDir: false,
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

test("without the capstone-factory layout, every standard project qualifies, with .tutor/ ones ranked first", () => {
  const layoutless = { coursePath: "/workspaces/tutorial", coachName: "coach-me", layoutId: null };
  const plain = describeCandidate(probe({ root: "/workspaces/p" }), layoutless);
  assert.deepEqual([plain.qualifies, plain.detail], [true, "a folder to work in"]);
  const already = describeCandidate(probe({ root: "/workspaces/p", hasTutorDir: true }), layoutless);
  assert.deepEqual([already.qualifies, already.detail], [true, ".tutor/ · already set up"]);
  // The course itself and overlapping folders still never qualify.
  assert.equal(describeCandidate(probe({ root: "/workspaces/tutorial/" }), layoutless).qualifies, false);
  assert.equal(describeCandidate(probe({ root: "/workspaces/tutorial/docs" }), layoutless).qualifies, false);

  const ranked = rankCandidates(
    [
      { projectId: "a", name: "alpha", root: "/w/alpha", qualifies: true, detail: "" },
      { projectId: "b", name: "beta", root: "/w/beta", qualifies: true, detail: "" },
    ],
    null,
    new Set(["b"]),
  );
  assert.deepEqual(ranked.map((candidate) => candidate.projectId), ["b", "a"]);
});

test("a project on a machine that can't be reached is listed with no folder, not an error", async () => {
  const project = {
    id: "prj_off",
    name: "offline",
    kind: "standard",
    sources: [{ id: "src_1", projectId: "prj_off", hostId: "host_2", type: "local_path", path: "/w", isDefault: true, createdAt: 1, updatedAt: 1 }],
  };
  const sdk = { projects: { list: async () => [project] } } as unknown as Sdk;
  const offline = () => ({
    ...createDiskAccess(),
    kinds: async () => {
      throw new WorkspaceUnreachableError();
    },
  });
  const [candidate] = await listCandidates(sdk, offline, "/workspaces/tutorial", null, null);
  assert.deepEqual([candidate?.projectId, candidate?.qualifies, candidate?.detail], ["prj_off", false, "no folder on this machine"]);
});
