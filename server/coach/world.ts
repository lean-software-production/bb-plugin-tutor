// Everything a handler needs, re-derived from disk and BB on each call: the
// workspace and, for each course (Tutor's built-in one first), its layout in
// the workspace (layouts/state.ts) and the student's state. Nothing here
// comes from thread metadata. The workspace is reached only through the
// WorkspaceAccess for its machine.
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { BUILTIN_COURSE_ID, BUILTIN_LESSON_ID, BUILTIN_PROGRESS } from "../../shared/constants.ts";
import { resolveCurrent, type CurrentPointer } from "../../shared/derive.ts";
import { slugify } from "../../shared/keys.ts";
import type { Course, ProgressFile, StudentState } from "../../shared/model.ts";
import type { CourseSource, ProgressStore } from "../../shared/ports.ts";
import type { Workspace } from "../../shared/rpc.ts";
import { resolveCourseLayout, type CourseLayoutState } from "../../layouts/state.ts";
import { overlaps, realPath } from "../paths.ts";
import type { WorkspaceAccess } from "../workspace/access.ts";
import { resolveWorkspace, workspaceSetting } from "../workspace/workspace-project.ts";
import { resolveCoachFile } from "./coach-file.ts";
import { readFeatureConfig, resolveCoursePath, resolveProjectHint, type Env } from "./course-path.ts";
import type { TutorSettings } from "./settings.ts";

/**
 * The machine asked about the Feature's project hint while there is no
 * workspace yet: the one the server shares with the Feature (the Codespace).
 * Until Task 8 every machine is the local disk; Task 8 decides how to name it.
 */
const FEATURE_HOST = "local";

/** Page loads fire several calls at once; they share one course read. */
const COURSE_TTL_MS = 3000;

export { BUILTIN_COURSE_ID };

/** One course as the workspace has it: its layout there, the student's state in it, and where they are. */
export interface LoadedCourse {
  course: Course;
  layout: CourseLayoutState;
  student: StudentState;
  pointer: CurrentPointer;
  /** The coaching method's file: the course's coach file, else the starter's coach-me skill (coach-file.ts). */
  coachPath: string | null;
}

export interface World {
  /** Where the configured course is: the course checkout the workspace must stay clear of. */
  coursePath: string;
  /** The BB project Tutor coaches in: the student's repo, or (legacy) the factory folder itself. */
  workspace: Workspace;
  /** The machine holding the project's folder; null without a workspace. */
  hostId: string | null;
  /** Every course that loaded, built-in first, workspace or not: what the outline shows before setup. */
  available: Course[];
  /** Tutor's built-in course first, then the configured or fetched courses. Empty only while there is no workspace. */
  courses: LoadedCourse[];
  /** Courses that could not be loaded, by id or path, with the reason. */
  courseErrors: { source: string; error: string }[];
  /** Pre-selects a candidate project on first run (resolveProjectHint). */
  projectHint: string | null;
}

export interface WorldDeps {
  courseSource: CourseSource;
  store: ProgressStore;
  env: Env;
  featureConfigFile: string;
  now: () => Date;
  /** How the server reaches the workspace on a machine. */
  access: (hostId: string) => WorkspaceAccess;
}

export interface WorldSource {
  load(): Promise<World>;
  /** The courses from the most recent load, for synchronous callers (configure). */
  lastCourses(): readonly LoadedCourse[];
}

/** The loaded course with this id, if any. */
export function findCourse(world: World, courseId: string): LoadedCourse | undefined {
  return world.courses.find((entry) => entry.course.id === courseId);
}

/**
 * The course whose coaching method and factory a coach of `loaded` follows:
 * its own, except that Lesson 0 follows the course after it, as it did when
 * it was part of that course (the capstone's coach-me and its factory).
 */
export function methodCourse(courses: readonly LoadedCourse[], loaded: LoadedCourse): LoadedCourse {
  if (loaded.course.id !== BUILTIN_COURSE_ID) return loaded;
  return courses.find((entry) => entry.course.id !== BUILTIN_COURSE_ID) ?? loaded;
}

/** The built-in course's progress: .tutor/progress.yaml in the workspace, with no ITERATION, whatever layout other courses use. */
export function builtinLayout(workspaceRoot: string): CourseLayoutState {
  return {
    id: null,
    ready: true,
    progress: { dir: join(workspaceRoot, BUILTIN_PROGRESS.dir), progressFile: BUILTIN_PROGRESS.file, iterationFiles: [] },
    problems: [],
    blocked: null,
  };
}

/**
 * Lesson 0 as an older Tutor recorded it, in the capstone's progress file
 * (current, or in its history): read while .tutor/progress.yaml is absent, so
 * a Codespace that did Lesson 0 before keeps it. Writes go to .tutor/progress.yaml.
 */
export function legacyLesson0(capstone: StudentState): ProgressFile | null {
  const current = capstone.progress?.iteration === BUILTIN_LESSON_ID ? capstone.progress : null;
  if (current !== null) {
    const { history: _history, ...rest } = current;
    return rest;
  }
  const past = capstone.progress?.history?.[BUILTIN_LESSON_ID];
  if (past === undefined) return null;
  const progress: ProgressFile = { iteration: BUILTIN_LESSON_ID, examples: past.examples };
  if (past.adopted !== undefined) progress.adopted = past.adopted;
  if (past.summary !== undefined) progress.summary = past.summary;
  return progress;
}

