// Adopting a lesson's spec, exactly as the course's coach-me does it:
// spec/ holds only the lesson's README.md, FACTORY.md and features/ (plus
// Tutor's own ITERATION and PROGRESS.yaml), and a sample seed is copied into
// seeds/ unless it is already there. The new files are staged inside spec/
// first and swapped in only once all of them copied, so a lesson that can't be
// copied leaves the previous snapshot as it was.
//
// The two working folders have fixed names, so what a crash leaves behind is
// found by name alone: spec/.tutor-adopting/ holds the staged lesson and
// spec/.tutor-previous/ the old files while they are moved aside. Adoption
// runs under the factory lock, one at a time, so a fixed name never clashes
// with a live adoption, and the next adoption starts by recovering whatever
// is left in them (recoverLeftovers).
import { access, copyFile, cp, lstat, mkdir, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { FACTORY_FILES } from "../../shared/constants.ts";
import { slugify } from "../../shared/keys.ts";
import type { Lesson } from "../../shared/model.ts";
import { ownFolder } from "./own-folder.ts";

const KEPT_IN_SPEC = new Set([basename(FACTORY_FILES.iteration), basename(FACTORY_FILES.progress)]);
const README = "README.md";
const OPTIONAL_SPEC_FILES = ["FACTORY.md"];
const FEATURES_DIR = "features";
/** The staged lesson, inside spec/ so the swap is a rename on one filesystem. */
const ADOPTING_DIR = ".tutor-adopting";
/** The previous snapshot's files while they are moved aside. */
const PREVIOUS_DIR = ".tutor-previous";
/** Staging folders of builds before the fixed names (random suffix, either role). */
const LEGACY_STAGING_PREFIX = ".tutor-staging-";

/** Whether `entry` in spec/ is one of Tutor's working folders rather than part of the snapshot. */
function isWorkingFolder(entry: string): boolean {
  return entry === ADOPTING_DIR || entry === PREVIOUS_DIR || entry.startsWith(LEGACY_STAGING_PREFIX);
}

/** Hooks for tests to act in the middle of the swap. */
export interface SpecCopyHooks {
  afterMovedAside?: () => Promise<void>;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isMissing(cause: unknown): boolean {
  return (cause as { code?: unknown }).code === "ENOENT";
}

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

/** A spec/ path as the student reads it, relative to the factory root. */
function specPath(...parts: string[]): string {
  return [FACTORY_FILES.specDir, ...parts].join("/");
}

/**
 * Puts back what a crashed adoption left in spec/. Each working folder that
 * is a real folder gives back its entries that spec/ is missing (an entry
 * spec/ has is never overwritten), oldest role first: the moved-aside
 * previous files, then legacy staging folders. Then the folder is removed.
 * A working folder that is anything else (a symbolic link above all) is
 * removed itself and never read or followed. A folder with an entry that
 * spec/ misses but can't take back is kept, and the adoption refused.
 */
async function recoverLeftovers(specDir: string): Promise<void> {
  const leftovers = (await readdir(specDir)).filter(isWorkingFolder).sort((a, b) => {
    const rank = (name: string) => (name === PREVIOUS_DIR ? 0 : name === ADOPTING_DIR ? 2 : 1);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  for (const leftover of leftovers) {
    const path = join(specDir, leftover);
    const stats = await lstat(path);
    if (!stats.isDirectory()) {
      await unlink(path);
      continue;
    }
    // The staged lesson is a copy of course files: never worth restoring.
    if (leftover !== ADOPTING_DIR) {
      for (const entry of await readdir(path)) {
        if (isWorkingFolder(entry)) continue;
        const present = await lstat(join(specDir, entry)).then(
          () => true,
          (cause: unknown) => {
            if (isMissing(cause)) return false;
            throw cause;
          },
        );
        if (present) continue;
        try {
          await rename(join(path, entry), join(specDir, entry));
        } catch (cause) {
          throw new Error(
            `An earlier adoption didn't finish and Tutor couldn't put ${specPath(leftover, entry)} back (${errorText(cause)}). ` +
              `Move what you want to keep from ${specPath(leftover)}/ into ${specPath()}/, delete ${specPath(leftover)}/, then adopt again.`,
            { cause },
          );
        }
      }
    }
    await rm(path, { recursive: true, force: true });
  }
}

/**
 * Replaces spec/'s lesson files with the staged ones, keeping Tutor's own. The
 * old files move aside into PREVIOUS_DIR first and come back if moving a new
 * one in fails. They are deleted only once the swap finished or every one of
 * them is back; otherwise they stay where they are and the error says where.
 */
async function swapIn(specDir: string, staging: string, names: string[], hooks: SpecCopyHooks): Promise<void> {
  const previous = join(specDir, PREVIOUS_DIR);
  await mkdir(previous);
  const movedAside: string[] = [];
  const movedIn: string[] = [];
  try {
    for (const entry of await readdir(specDir)) {
      if (KEPT_IN_SPEC.has(entry) || isWorkingFolder(entry)) continue;
      await rename(join(specDir, entry), join(previous, entry));
      movedAside.push(entry);
    }
    await hooks.afterMovedAside?.();
    for (const name of names) {
      await rename(join(staging, name), join(specDir, name));
      movedIn.push(name);
    }
  } catch (cause) {
    for (const name of movedIn) await rename(join(specDir, name), join(staging, name)).catch(() => undefined);
    const stranded: string[] = [];
    for (const entry of movedAside) {
      await rename(join(previous, entry), join(specDir, entry)).catch(() => stranded.push(specPath(PREVIOUS_DIR, entry)));
    }
    if (stranded.length > 0) {
      throw new Error(
        `${errorText(cause)}. Tutor couldn't put the previous spec files back, so they are kept in ${specPath(PREVIOUS_DIR)}/: ` +
          `${stranded.join(", ")}. Move them back into ${specPath()}/ yourself; the next adoption puts back the ones ${specPath()}/ is missing and then clears ${specPath(PREVIOUS_DIR)}/.`,
        { cause },
      );
    }
    await rm(previous, { recursive: true, force: true });
    throw cause;
  }
  await rm(previous, { recursive: true, force: true });
}

export async function copyLessonSpec(factoryRoot: string, lesson: Lesson, hooks: SpecCopyHooks = {}): Promise<SpecCopyResult> {
  await requireFeatureFiles(lesson);
  const specDir = await ownFolder(factoryRoot, FACTORY_FILES.specDir);
  const seedsDir = lesson.seedSpec === null ? null : await ownFolder(factoryRoot, FACTORY_FILES.seedsDir);
  const seed = lesson.seedSpec === null ? null : `${FACTORY_FILES.seedsDir}/${seedFileName(lesson.seedSpec, lesson.id)}`;
  const seedAlreadyThere = seed !== null && (await seedPresent(join(factoryRoot, seed), seed));
  await mkdir(specDir, { recursive: true });
  await recoverLeftovers(specDir);

  // Stage inside spec/ (checked above not to be a symbolic link). A plain
  // mkdir fails rather than follow anything that appeared there meanwhile.
  const staging = join(specDir, ADOPTING_DIR);
  await mkdir(staging);
  let names: string[];
  try {
    names = await stageLesson(lesson, staging);
    await swapIn(specDir, staging, names, hooks);
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
