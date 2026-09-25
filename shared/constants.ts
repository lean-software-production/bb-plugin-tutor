// Names shared by the backend, the frontend, the skill and the feature's tests.
// Skeleton-owned: builders read these and never redefine them locally.

/** Derived by BB from the package name `bb-plugin-tutor`. Prefer `bb.pluginId` at runtime. */
export const PLUGIN_ID = "tutor";

/** `skills/tutor/SKILL.md`; offered only to Tutor-spawned threads. */
export const SKILL_ID = "tutor";

export const TOOL_NAMES = {
  status: "tutor_status",
  focusRule: "tutor_focus_rule",
  markExample: "tutor_mark_example",
  adoptIteration: "tutor_adopt_iteration",
  completeIteration: "tutor_complete_iteration",
  sideThread: "tutor_side_thread",
} as const;
export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];
export const ALL_TOOL_NAMES: readonly ToolName[] = Object.values(TOOL_NAMES);

/** `bb.realtime.publish(channel, payload)` / `useRealtime(channel, …)`. */
export const REALTIME_CHANNELS = {
  /** Payload: `StateChangedSignal` (shared/rpc.ts). Frontends refetch on it. */
  stateChanged: "state-changed",
} as const;

/** Message directive names: `::tutor-progress{…}` and `::term{…}`. */
export const DIRECTIVE_NAMES = {
  progress: "tutor-progress",
  term: "term",
} as const;

/** Frontend slot registration ids. */
export const SLOT_IDS = {
  threadList: "course-rail",
  navPanel: "course",
  homepageSection: "continue",
  ruleTab: "rule-tab",
} as const;

/** The single navPanel lives at `/plugins/tutor/<NAV_PANEL_PATH>/<subPath>`; see shared/routes.ts. */
export const NAV_PANEL_PATH = "course";

/** Keys passed to `bb.settings.define`. */
export const SETTING_KEYS = {
  /** `type: "string"`; overrides every other course-path source. */
  coursePath: "coursePath",
  /** `type: "project"`; the student's factory project. Written by `confirmFactory`. */
  factoryProject: "factoryProject",
} as const;

/**
 * How the `tutor` devcontainer feature tells the plugin where things are.
 * Course path precedence: `coursePath` setting > `TUTOR_COURSE_PATH` env >
 * `FEATURE_CONFIG_FILE.course` > `DEFAULT_COURSE_PATH`.
 * The factory path is only a hint for detecting the factory project; the
 * binding itself is always a BB project id (`factoryProject` setting).
 */
export const ENV_VARS = {
  coursePath: "TUTOR_COURSE_PATH",
  factoryPath: "TUTOR_FACTORY_PATH",
} as const;
/** JSON `{ "course"?: string, "factory"?: string }`, written by the feature's install.sh. */
export const FEATURE_CONFIG_FILE = "/usr/local/etc/tutor/config.json";
export const DEFAULT_COURSE_PATH = "/workspaces/tutorial";

/** Paths inside the student's factory repo, relative to its root. */
export const FACTORY_FILES = {
  progress: "spec/PROGRESS.yaml",
  iteration: "spec/ITERATION",
  specDir: "spec",
  seedsDir: "seeds",
  agents: "AGENTS.md",
} as const;

/** Paths inside a course repo, relative to its root. */
export const COURSE_FILES = {
  manifest: "course.yaml",
  ledger: "docs/iterations/README.md",
  defaultCoach: ".agents/coach-me.md",
  defaultLexicon: "docs/lexicon.yaml",
} as const;

/** Homework 0, "Using your tutor": shipped with the plugin, prepended to every course. */
export const BUILTIN_HOMEWORK_ID = "000";

/** Title of a homework's main coach thread. */
export function coachThreadTitle(homeworkId: string): string {
  return `Coach · Homework ${homeworkId}`;
}
