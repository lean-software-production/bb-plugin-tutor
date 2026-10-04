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
  fetchCourse: "tutor_fetch_course",
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

/** `bb.themes` id in package.json; BB lists it as `plugin:tutor:sketchbook`. */
export const THEME_ID = "sketchbook";

/** The single navPanel lives at `/plugins/tutor/<NAV_PANEL_PATH>/<subPath>`; see shared/routes.ts. */
export const NAV_PANEL_PATH = "course";

/** Keys passed to `bb.settings.define`. */
export const SETTING_KEYS = {
  /** `type: "string"`; overrides every other course-path source. */
  coursePath: "coursePath",
  /** `type: "project"`; the student's workspace. Written by `confirmWorkspace`. */
  workspaceProject: "workspaceProject",
  /** Read only, for Tutor before 0.5: an older Tutor's workspace setting, still read as a fallback. */
  factoryProject: "factoryProject",
  /** `type: "boolean"`, default true; hides BB's Plugins and Skills navigation rows. */
  simpleNavigation: "simpleNavigation",
  /** `type: "string"`; the agent provider coach threads use. Empty means BB's default. */
  coachProvider: "coachProvider",
  /** `type: "string"`; the model coach threads use, as provider/model. Empty means the coach agent's default. */
  coachModel: "coachModel",
  /** `type: "string"`; a JSON course catalog replacing the built-in one (server/content/catalog.ts). Empty means the built-in one. */
  courseCatalog: "courseCatalog",
  /** `type: "string"`; where the student's Codespace checks out the starter, offered on first run. */
  workspaceFolder: "workspaceFolder",
} as const;

/** Where the student's Codespace checks out the starter: the workspace Tutor offers on first run. */
export const DEFAULT_WORKSPACE_FOLDER = "/workspaces/capstone-project-starter";

/**
 * How the `tutor` devcontainer feature tells the plugin where things are.
 * Course path precedence: `coursePath` setting > `TUTOR_COURSE_PATH` env >
 * `FEATURE_CONFIG_FILE.course` > `DEFAULT_COURSE_PATH`.
 * The repo and factory paths are only hints for detecting the student's
 * project, in this order: `TUTOR_REPO_PATH`, config `repo`, the git top folder
 * above `TUTOR_FACTORY_PATH` / config `factory`, then that factory path
 * itself. The project is always a BB project id (`workspaceProject` setting).
 */
export const ENV_VARS = {
  coursePath: "TUTOR_COURSE_PATH",
  repoPath: "TUTOR_REPO_PATH",
  factoryPath: "TUTOR_FACTORY_PATH",
} as const;
/**
 * JSON `{ "schemaVersion"?: 1, "course"?: string, "repo"?: string, "factory"?: string, "dataDir"?: string }`,
 * written by the feature's install.sh. Unknown keys are ignored.
 */
export const FEATURE_CONFIG_FILE = "/usr/local/etc/tutor/config.json";
/**
 * The config file layout this plugin understands. An absent `schemaVersion` is 1
 * (Features written before it existed); any other value stops Tutor, since the
 * Feature and the plugin are released separately.
 */
export const FEATURE_CONFIG_SCHEMA_VERSION = 1;
export const DEFAULT_COURSE_PATH = "/workspaces/tutorial";

/**
 * The student-activity heartbeat, shared with the feature's keep-alive:
 * `<BB data dir>/<ACTIVITY_FILE>` holds one line, the ISO-8601 UTC time the
 * student was last seen using BB. The keep-alive treats a stamp younger than
 * 120 s as active.
 */
export const ACTIVITY_FILE = ".tutor-feature/activity";

/**
 * Paths inside the student's factory, relative to its folder (tetris/.factory,
 * then factory/ from lesson 004, in capstone-project-starter). `seedsDir` sits
 * under the codebase folder: tetris/seeds in a starter clone, ../seeds for a
 * project whose folder is the factory itself (layouts/capstone-factory/detect.ts).
 */
export const FACTORY_FILES = {
  progress: "spec/PROGRESS.yaml",
  iteration: "ITERATION",
  /** Where ITERATION lived before the starter layout: read when there is no root ITERATION, removed on the next write. */
  legacyIteration: "spec/ITERATION",
  specDir: "spec",
  seedsDir: "seeds",
  standInsDir: "stand-ins",
  agents: "AGENTS.md",
} as const;

/** Paths inside a course repo, relative to its root. */
export const COURSE_FILES = {
  manifest: "course.yaml",
  ledger: "docs/iterations/README.md",
  defaultCoach: ".agents/coach-me.md",
  defaultLexicon: "docs/lexicon.yaml",
  standIns: "stand-ins",
} as const;

/** Lesson 0, "Using your tutor": shipped with the plugin as the one lesson of Tutor's built-in course. Other courses may not use its id. */
export const BUILTIN_LESSON_ID = "000";

/** Tutor's built-in course (server/course/builtin/), listed before every other course. */
export const BUILTIN_COURSE_ID = "tutor";

/** Where the built-in course keeps its progress in the workspace: .tutor/progress.yaml, with no ITERATION. */
export const BUILTIN_PROGRESS = { dir: ".tutor", file: "progress.yaml" } as const;

/** Title of a lesson's coach thread. Students read "lesson" for lesson (docs/tutor/GLOSSARY.md). */
export function coachThreadTitle(lessonId: string): string {
  return `Coach · Lesson ${lessonId}`;
}

/**
 * The layout of a capstone-project-starter clone, relative to the repo's top
 * folder, the BB project's folder. The factory starts inside the codebase it
 * builds, at `earlyFactory`, and moves beside it, to `lateFactory`, when
 * lesson `moveAtLesson` is adopted: the starter's fetch.sh does
 * `git mv tetris/.factory factory`, then points the factory's
 * `claudeSkillsLink` at `linkTarget` again. Tutor does the same
 * (layouts/capstone-factory/factory-move.ts). The rule belongs to the starter.
 */
export const STARTER_LAYOUT = {
  codebase: "tetris",
  earlyFactory: "tetris/.factory",
  lateFactory: "factory",
  moveAtLesson: 4,
  skillsDir: ".agents/skills",
  /** Relative to the factory's folder. */
  claudeSkillsLink: ".claude/skills",
  /** The link's target, from factory/.claude/. */
  linkTarget: "../../.agents/skills",
} as const;

/**
 * The capstone starter's coach-me skill, relative to the repo's top folder.
 * It is the coaching method when the course has no coach file of its own;
 * Tutor looks for it from the factory's folder up to the repo's
 * (server/coach/coach-file.ts).
 */
export const STARTER_COACH_SKILL = `${STARTER_LAYOUT.skillsDir}/coach-me/SKILL.md`;

/**
 * What every surface says while the machine holding the workspace is not
 * connected to BB (the workspace is "unreachable"): the server's RPC errors
 * and tool refusals, and the app's pages.
 */
export const WORKSPACE_UNREACHABLE_TEXT = "Your Codespace is asleep or stopped. Open it and Tutor reconnects by itself.";
