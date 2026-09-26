// Temp directories holding a fixture course and a student's starter clone, for
// tests that exercise real file I/O. The layout follows capstone-project-starter:
// the git root is the clone, the codebase is tetris/ and the factory is
// tetris/.factory.
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureCourse } from "../../shared/fixtures.ts";
import type { Course } from "../../shared/model.ts";

export interface Sandbox {
  root: string;
  course: Course;
  /** The codebase the factory builds: the factory's parent folder, tetris/. */
  codebaseRoot: string;
  factoryRoot: string;
  cleanup(): Promise<void>;
}

/**
 * fixtureCourse with every non-builtin lesson, and the course's stand-ins/,
 * written to disk under a temp course root, beside an empty starter clone.
 */
export async function makeSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "tutor-test-"));
  const courseRoot = join(root, "tutorial");
  const starterRoot = join(root, "capstone-project-starter");
  const codebaseRoot = join(starterRoot, "tetris");
  const factoryRoot = join(codebaseRoot, ".factory");
  await mkdir(join(starterRoot, ".git"), { recursive: true });
  await mkdir(factoryRoot, { recursive: true });
  await mkdir(join(courseRoot, "stand-ins"), { recursive: true });
  await writeFile(join(courseRoot, "stand-ins/README.md"), "# Stand-ins\n");
  await writeFile(join(courseRoot, "stand-ins/plan-alpha-beta"), "#!/bin/sh\necho alpha beta\n");
  await chmod(join(courseRoot, "stand-ins/plan-alpha-beta"), 0o755);
  const lessons = [];
  for (const lesson of fixtureCourse.lessons) {
    const dir = join(courseRoot, "docs/iterations", `${lesson.id}-${lesson.title.toLowerCase().replace(/\W+/g, "-")}`);
    await mkdir(join(dir, "features"), { recursive: true });
    await writeFile(join(dir, "README.md"), lesson.readme);
    if (lesson.factoryMd !== "") await writeFile(join(dir, "FACTORY.md"), lesson.factoryMd);
    if (lesson.seedSpec !== null) await writeFile(join(dir, "spec.md"), lesson.seedSpec);
    for (const feature of lesson.features) {
      await writeFile(join(dir, feature.path), `Feature: ${feature.name}\n`);
    }
    lessons.push({ ...lesson, dir });
  }
  const course: Course = {
    ...fixtureCourse,
    root: courseRoot,
    coachPath: join(courseRoot, ".agents/coach-me.md"),
    lessons,
  };
  return { root, course, codebaseRoot, factoryRoot, cleanup: () => rm(root, { recursive: true, force: true }) };
}