/**
 * Where a layoutless course keeps its files in the workspace: .tutor/courses/<id>.
 * course.yaml's id is any text, so it is slugged: an id like "../x" never leads out of .tutor/courses.
 */
function courseDirOf(course: Course): string {
  return `.tutor/courses/${slugify(course.id)}`;
}

type CourseResult = { course: Course; error: null } | { course: null; error: string };

export function createWorldSource(bb: BbPluginApi, settings: TutorSettings, deps: WorldDeps): WorldSource {
  let cached: { path: string; at: number; result: Promise<CourseResult> } | null = null;
  let builtin: Promise<CourseResult> | null = null;
  let last: LoadedCourse[] = [];

  function loadCourse(path: string): Promise<CourseResult> {
    const now = deps.now().getTime();
    if (cached !== null && cached.path === path && now - cached.at < COURSE_TTL_MS) return cached.result;
    const result = settle(deps.courseSource.loadCourse(path));
    cached = { path, at: now, result };
    return result;
  }

  /** The built-in course ships with the plugin and never changes while it runs; a failed read is tried again next time. */
  function loadBuiltin(): Promise<CourseResult> {
    if (builtin !== null) return builtin;
    const result = settle(deps.courseSource.loadBuiltin());
    builtin = result;
    void result.then((outcome) => {
      if (outcome.course === null && builtin === result) builtin = null;
    });
    return result;
  }

  async function readCourse(course: Course, root: string, access: WorkspaceAccess): Promise<LoadedCourse> {
    const layout = await resolveCourseLayout(course.layout, root, courseDirOf(course), access);
    const read = await deps.store.read(access, layout.progress);
    const student = layout.problems.length === 0 ? read : { ...read, problems: [...layout.problems, ...read.problems] };
    const coachPath = await resolveCoachFile(course.coachPath, layout.id === "capstone-factory" ? layout.layout.factoryDir : null, access);
    return { course, layout, student, pointer: resolveCurrent(course, student), coachPath };
  }

  async function readBuiltin(course: Course, root: string, access: WorkspaceAccess, others: readonly LoadedCourse[]): Promise<LoadedCourse> {
    const layout = builtinLayout(root);
    const read = await deps.store.read(access, layout.progress);
    const capstone = others.find((entry) => entry.layout.id === "capstone-factory");
    const legacy = read.progress === null && read.progressUnreadable !== true && capstone !== undefined ? legacyLesson0(capstone.student) : null;
    const student = legacy === null ? read : { ...read, progress: legacy };
    return { course, layout, student, pointer: resolveCurrent(course, student), coachPath: course.coachPath };
  }

  return {
    async load(): Promise<World> {
      const values = await settings.get();
      const config = await readFeatureConfig(deps.featureConfigFile);
      const coursePath = resolveCoursePath(values.coursePath, deps.env, config);
      // A config this plugin can't read stops Tutor: no course at all, so every RPC and tool refuses with its message.
      const refused: CourseResult | null = config.error === undefined ? null : { course: null, error: config.error };
      const [builtinResult, courseResult, resolved] = await Promise.all([
        refused ?? loadBuiltin(),
        refused ?? loadCourse(coursePath),
        resolveWorkspace(bb.sdk, workspaceSetting(values), deps.access),
      ]);
      // Re-checked on every load, not just at confirmWorkspace: a project whose folder now
      // leads into the course would have the coach write spec/, stand-ins/ and the seed into the course.
      const { workspace, hostId } =
        resolved.workspace.status === "found" &&
        resolved.hostId !== null &&
        overlaps(await deps.access(resolved.hostId).realPath(resolved.workspace.root), await realPath(coursePath))
          ? { workspace: { status: "missing" as const, projectId: resolved.workspace.projectId }, hostId: null }
          : resolved;
      const access = workspace.status === "found" && hostId !== null ? deps.access(hostId) : null;
      const courseErrors: World["courseErrors"] =
        refused !== null
          ? [{ source: deps.featureConfigFile, error: refused.error }]
          : [
              ...(builtinResult.course === null ? [{ source: BUILTIN_COURSE_ID, error: builtinResult.error }] : []),
              ...(courseResult.course === null ? [{ source: coursePath, error: courseResult.error }] : []),
            ];
      const others = courseResult.course === null ? [] : [courseResult.course];
      const available = [...(builtinResult.course === null ? [] : [builtinResult.course]), ...others];
      let courses: LoadedCourse[] = [];
      if (workspace.status === "found" && access !== null) {
        const loaded = await Promise.all(others.map((course) => readCourse(course, workspace.root, access)));
        courses =
          builtinResult.course === null ? loaded : [await readBuiltin(builtinResult.course, workspace.root, access, loaded), ...loaded];
      }
      last = courses;
      return {
        coursePath,
        workspace,
        hostId,
        available,
        courses,
        courseErrors,
        projectHint: await resolveProjectHint(deps.env, config, access ?? deps.access(FEATURE_HOST)),
      };
    },
    lastCourses: () => last,
  };
}

function settle(load: Promise<Course>): Promise<CourseResult> {
  return load.then(
    (course): CourseResult => ({ course, error: null }),
    (cause: unknown): CourseResult => ({ course: null, error: cause instanceof Error ? cause.message : String(cause) }),
  );
}
