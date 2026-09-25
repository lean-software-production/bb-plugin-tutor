// Where the course and the factory are, as the tutor feature describes them.
// Course path precedence: coursePath setting > TUTOR_COURSE_PATH >
// `course` in the feature's config file > /workspaces/tutorial.
import { readFile } from "node:fs/promises";
import { DEFAULT_COURSE_PATH, ENV_VARS } from "../../shared/constants.ts";

export interface FeatureConfig {
  course?: string;
  factory?: string;
  /** BB's data dir, for the activity heartbeat when BB itself cannot say. */
  dataDir?: string;
}

export type Env = Readonly<Record<string, string | undefined>>;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** The feature's JSON config file, or {} when it is absent or unreadable. */
export async function readFeatureConfig(path: string): Promise<FeatureConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  const config: FeatureConfig = {};
  const record = raw as Record<string, unknown>;
  const course = nonEmpty(record.course);
  const factory = nonEmpty(record.factory);
  const dataDir = nonEmpty(record.dataDir);
  if (course !== undefined) config.course = course;
  if (factory !== undefined) config.factory = factory;
  if (dataDir !== undefined) config.dataDir = dataDir;
  return config;
}

export function resolveCoursePath(setting: string | undefined, env: Env, config: FeatureConfig): string {
  return nonEmpty(setting) ?? nonEmpty(env[ENV_VARS.coursePath]) ?? config.course ?? DEFAULT_COURSE_PATH;
}

/** Only a hint: pre-selects the candidate project whose folder matches. */
export function resolveFactoryHint(env: Env, config: FeatureConfig): string | null {
  return nonEmpty(env[ENV_VARS.factoryPath]) ?? config.factory ?? null;
}
