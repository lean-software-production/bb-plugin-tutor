// Adopting a lesson's spec, exactly as the course's coach-me does it:
// spec/ holds only the lesson's README.md, FACTORY.md and features/ (plus
// Tutor's own ITERATION and PROGRESS.yaml), and a sample seed is copied into
// seeds/ unless it is already there. The new files are staged inside spec/
// first and swapped in only once all of them copied, so a lesson that can't be
// copied leaves the previous snapshot as it was.
import { access, copyFile, cp, lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { FACTORY_FILES } from "../../shared/constants.ts";
import { slugify } from "../../shared/keys.ts";
import type { Lesson } from "../../shared/model.ts";
import { ownFolder } from "./own-folder.ts";

const KEPT_IN_SPEC = new Set([basename(FACTORY_FILES.iteration), basename(FACTORY_FILES.progress)]);
const README = "README.md";
const OPTIONAL_SPEC_FILES = ["FACTORY.md"];
const FEATURES_DIR = "features";
/** Staging folders inside spec/; a leftover one (from a crash) is cleared by the next adoption. */
const STAGING_PREFIX = ".tutor-staging-";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether the seed is already there. A symbolic link in its place is refused, dangling or not. */
async function seedPresent(path: string, display: string): Promise<boolean> {
  const stats = await lstat(path).catch(() => null);
  if (stats?.isSymbolicLink()) throw new Error(`${display} is a symbolic link; replace it with the seed file itself.`);
  return stats !== null;
}

/** Refuses a lesson with nothing to coach before anything in spec/ is replaced. */
async function requireFeatureFiles(lesson: Lesson): Promise<void> {
  const names = await readdir(join(lesson.dir, FEATURES_DIR)).catch(() => []);
  if (!names.some((name) => name.endsWith(".feature"))) {
    throw new Error(`Lesson ${lesson.id} has no feature files in ${lesson.dir}, so it cannot be adopted.`);
  }
}

/** The seed's file name: its `#` title slugified ("# Tetris" → tetris.md), as coach-me names 001's. */
export function seedFileName(seed: string, lessonId: string): string {
  const title = /^#\s+(.+)$/m.exec(seed)?.[1]?.trim();
  return `${title === undefined ? `homework-${lessonId}` : slugify(title)}.md`;
}

export interface SpecCopyResult {
  /** Paths written, relative to the factory root. */
  written: string[];
  /** The seed's path relative to the factory root, or null when the lesson has none. */
  seed: string | null;
  seedAlreadyThere: boolean;
}

/** Copies the lesson's files into `staging`; the names copied, README.md and features/ always among them. */
async function stageLesson(lesson: Lesson, staging: string): Promise<string[]> {
  try {
    await copyFile(join(lesson.dir, README), join(staging, README));
  } catch (cause) {
    if ((cause as { code?: unknown }).code === "ENOENT") {
      throw new Error(`Lesson ${lesson.id} has no README.md in ${lesson.dir}, so it cannot be adopted.`);
    }
    throw cause;
  }
  const names = [README];
  for (const file of OPTIONAL_SPEC_FILES) {
    const source = join(lesson.dir, file);
    if (!(await exists(source))) continue;
    await copyFile(source, join(staging, file));
    names.push(file);
  }
  await cp(join(lesson.dir, FEATURES_DIR), join(staging, FEATURES_DIR), { recursive: true });
  return [...names, FEATURES_DIR];
}

/**
 * Replaces spec/'s lesson files with the staged ones, keeping Tutor's own. The
 * old files move aside first and come back if moving a new one in fails.
 */
async function swapIn(specDir: string, staging: string, names: string[]): Promise<void> {
  const old = await mkdtemp(join(specDir, STAGING_PREFIX));
  const movedAside: string[] = [];
  const movedIn: string[] = [];
  try {
    for (const entry of await readdir(specDir)) {
      if (KEPT_IN_SPEC.has(entry) || entry.startsWith(STAGING_PREFIX)) continue;
      await rename(join(specDir, entry), join(old, entry));
      movedAside.push(entry);
    }
    for (const name of names) {
      await rename(join(staging, name), join(specDir, name));
      movedIn.push(name);
    }
  } catch (cause) {
    for (const name of movedIn) await rename(join(specDir, name), join(staging, name)).catch(() => undefined);
    for (const entry of movedAside) await rename(join(old, entry), join(specDir, entry)).catch(() => undefined);
    await rm(old, { recursive: true, force: true });
    throw cause;
  }
  await rm(old, { recursive: true, force: true });
}

export async function copyLessonSpec(factoryRoot: string, lesson: Lesson): Promise<SpecCopyResult> {
  await requireFeatureFiles(lesson);
  const specDir = await ownFolder(factoryRoot, FACTORY_FILES.specDir);
  const seedsDir = lesson.seedSpec === null ? null : await ownFolder(factoryRoot, FACTORY_FILES.seedsDir);
  const seed = lesson.seedSpec === null ? null : `${FACTORY_FILES.seedsDir}/${seedFileName(lesson.seedSpec, lesson.id)}`;
  const seedAlreadyThere = seed !== null && (await seedPresent(join(factoryRoot, seed), seed));
  await mkdir(specDir, { recursive: true });

  // Stage inside spec/ (checked above not to be a symbolic link), so the swap is a rename on one filesystem.
  const staging = await mkdtemp(join(specDir, STAGING_PREFIX));
  let names: string[];
  try {
    names = await stageLesson(lesson, staging);
    await swapIn(specDir, staging, names);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  const written = names.map((name) => (name === FEATURES_DIR ? `${FACTORY_FILES.specDir}/${FEATURES_DIR}/` : `${FACTORY_FILES.specDir}/${name}`));

  if (lesson.seedSpec === null || seedsDir === null || seed === null) return { written, seed: null, seedAlreadyThere: false };
  if (seedAlreadyThere) return { written, seed, seedAlreadyThere: true };
  await mkdir(seedsDir, { recursive: true });
  // "wx" never follows a symbolic link created since the check to write elsewhere.
  await writeFile(join(factoryRoot, seed), lesson.seedSpec, { encoding: "utf8", flag: "wx" });
  return { written: [...written, seed], seed, seedAlreadyThere: false };
}
