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
  sideChat: "tutor_side_chat",
} as const;
export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];
export const ALL_TOOL_NAMES: readonly ToolName[] = Object.values(TOOL_NAMES);

/** `bb.realtime.publish(channel, payload)` / `useRealtime(channel, …)`. */
export const REALTIME_CHANNELS = {
  /** Payload: `StateChangedSignal` (shared/rpc.ts). Frontends refetch on it. */
  stateChanged: "state-changed",
} as const;

/** Message directive names: `::tutor-lesson{…}`, `::tutor-progress{…}` and `::term{…}`. */
export const DIRECTIVE_NAMES = {
  lesson: "tutor-lesson",
  progress: "tutor-progress",
  term: "term",
} as const;

/**
 * BB's built-in side chat: a hidden fork of a thread, shown in its right
 * panel by the side-chat plugin's panel. Tutor writes the same tab BB writes
 * for "Reply in side chat" (bb-app 0.43.4), so the panel renders Tutor's side
 * chats too.
 */
export const BB_SIDE_CHAT = {
  pluginId: "side-chat",
  actionId: "side-chat",
  title: "Side chat",
} as const;

/** Frontend slot registration ids. */
export const SLOT_IDS = {
  threadList: "course-outline",
  navPanel: "course",
  homepageSection: "continue",
  ruleTab: "rule-tab",
  /** `experimental_sidebarNavigation`: BB's navigation without the rows students don't need. */
  sidebarNavigation: "simple-nav",
  /** App-wide content script that reports the student's activity (app/activity.ts). */
  activity: "activity",
} as const;

/** `bb.themes` id in package.json; BB lists it as `plugin:tutor:paper`. */
export const THEME_ID = "paper";

/** The single navPanel lives at `/plugins/tutor/<NAV_PANEL_PATH>/<subPath>`; see shared/routes.ts. */
export const NAV_PANEL_PATH = "course";

/** Keys passed to `bb.settings.define`. */
export const SETTING_KEYS = {
  /** `type: "string"`; overrides every other course-path source. */
  coursePath: "coursePath",
  /** `type: "project"`; the student's factory project. Written by `confirmFactory`. */
  factoryProject: "factoryProject",
  /** `type: "boolean"`, default true; hides BB's Plugins and Skills navigation rows. */
  simpleNavigation: "simpleNavigation",
} as const;

/**
 * How the `tutor` devcontainer feature tells the plugin where things are.
 * Course path precedence: `coursePath` setting > `TUTOR_COURSE_PATH` env >
 * `FEATURE_CONFIG_FILE.course` > `DEFAULT_COURSE_PATH`.
 * The factory path is only a hint for detecting the factory project; the
 * factory project itself is always a BB project id (`factoryProject` setting).
 */
export const ENV_VARS = {
  coursePath: "TUTOR_COURSE_PATH",
  factoryPath: "TUTOR_FACTORY_PATH",
} as const;
/** JSON `{ "course"?: string, "factory"?: string, "dataDir"?: string }`, written by the feature's install.sh. */
export const FEATURE_CONFIG_FILE = "/usr/local/etc/tutor/config.json";
export const DEFAULT_COURSE_PATH = "/workspaces/tutorial";

/**
 * The student-activity heartbeat, shared with the feature's keep-alive:
 * `<BB data dir>/<ACTIVITY_FILE>` holds one line, the ISO-8601 UTC time the
 * student was last seen using BB. The keep-alive treats a stamp younger than
 * 120 s as active.
 */
export const ACTIVITY_FILE = ".tutor-feature/activity";

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

/** Lesson 0, "Using your tutor": shipped with the plugin, prepended to every course. */
export const BUILTIN_LESSON_ID = "000";

/** Title of a lesson's coach thread. Students read "lesson" for lesson (docs/tutor/GLOSSARY.md). */
export function coachThreadTitle(lessonId: string): string {
  return `Coach · Lesson ${lessonId}`;
}

/**
 * The capstone starter's coach-me skill, relative to the codebase folder that
 * holds the factory (`tetris/` for `tetris/.factory`). It is the coaching
 * method when the course has no coach file of its own.
 */
export const STARTER_COACH_SKILL = ".agents/skills/coach-me/SKILL.md";
