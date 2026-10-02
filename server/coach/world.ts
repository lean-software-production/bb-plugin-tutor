// Everything a handler needs, re-derived from disk and BB on each call: the
// course, the workspace, the course's layout in it (layouts/state.ts), and
// the student's state. Nothing here comes from thread metadata. The workspace
// is reached only through the WorkspaceAccess for its machine.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { resolveCurrent, type CurrentPointer } from "../../shared/derive.ts";
import { slugify } from "../../shared/keys.ts";
import type { Course, StudentState } from "../../shared/model.ts";
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

export interface World {
  coursePath: string;
  course: Course | null;
  courseError: string | null;
  /** The coaching method's file: the course's coach file, else the starter's coach-me skill (coach-file.ts). */
  coachPath: string | null;
  /** The BB project Tutor coaches in: the student's repo, or (legacy) the factory folder itself. */
  workspace: Workspace;
  /** The machine holding the project's folder; null without a workspace. */
  hostId: string | null;
  /** The course's layout in the workspace, and where its progress is; null without a workspace or a course. */
  layout: CourseLayoutState | null;
  /** Read from layout.progress, with the layout's problems. Empty state while there is no workspace or course. */
  student: StudentState;
  /** Null while the course is missing. */
  pointer: CurrentPointer | null;
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
  /** The coach file from the most recent load of the course, for synchronous callers (configure). */
  lastCoachPath(): string | null;
  /** The layout from the most recent load, for synchronous callers (configure). */
  lastLayout(): CourseLayoutState | null;
}

/**
 * Where a layoutless course keeps its files in the workspace: .tutor/courses/<id>.
 * course.yaml's id is any text, so it is slugged: an id like "../x" never leads out of .tutor/courses.
 */
function courseDirOf(course: Course): string {
  return `.tutor/courses/${slugify(course.id)}`;
}

const EMPTY_STUDENT: StudentState = { iteration: null, progress: null, problems: [] };

type CourseResult = { course: Course; error: null } | { course: null; error: string };

export function createWorldSource(bb: BbPluginApi, settings: TutorSettings, deps: WorldDeps): WorldSource {
  let cached: { path: string; at: number; result: Promise<CourseResult> } | null = null;
  let lastCoach: string | null = null;
  let lastLayout: CourseLayoutState | null = null;

  function loadCourse(path: string): Promise<CourseResult> {
    const now = deps.now().getTime();
    if (cached !== null && cached.path === path && now - cached.at < COURSE_TTL_MS) return cached.result;
    const result = deps.courseSource.loadCourse(path).then(
      (course): CourseResult => ({ course, error: null }),
      (cause: unknown): CourseResult => ({ course: null, error: cause instanceof Error ? cause.message : String(cause) }),
    );
    cached = { path, at: now, result };
    return result;
  }

  return {
    async load(): Promise<World> {
      const values = await settings.get();
      const config = await readFeatureConfig(deps.featureConfigFile);
      const coursePath = resolveCoursePath(values.coursePath, deps.env, config);
      // A config this plugin can't read stops Tutor: no course, so every RPC and tool refuses with its message.
      const [courseResult, resolved] = await Promise.all([
        config.error === undefined ? loadCourse(coursePath) : Promise.resolve<CourseResult>({ course: null, error: config.error }),
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
      const course = courseResult.course;
      const layout =
        workspace.status === "found" && access !== null && course !== null
          ? await resolveCourseLayout(course.layout, workspace.root, courseDirOf(course), access)
          : null;
      const read = layout === null || access === null ? EMPTY_STUDENT : await deps.store.read(access, layout.progress);
      const student = layout === null || layout.problems.length === 0 ? read : { ...read, problems: [...layout.problems, ...read.problems] };
      const coachPath =
        courseResult.course === null
          ? null
          : access === null
            ? courseResult.course.coachPath
            : await resolveCoachFile(courseResult.course.coachPath, layout?.id === "capstone-factory" ? layout.layout.factoryDir : null, access);
      if (courseResult.course !== null) lastCoach = coachPath;
      lastLayout = layout;
      return {
        coursePath,
        course: courseResult.course,
        courseError: courseResult.error,
        coachPath,
        workspace,
        hostId,
        layout,
        student,
        pointer: courseResult.course === null ? null : resolveCurrent(courseResult.course, student),
        projectHint: await resolveProjectHint(deps.env, config, access ?? deps.access(FEATURE_HOST)),
      };
    },
    lastCoachPath: () => lastCoach,
    lastLayout: () => lastLayout,
  };
}
