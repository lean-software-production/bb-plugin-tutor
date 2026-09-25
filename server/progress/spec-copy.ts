// Adopting a lesson's spec, exactly as the course's coach-me does it:
// spec/ holds only the lesson's README.md, FACTORY.md and features/ (plus
// Tutor's own ITERATION and PROGRESS.yaml), and a sample seed is copied into
// seeds/ unless it is already there.
import { access, copyFile, cp, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { FACTORY_FILES } from "../../shared/constants.ts";
import { slugify } from "../../shared/keys.ts";
import type { Lesson } from "../../shared/model.ts";
import { ownFolder } from "./own-folder.ts";

const KEPT_IN_SPEC = new Set([basename(FACTORY_FILES.iteration), basename(FACTORY_FILES.progress)]);
const SPEC_FILES = ["README.md", "FACTORY.md"];
const FEATURES_DIR = "features";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether anything is at `path`, a dangling symbolic link included. */
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

export async function copyLessonSpec(factoryRoot: string, lesson: Lesson): Promise<SpecCopyResult> {
  await requireFeatureFiles(lesson);
  const specDir = await ownFolder(factoryRoot, FACTORY_FILES.specDir);
  const seedsDir = lesson.seedSpec === null ? null : await ownFolder(factoryRoot, FACTORY_FILES.seedsDir);
  const seed = lesson.seedSpec === null ? null : `${FACTORY_FILES.seedsDir}/${seedFileName(lesson.seedSpec, lesson.id)}`;
  const seedAlreadyThere = seed !== null && (await seedPresent(join(factoryRoot, seed), seed));
  await mkdir(specDir, { recursive: true });
  for (const entry of await readdir(specDir)) {
    if (!KEPT_IN_SPEC.has(entry)) await rm(join(specDir, entry), { recursive: true, force: true });
  }

  const written: string[] = [];
  for (const file of SPEC_FILES) {
    const source = join(lesson.dir, file);
    if (!(await exists(source))) continue;
    await copyFile(source, join(specDir, file));
    written.push(`${FACTORY_FILES.specDir}/${file}`);
  }
  await cp(join(lesson.dir, FEATURES_DIR), join(specDir, FEATURES_DIR), { recursive: true });
  written.push(`${FACTORY_FILES.specDir}/${FEATURES_DIR}/`);

  if (lesson.seedSpec === null || seedsDir === null || seed === null) return { written, seed: null, seedAlreadyThere: false };
  if (seedAlreadyThere) return { written, seed, seedAlreadyThere: true };
  await mkdir(seedsDir, { recursive: true });
  // "wx" never follows a symbolic link created since the check to write elsewhere.
  await writeFile(join(factoryRoot, seed), lesson.seedSpec, { encoding: "utf8", flag: "wx" });
  return { written: [...written, seed], seed, seedAlreadyThere: false };
}
