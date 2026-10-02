import { basename, dirname, join } from "node:path";
import { resolveCurrent } from "../../shared/derive.ts";
import { fixtureWorkspace, fixtureCourse, fixtureStudent } from "../../shared/fixtures.ts";
import type { Course, StudentState } from "../../shared/model.ts";
import type { Workspace } from "../../shared/rpc.ts";
import type { World } from "../../server/coach/world.ts";
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

export function makeWorld(
  student: StudentState = fixtureStudent,
  workspace: Workspace = fixtureWorkspace,
  course: Course = fixtureCourse,
): World {
  const effective = workspace.status === "found" ? student : { iteration: null, progress: null, problems: [] };
  return {
    coursePath: course.root,
    course,
    courseError: null,
    coachPath: course.coachPath,
    workspace,
    hostId: workspace.status === "found" ? "host_1" : null,
    layout: workspace.status === "found" ? courseLayout(course, workspace.root) : null,
    student: effective,
    pointer: resolveCurrent(course, effective),
    projectHint: null,
  };
}
