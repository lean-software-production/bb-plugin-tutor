// Which file holds the coaching method. The course's own coach file comes
// first: course.yaml's `coach`, else .agents/coach-me.md (load-course.ts).
// Courses that no longer ship one leave the method to the capstone starter,
// whose coach-me skill is in .agents/skills at the clone's top folder (older
// starters kept it beside the factory, in tetris/.agents/skills).
//
// The skill is in the workspace, so every probe goes through the LayoutProbe.
import { dirname, join } from "node:path";
import { findRepoRoot } from "../../layouts/capstone-factory/detect.ts";
import type { LayoutProbe } from "../../layouts/types.ts";
import { STARTER_COACH_SKILL } from "../../shared/constants.ts";

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

/** The course's coach file, else the starter's coach-me skill between the factory's real folder and its repo's top, else null. */
export async function resolveCoachFile(
  courseCoach: string | null,
  factoryRoot: string | null,
  probe: LayoutProbe,
): Promise<string | null> {
  if (courseCoach !== null) return courseCoach;
  if (factoryRoot === null) return null;
  const skills = (await skillHomes(factoryRoot, probe)).map((home) => join(home, STARTER_COACH_SKILL));
  const kinds = await probe.kinds(skills);
  // A file, or a symbolic link (to one, as stat used to follow it).
  return skills.find((skill) => kinds[skill] === "file" || kinds[skill] === "link") ?? null;
}
