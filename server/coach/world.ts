// Everything a handler needs, re-derived from disk and BB on each call: the
// course, the factory project, and the student's state. Nothing here comes
// from thread metadata.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { resolveCurrent, type CurrentPointer } from "../../shared/derive.ts";
import type { Course, StudentState } from "../../shared/model.ts";
import type { CourseSource, ProgressStore } from "../../shared/ports.ts";
import type { FactoryProject } from "../../shared/rpc.ts";
import { overlaps, realPath } from "../paths.ts";
import { resolveCoachFile } from "./coach-file.ts";
import { resolveFactory } from "./factory-project.ts";
import { readFeatureConfig, resolveCoursePath, resolveFactoryHint, type Env } from "./course-path.ts";
import type { TutorSettings } from "./settings.ts";

/** Page loads fire several calls at once; they share one course read. */
const COURSE_TTL_MS = 3000;

export interface World {
  coursePath: string;
  course: Course | null;
  courseError: string | null;
  /** The coaching method's file: the course's coach file, else the starter's coach-me skill (coach-file.ts). */
  coachPath: string | null;
  factoryProject: FactoryProject;
  /** The machine holding the factory folder; null without a factory project. */
  factoryHostId: string | null;
  /** Empty state while there is no factory project. */
  student: StudentState;
  /** Null while the course is missing. */
  pointer: CurrentPointer | null;
  factoryHint: string | null;
}

export interface WorldDeps {
  courseSource: CourseSource;
  store: ProgressStore;
  env: Env;
  featureConfigFile: string;
  now: () => Date;
}

export interface WorldSource {
  load(): Promise<World>;
  /** The coach file from the most recent load of the course, for synchronous callers (configure). */
  lastCoachPath(): string | null;
}

const EMPTY_STUDENT: StudentState = { iteration: null, progress: null, problems: [] };

type CourseResult = { course: Course; error: null } | { course: null; error: string };

export function createWorldSource(bb: BbPluginApi, settings: TutorSettings, deps: WorldDeps): WorldSource {
  let cached: { path: string; at: number; result: Promise<CourseResult> } | null = null;
  let lastCoach: string | null = null;

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
      const [courseResult, factory] = await Promise.all([
        loadCourse(coursePath),
        resolveFactory(bb.sdk, values.factoryProject),
      ]);
      // Re-checked on every load, not just at confirmFactory: a factory whose folder now
      // leads into the course would have the coach write spec/, stand-ins/ and ../seeds/ into the course.
      const { factoryProject, hostId } =
        factory.factoryProject.status === "found" && overlaps(await realPath(factory.factoryProject.root), await realPath(coursePath))
          ? { factoryProject: { status: "missing" as const, projectId: factory.factoryProject.projectId }, hostId: null }
          : factory;
      const student = factoryProject.status === "found" ? await deps.store.read(factoryProject.root) : EMPTY_STUDENT;
      const coachPath =
        courseResult.course === null
          ? null
          : await resolveCoachFile(courseResult.course.coachPath, factoryProject.status === "found" ? factoryProject.root : null);
      if (courseResult.course !== null) lastCoach = coachPath;
      return {
        coursePath,
        course: courseResult.course,
        courseError: courseResult.error,
        coachPath,
        factoryProject,
        factoryHostId: hostId,
        student,
        pointer: courseResult.course === null ? null : resolveCurrent(courseResult.course, student),
        factoryHint: resolveFactoryHint(deps.env, config),
      };
    },
    lastCoachPath: () => lastCoach,
  };
}
