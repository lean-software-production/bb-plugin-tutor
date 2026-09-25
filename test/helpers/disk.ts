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

/** fixtureCourse with every non-builtin homework written to disk under a temp course root. */
export async function makeSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "tutor-test-"));
  const courseRoot = join(root, "tutorial");
  const factoryRoot = join(root, "my-factory");
  await mkdir(factoryRoot, { recursive: true });
  const homeworks = [];
  for (const homework of fixtureCourse.homeworks) {
    const dir = join(courseRoot, "docs/iterations", `${homework.id}-${homework.title.toLowerCase().replace(/\W+/g, "-")}`);
    await mkdir(join(dir, "features"), { recursive: true });
    await writeFile(join(dir, "README.md"), homework.readme);
    if (homework.factoryMd !== "") await writeFile(join(dir, "FACTORY.md"), homework.factoryMd);
    if (homework.seedSpec !== null) await writeFile(join(dir, "spec.md"), homework.seedSpec);
    for (const feature of homework.features) {
      await writeFile(join(dir, feature.path), `Feature: ${feature.name}\n`);
    }
    homeworks.push({ ...homework, dir });
  }
  const course: Course = {
    ...fixtureCourse,
    root: courseRoot,
    coachPath: join(courseRoot, ".agents/coach-me.md"),
    homeworks,
  };
  return { root, course, factoryRoot, cleanup: () => rm(root, { recursive: true, force: true }) };
}
