// Reads a course from disk into the shared Course model: the manifest (from
// course.yaml or the ledger), Homework 0 in front, every homework's content,
// then novelty, suggested Rule order and FACTORY.md diffs between homeworks.
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { BUILTIN_HOMEWORK_ID, COURSE_FILES } from "../../shared/constants.ts";
import { slugify } from "../../shared/keys.ts";
import type { Course, Homework, LexiconEntry } from "../../shared/model.ts";
import { CourseLoadError } from "../../shared/ports.ts";
import { BUILTIN_COURSE_ROOT } from "./builtin.ts";
import { factoryDiff } from "./factory-diff.ts";
import { guardWithin, isDirectory, isFile, readTextIfPresent, type PathGuard } from "./files.ts";
import { readHomework } from "./homework.ts";
import type { DisplayPath, HomeworkContent } from "./homework.ts";
import { parseLedger } from "./ledger.ts";
import { parseLexicon } from "./lexicon.ts";
import { parseCourseYaml } from "./manifest.ts";
import type { CourseManifest } from "./manifest.ts";
import { suggestedRuleOrder, withNovelty } from "./novelty.ts";
import { firstHeading, readmeDek, sharedSentences } from "./readme.ts";

interface LocatedManifest {
  manifest: CourseManifest;
  source: Course["source"];
  /** The file it came from, for error messages. */
  displayPath: string;
}

export async function loadCourse(coursePath: string): Promise<Course> {
  const root = resolve(coursePath);
  if (!(await isDirectory(root))) {
    throw new CourseLoadError(`There is no course folder at ${root}.`);
  }
  const display = displayWithin(root);
  const guard = guardWithin(root, display);
  const { manifest, source, displayPath } = await readManifest(root, display, guard);
  checkHomeworkIds(manifest, displayPath);
  await checkManifestPaths(manifest, displayPath, guard);

  const builtin = await readBuiltinHomeworks();
  const contents = await Promise.all(
    manifest.homeworks.map((entry) => readHomework(entry, false, display, guard)),
  );
  return {
    id: manifest.id,
    title: manifest.title,
    description: manifest.description,
    root,
    coachPath: await requireIfNamed(manifest.coachPath, "coach", display),
    homeworks: [...deriveInOrder(builtin), ...deriveInOrder(contents)],
    lexicon: await readLexicon(manifest.lexiconPath, display),
    source,
  };
}

function displayWithin(root: string): DisplayPath {
  return (absolutePath) => {
    const rel = relative(root, absolutePath);
    return rel === "" || rel.split(sep)[0] === ".." ? absolutePath : rel.split(sep).join("/");
  };
}

async function readManifest(root: string, display: DisplayPath, guard: PathGuard): Promise<LocatedManifest> {
  const yamlPath = join(root, COURSE_FILES.manifest);
  await guard(yamlPath);
  const yaml = await readTextIfPresent(yamlPath, display(yamlPath));
  if (yaml !== null) {
    const displayPath = display(yamlPath);
    return { manifest: parseCourseYaml(yaml, root, displayPath), source: "course.yaml", displayPath };
  }
  const ledgerPath = join(root, COURSE_FILES.ledger);
  await guard(ledgerPath);
  const ledger = await readTextIfPresent(ledgerPath, display(ledgerPath));
  if (ledger === null) {
    throw new CourseLoadError(
      `${root} is not a course: it has neither a ${COURSE_FILES.manifest} nor a ledger at ${COURSE_FILES.ledger}.`,
    );
  }
  const readmePath = join(root, "README.md");
  await guard(readmePath);
  const readme = await readTextIfPresent(readmePath, display(readmePath));
  const id = slugify(basename(root));
  const ifPresent = async (path: string): Promise<string | null> => ((await isFile(path)) ? path : null);
  return {
    manifest: {
      id,
      title: (readme === null ? null : firstHeading(readme)) ?? id,
      description: null,
      coachPath: await ifPresent(join(root, COURSE_FILES.defaultCoach)),
      lexiconPath: await ifPresent(join(root, COURSE_FILES.defaultLexicon)),
      homeworks: parseLedger(ledger, dirname(ledgerPath), display(ledgerPath), root),
    },
    source: "ledger",
    displayPath: display(ledgerPath),
  };
}

/** Where the manifest's paths lead once symbolic links are followed: inside the course only. */
async function checkManifestPaths(manifest: CourseManifest, where: string, guard: PathGuard): Promise<void> {
  const paths = [manifest.coachPath, manifest.lexiconPath, ...manifest.homeworks.map((entry) => entry.dir)];
  for (const path of paths) if (path !== null) await guard(path, where);
}

function checkHomeworkIds(manifest: CourseManifest, where: string): void {
  const seen = new Set<string>();
  for (const { id } of manifest.homeworks) {
    if (id === BUILTIN_HOMEWORK_ID) {
      throw new CourseLoadError(`${where}: lesson ${id} is reserved for the built-in Lesson 0.`);
    }
    if (seen.has(id)) throw new CourseLoadError(`${where}: lesson ${id} is listed twice.`);
    seen.add(id);
  }
}

async function readBuiltinHomeworks(): Promise<HomeworkContent[]> {
  const display = (path: string): string => `Lesson 0 (built in): ${displayWithin(BUILTIN_COURSE_ROOT)(path)}`;
  const yamlPath = join(BUILTIN_COURSE_ROOT, COURSE_FILES.manifest);
  const yaml = await readTextIfPresent(yamlPath, display(yamlPath));
  if (yaml === null) throw new CourseLoadError(`Tutor's built-in Lesson 0 is missing from ${BUILTIN_COURSE_ROOT}.`);
  const manifest = parseCourseYaml(yaml, BUILTIN_COURSE_ROOT, display(yamlPath));
  const guard = guardWithin(BUILTIN_COURSE_ROOT, display);
  return Promise.all(manifest.homeworks.map((entry) => readHomework(entry, true, display, guard)));
}

/**
 * Each homework compared with the one before it (the first has nothing before
 * it), and its dek read without the sentences every README repeats.
 */
function deriveInOrder(contents: readonly HomeworkContent[]): Homework[] {
  const boilerplate = sharedSentences(contents.map((content) => content.readme));
  return contents.map((content, index) => derive(content, contents[index - 1] ?? null, boilerplate));
}

function derive(content: HomeworkContent, previous: HomeworkContent | null, boilerplate: ReadonlySet<string>): Homework {
  const features = withNovelty(content.features, previous?.features ?? null);
  return {
    ...content,
    dek: readmeDek(content.readme, boilerplate),
    features,
    suggestedRuleOrder: suggestedRuleOrder(features),
    factoryDiff: previous === null ? null : factoryDiff(previous.factoryMd, content.factoryMd),
  };
}

async function requireIfNamed(path: string | null, field: string, display: DisplayPath): Promise<string | null> {
  if (path === null || (await isFile(path))) return path;
  throw new CourseLoadError(`The course names ${display(path)} as its ${field}, but there is no such file.`);
}

async function readLexicon(path: string | null, display: DisplayPath): Promise<LexiconEntry[]> {
  const present = await requireIfNamed(path, "lexicon", display);
  if (present === null) return [];
  return parseLexicon((await readTextIfPresent(present, display(present))) ?? "", display(present));
}
