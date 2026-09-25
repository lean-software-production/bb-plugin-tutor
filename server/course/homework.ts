// Reads one homework folder: README.md, FACTORY.md, spec.md and features/*.feature.
// README.md and at least one feature file are required: without them there is
// nothing to coach, and adopting the homework would empty the student's spec/.
// FACTORY.md and spec.md are optional; a homework without FACTORY.md has "".
import { join } from "node:path";
import type { FeatureFile, Homework } from "../../shared/model.ts";
import { CourseLoadError } from "../../shared/ports.ts";
import { parseFeatureFile } from "./feature.ts";
import { listFilesIfPresent, readTextIfPresent, type PathGuard } from "./files.ts";
import type { HomeworkEntry } from "./manifest.ts";

/** A homework before it is compared with the others in its course. */
export type HomeworkContent = Omit<Homework, "suggestedRuleOrder" | "factoryDiff" | "dek">;

/** Names a path inside the course for error messages. */
export type DisplayPath = (absolutePath: string) => string;

const FEATURES_DIR = "features";

export async function readHomework(
  entry: HomeworkEntry,
  builtin: boolean,
  display: DisplayPath,
  guard: PathGuard,
): Promise<HomeworkContent> {
  const readmePath = join(entry.dir, "README.md");
  const factoryPath = join(entry.dir, "FACTORY.md");
  const seedPath = join(entry.dir, "spec.md");
  for (const path of [readmePath, factoryPath, seedPath, join(entry.dir, FEATURES_DIR)]) await guard(path);
  const readme = await readTextIfPresent(readmePath, display(readmePath));
  if (readme === null) {
    throw new CourseLoadError(`Lesson ${entry.id} has no README.md in ${display(entry.dir)}.`);
  }
  return {
    id: entry.id,
    title: entry.title,
    set: entry.set,
    dir: entry.dir,
    builtin,
    readme,
    factoryMd: (await readTextIfPresent(factoryPath, display(factoryPath))) ?? "",
    seedSpec: await readTextIfPresent(seedPath, display(seedPath)),
    features: await readFeatures(entry, display),
  };
}

async function readFeatures(entry: HomeworkEntry, display: DisplayPath): Promise<FeatureFile[]> {
  const featuresDir = join(entry.dir, FEATURES_DIR);
  const names = (await listFilesIfPresent(featuresDir, display(featuresDir))) ?? [];
  const paths = names
    .filter((name) => name.endsWith(".feature"))
    .map((name) => `${FEATURES_DIR}/${name}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (paths.length === 0) {
    throw new CourseLoadError(`Lesson ${entry.id} has no feature files in ${display(featuresDir)}.`);
  }
  const features: FeatureFile[] = [];
  for (const path of paths) {
    const absolute = join(entry.dir, path);
    const text = (await readTextIfPresent(absolute, display(absolute))) ?? "";
    features.push(parseFeatureFile({ text, path, displayPath: display(absolute) }));
  }
  const slugs = features.map((feature) => feature.slug);
  const repeated = slugs.find((slug, index) => slugs.indexOf(slug) !== index);
  if (repeated !== undefined) {
    throw new CourseLoadError(
      `Lesson ${entry.id} has two feature files that both become "${repeated}"; rename one.`,
    );
  }
  return features;
}
