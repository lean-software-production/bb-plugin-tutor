// Where the configured course is, if any.
// Course path precedence: coursePath setting (development) > TUTOR_COURSE_PATH.
import { ENV_VARS } from "../../shared/constants.ts";

export type Env = Readonly<Record<string, string | undefined>>;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * The configured course's folder (Decision 12): the coursePath setting, else
 * TUTOR_COURSE_PATH. Null when neither is set: a standalone Tutor, which
 * offers courses to fetch instead.
 */
export function resolveConfiguredCourse(setting: string | undefined, env: Env): string | null {
  return nonEmpty(setting) ?? nonEmpty(env[ENV_VARS.coursePath]) ?? null;
}
