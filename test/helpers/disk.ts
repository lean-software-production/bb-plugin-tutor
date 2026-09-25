// Temp directories holding a fixture course and a factory repo, for tests
// that exercise real file I/O.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureCourse } from "../../shared/fixtures.ts";
import type { Course } from "../../shared/model.ts";

export interface Sandbox {
  root: string;
  course: Course;
  factoryRoot: string;
  cleanup(): Promise<void>;
}

/** fixtureCourse with every non-builtin lesson written to disk under a temp course root. */
export async function makeSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "tutor-test-"));
  const courseRoot = join(root, "tutorial");
  const factoryRoot = join(root, "my-factory");
  await mkdir(factoryRoot, { recursive: true });
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
  return { root, course, factoryRoot, cleanup: () => rm(root, { recursive: true, force: true }) };
}
