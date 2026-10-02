// Where the course and the student's repo are, as the tutor feature describes them.
// Course path precedence: coursePath setting > TUTOR_COURSE_PATH >
// `course` in the feature's config file > /workspaces/tutorial.
import { readFile } from "node:fs/promises";
import { DEFAULT_COURSE_PATH, ENV_VARS, FEATURE_CONFIG_SCHEMA_VERSION } from "../../shared/constants.ts";
import { pathExists } from "../workspace/workspace-project.ts";
import { findRepoRoot } from "../progress/layout.ts";

export interface FeatureConfig {
  course?: string;
  /** The student's capstone-project-starter clone: the BB project Tutor suggests (Feature 0.6.0). */
  repo?: string;
  /** The factory folder; older Features' hint, from before the project was the repo. */
  factory?: string;
  /** BB's data dir, for the activity heartbeat when BB itself cannot say. */
  dataDir?: string;
  /**
   * Set, and nothing else is, when the file names a schemaVersion this plugin
   * does not support: Tutor then refuses to operate and shows this instead.
   */
  error?: string;
}

export type Env = Readonly<Record<string, string | undefined>>;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function unsupportedSchemaError(path: string, received: unknown): string {
  return (
    `The tutor Feature's config (${path}) has schemaVersion ${JSON.stringify(received)}, but this Tutor plugin ` +
    `supports schemaVersion ${FEATURE_CONFIG_SCHEMA_VERSION}. Update the Tutor plugin, or pin a tutor Feature version ` +
    "that matches this plugin."
  );
}

/**
 * The feature's JSON config file, or {} when it is absent or unreadable. An
 * unsupported schemaVersion yields only `error`.
 */
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
  if ("schemaVersion" in record && record.schemaVersion !== FEATURE_CONFIG_SCHEMA_VERSION) {
    return { error: unsupportedSchemaError(path, record.schemaVersion) };
  }
  const course = nonEmpty(record.course);
  const repo = nonEmpty(record.repo);
  const factory = nonEmpty(record.factory);
  const dataDir = nonEmpty(record.dataDir);
  if (course !== undefined) config.course = course;
  if (repo !== undefined) config.repo = repo;
  if (factory !== undefined) config.factory = factory;
  if (dataDir !== undefined) config.dataDir = dataDir;
  return config;
}

export function resolveCoursePath(setting: string | undefined, env: Env, config: FeatureConfig): string {
  return nonEmpty(setting) ?? nonEmpty(env[ENV_VARS.coursePath]) ?? config.course ?? DEFAULT_COURSE_PATH;
}

/** The factory hint alone: TUTOR_FACTORY_PATH, then the config's `factory`. */
export function resolveFactoryHint(env: Env, config: FeatureConfig): string | null {
  return nonEmpty(env[ENV_VARS.factoryPath]) ?? config.factory ?? null;
}

/**
 * Only a hint: pre-selects the candidate project whose folder matches.
 * TUTOR_REPO_PATH, then the config's `repo`, then the repo (the folder
 * holding .git) above the factory hint, then the factory hint itself.
 */
export async function resolveProjectHint(env: Env, config: FeatureConfig): Promise<string | null> {
  const repo = nonEmpty(env[ENV_VARS.repoPath]) ?? config.repo;
  if (repo !== undefined) return repo;
  const factory = resolveFactoryHint(env, config);
  if (factory === null) return null;
  if (!(await pathExists(factory))) return factory;
  return (await findRepoRoot(factory)) ?? factory;
}
