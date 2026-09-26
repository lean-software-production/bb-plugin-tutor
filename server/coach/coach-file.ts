// Which file holds the coaching method. The course's own coach file comes
// first: course.yaml's `coach`, else .agents/coach-me.md (load-course.ts).
// Courses that no longer ship one leave the method to the capstone starter,
// whose coach-me skill sits beside the factory in its codebase folder.
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STARTER_COACH_SKILL } from "../../shared/constants.ts";
import { realPath } from "../paths.ts";

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The course's coach file, else the starter's coach-me skill beside the factory's real folder, else null. */
export async function resolveCoachFile(courseCoach: string | null, factoryRoot: string | null): Promise<string | null> {
  if (courseCoach !== null) return courseCoach;
  if (factoryRoot === null) return null;
  const skill = join(dirname(await realPath(factoryRoot)), STARTER_COACH_SKILL);
  return (await isFile(skill)) ? skill : null;
}
