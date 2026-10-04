// Which file holds the coaching method, and how it reaches the agent. The
// course's own coach file comes first: course.yaml's `coach`, else
// .agents/coach-me.md (load-course.ts); it is read on the server and inlined
// as text, never sent to the student's machine as a path (coach threads run
// there, where a server path means nothing). Courses that no longer ship one
// leave the method to the capstone starter, whose coach-me skill is in
// .agents/skills at the clone's top folder (older starters kept it beside the
// factory, in tetris/.agents/skills); that file stays in the workspace, so it
// is named by its path relative to the workspace, for the agent to read itself.
//
// The skill is in the workspace, so every probe goes through the LayoutProbe.
import { dirname, join, relative } from "node:path";
import { findRepoRoot } from "../../layouts/capstone-factory/detect.ts";
import type { CourseLayoutState } from "../../layouts/state.ts";
import { followedKind, type LayoutProbe } from "../../layouts/types.ts";
import { STARTER_COACH_SKILL } from "../../shared/constants.ts";
import { readCoachText } from "./coach-text.ts";

export type CoachMethod = { kind: "course"; text: string } | { kind: "workspace"; relativePath: string } | null;

/**
 * The folders to look in for the skill, nearest first: from the factory's
 * real parent up to the repo's top folder (the nearest holding .git). Without
 * a repo above, just the parent.
 */
async function skillHomes(factoryRoot: string, probe: LayoutProbe): Promise<string[]> {
  const real = await probe.realPath(factoryRoot);
  const parent = dirname(real);
  const repo = await findRepoRoot(real, probe);
  if (repo === null) return [parent];
  const homes: string[] = [];
  for (let dir = parent; ; dir = dirname(dir)) {
    homes.push(dir);
    if (dir === repo || dirname(dir) === dir) break;
  }
  // A factory that is its repo's top folder (a legacy factory repo): its parent, as before.
  if (repo === real) return [parent];
  return homes;
}

/** The capstone-factory layout's factory folder, or null for any other layout. */
function factoryRootOf(layout: CourseLayoutState): string | null {
  return layout.id === "capstone-factory" ? layout.layout.factoryDir : null;
}

/** The starter's coach-me skill in the workspace, between the factory's real folder and its repo's top, or null. */
async function findWorkspaceSkill(factoryRoot: string, probe: LayoutProbe): Promise<string | null> {
  const skills = (await skillHomes(factoryRoot, probe)).map((home) => join(home, STARTER_COACH_SKILL));
  const kinds = await probe.kinds(skills);
  for (const skill of skills) {
    const kind = kinds[skill] ?? "none";
    // A file, or a symbolic link that leads to one.
    if (kind === "file" || (kind === "link" && (await followedKind(probe, skill)) === "file")) return skill;
  }
  return null;
}

/**
 * The coaching method: the course's own coach file, read and inlined as text
 * (`courseCoach`, a server path), else the starter's coach-me skill, named by
 * its path relative to the workspace, else null.
 */
export async function resolveCoachMethod(
  courseCoach: string | null,
  layout: CourseLayoutState,
  workspaceRoot: string,
  probe: LayoutProbe,
): Promise<CoachMethod> {
  if (courseCoach !== null) return { kind: "course", text: await readCoachText(courseCoach) };
  const factoryRoot = factoryRootOf(layout);
  if (factoryRoot === null) return null;
  const skill = await findWorkspaceSkill(factoryRoot, probe);
  return skill === null ? null : { kind: "workspace", relativePath: relative(workspaceRoot, skill) };
}
