import { basename, dirname, join } from "node:path";
import { resolveCurrent } from "../../shared/derive.ts";
import { fixtureBuiltinCourse, fixtureCourse, fixtureLesson0Student, fixtureStudent, fixtureWorkspace } from "../../shared/fixtures.ts";
import type { Course, StudentState } from "../../shared/model.ts";
import type { Workspace } from "../../shared/rpc.ts";
import { builtinLayout, type LoadedCourse, type World } from "../../server/coach/world.ts";
import { capstoneProgress, type Layout } from "../../layouts/capstone-factory/detect.ts";
import type { CourseLayoutState } from "../../layouts/state.ts";

/** What resolveLayout makes of a project whose folder is the factory itself (tetris/.factory, as v0.1.0 set it up). */
export function legacyLayout(root: string): Layout {
  const codebaseDir = dirname(root);
  return {
    mode: "legacy",
    projectRoot: root,
    repoRoot: dirname(codebaseDir),
    factoryDir: root,
    factoryAt: null,
    factoryShown: root,
    codebaseDir,
    codebase: basename(codebaseDir),
    seedsDir: join(codebaseDir, "seeds"),
    seedsShown: "../seeds",
    skillsDir: join(dirname(codebaseDir), ".agents/skills"),
    problems: [],
    blocked: null,
  };
}

/** What resolveLayout makes of a starter clone that is the project, its factory at `factoryAt`. */
export function repoLayout(root: string, factoryAt: "early" | "late" = "early"): Layout {
  const factoryShown = factoryAt === "late" ? "factory" : "tetris/.factory";
  return {
    mode: "repo",
    projectRoot: root,
    repoRoot: root,
    factoryDir: join(root, factoryShown),
    factoryAt,
    factoryShown,
    codebaseDir: join(root, "tetris"),
    codebase: "tetris",
    seedsDir: join(root, "tetris/seeds"),
    seedsShown: "tetris/seeds",
    skillsDir: join(root, ".agents/skills"),
    problems: [],
    blocked: null,
  };
}

/** What resolveCourseLayout makes of `course` in a workspace at `root`: a legacy capstone factory, or a layoutless course's folder. */
export function courseLayout(course: Course, root: string, layout: Layout = legacyLayout(root)): CourseLayoutState {
  if (course.layout === null) {
    return { id: null, ready: true, progress: { dir: join(root, ".tutor/courses", course.id), progressFile: "progress.yaml", iterationFiles: ["ITERATION"] }, problems: [], blocked: null };
  }
  return { id: course.layout, ready: layout.blocked === null, layout, progress: capstoneProgress(layout), problems: layout.problems, blocked: layout.blocked };
}

/**
 * A world with the built-in course (Lesson 0, its student `lesson0`) and
 * `course` (its student `student`), in `workspace`. Without a workspace no
 * course is loaded into it, as world.ts does: only `available`.
 */
export function makeWorld(
  student: StudentState = fixtureStudent,
  workspace: Workspace = fixtureWorkspace,
  course: Course = fixtureCourse,
  lesson0: StudentState = fixtureLesson0Student,
): World {
  const found = workspace.status === "found";
  const courses: LoadedCourse[] = found
    ? [
        { course: fixtureBuiltinCourse, layout: builtinLayout(workspace.root), student: lesson0, pointer: resolveCurrent(fixtureBuiltinCourse, lesson0), coachPath: fixtureBuiltinCourse.coachPath },
        { course, layout: courseLayout(course, workspace.root), student, pointer: resolveCurrent(course, student), coachPath: course.coachPath },
      ]
    : [];
  return {
    coursePath: course.root,
    workspace,
    hostId: found ? "host_1" : null,
    available: [fixtureBuiltinCourse, course],
    courses,
    courseErrors: [],
    projectHint: null,
  };
}

/** `world` with one loaded course changed. */
export function withCourse(world: World, courseId: string, change: Partial<LoadedCourse>): World {
  return { ...world, courses: world.courses.map((entry) => (entry.course.id === courseId ? { ...entry, ...change } : entry)) };
}
