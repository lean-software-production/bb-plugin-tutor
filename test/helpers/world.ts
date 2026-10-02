import { basename, dirname, join } from "node:path";
import { resolveCurrent } from "../../shared/derive.ts";
import { fixtureWorkspace, fixtureCourse, fixtureStudent } from "../../shared/fixtures.ts";
import type { Course, StudentState } from "../../shared/model.ts";
import type { Workspace } from "../../shared/rpc.ts";
import type { World } from "../../server/coach/world.ts";
import type { Layout } from "../../layouts/capstone-factory/detect.ts";

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
    layout: workspace.status === "found" ? legacyLayout(workspace.root) : null,
    student: effective,
    pointer: resolveCurrent(course, effective),
    projectHint: null,
  };
}
