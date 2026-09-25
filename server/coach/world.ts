// Everything a handler needs, re-derived from disk and BB on each call: the
// course, the factory binding, and the student's state. Nothing here comes
// from thread metadata.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { resolveCurrent, type CurrentPointer } from "../../shared/derive.ts";
import type { Course, StudentState } from "../../shared/model.ts";
import type { CourseSource, ProgressStore } from "../../shared/ports.ts";
import type { Binding } from "../../shared/rpc.ts";
import { resolveFactory } from "./binding.ts";
import { readFeatureConfig, resolveCoursePath, resolveFactoryHint, type Env } from "./course-path.ts";
import type { TutorSettings } from "./settings.ts";

/** Page loads fire several calls at once; they share one course read. */
const COURSE_TTL_MS = 3000;

export interface World {
  coursePath: string;
  course: Course | null;
  courseError: string | null;
  binding: Binding;
  /** The machine holding the factory folder; null unless bound. */
  factoryHostId: string | null;
  /** Empty state while the factory is not bound. */
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
  /** The course from the most recent load, for synchronous callers (configure). */
  lastCourse(): Course | null;
}

const EMPTY_STUDENT: StudentState = { iteration: null, progress: null, problems: [] };

type CourseResult = { course: Course; error: null } | { course: null; error: string };

export function createWorldSource(bb: BbPluginApi, settings: TutorSettings, deps: WorldDeps): WorldSource {
  let cached: { path: string; at: number; result: Promise<CourseResult> } | null = null;
  let last: Course | null = null;

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
      const [courseResult, { binding, hostId }] = await Promise.all([
        loadCourse(coursePath),
        resolveFactory(bb.sdk, values.factoryProject),
      ]);
      const student = binding.status === "bound" ? await deps.store.read(binding.root) : EMPTY_STUDENT;
      if (courseResult.course !== null) last = courseResult.course;
      return {
        coursePath,
        course: courseResult.course,
        courseError: courseResult.error,
        binding,
        factoryHostId: hostId,
        student,
        pointer: courseResult.course === null ? null : resolveCurrent(courseResult.course, student),
        factoryHint: resolveFactoryHint(deps.env, config),
      };
    },
    lastCourse: () => last,
  };
}
