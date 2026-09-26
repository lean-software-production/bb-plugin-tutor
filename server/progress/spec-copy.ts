// Adopting a lesson's spec, with the same result as the starter's
// fetch-iteration (fetch.sh): spec/README.md, spec/FACTORY.md and
// spec/features/ become the lesson's, leaving anything else in spec/ alone;
// the lesson's sample seed is copied to ../seeds/<codebase>.md (tetris.md)
// unless that file is already there; and stand-ins/ is refreshed wholesale
// from the course's. Every check runs before anything is written, so a
// refusal leaves the factory as it was. Tutor's tools write ITERATION last.
//
// spec/ and stand-ins/ are each refreshed the same way: the new files are
// staged inside the folder first and swapped in only once all of them copied,
// so a lesson that can't be copied leaves the previous files as they were.
// The two working folders have fixed names, so what a crash leaves behind is
// found by name alone: .tutor-adopting/ holds the staged files and
// .tutor-previous/ the old ones while they are moved aside. Adoption runs
// under the factory lock, one at a time, so a fixed name never clashes with a
// live adoption, and the next adoption starts by recovering whatever is left
// in them (recoverLeftovers).
import { access, copyFile, cp, lstat, mkdir, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { COURSE_FILES, FACTORY_FILES } from "../../shared/constants.ts";
import type { Lesson } from "../../shared/model.ts";
import { overlaps, realPath } from "../paths.ts";
import { ownFolder } from "./own-folder.ts";

const README = "README.md";
const OPTIONAL_SPEC_FILES = ["FACTORY.md"];
const FEATURES_DIR = "features";
/** The lesson's names in spec/: the only entries an adoption replaces there. */
const REPLACED_IN_SPEC = new Set([README, ...OPTIONAL_SPEC_FILES, FEATURES_DIR]);
/** The staged files, inside the refreshed folder so the swap is a rename on one filesystem. */
const ADOPTING_DIR = ".tutor-adopting";
/** The previous files while they are moved aside. */
const PREVIOUS_DIR = ".tutor-previous";
/** Staging folders of builds before the fixed names (random suffix, either role). */
const LEGACY_STAGING_PREFIX = ".tutor-staging-";

/** Whether `entry` in a refreshed folder is one of Tutor's working folders rather than part of its files. */
function isWorkingFolder(entry: string): boolean {
  return entry === ADOPTING_DIR || entry === PREVIOUS_DIR || entry.startsWith(LEGACY_STAGING_PREFIX);
}

/** Hooks for tests to act in the middle of spec/'s swap. */
export interface SpecCopyHooks {
  afterMovedAside?: () => Promise<void>;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isMissing(cause: unknown): boolean {
  return (cause as { code?: unknown }).code === "ENOENT";
}

/** Whether anything, a symbolic link included, is at `path`; never follows one. */
async function occupied(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    (cause: unknown) => {
      if (isMissing(cause)) return false;
      throw cause;
    },
  );
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

/** The seed's file name: the codebase folder's (tetris/ → tetris.md), as fetch-iteration names it. */
export function seedFileName(codebaseRoot: string): string {
  return `${basename(codebaseRoot)}.md`;
}

/**
 * Refuses a factory that is its repo's top folder, as factories were before
 * the starter layout: ../seeds would then land outside the student's repo.
 */
async function requireCodebaseFolder(factoryRoot: string): Promise<void> {
  if (await occupied(join(factoryRoot, ".git"))) {
    throw new Error(
      "This factory folder is its repo's top folder (it holds .git), so the sample seed would land in ../seeds, outside the repo. " +
        "Tutor adopts lessons into a factory laid out like capstone-project-starter's: tetris/.factory inside your clone.",
    );
  }
}

interface SeedTarget {
  /** ../seeds, as a real path. */
  dir: string;
  path: string;
  /** The seed's path relative to the factory root: ../seeds/tetris.md. */
  shown: string;
  alreadyThere: boolean;
}

/**
 * Where the seed goes: seeds/ in the codebase folder, the factory's real
 * parent. That folder must be a real one apart from the course, and the seed
 * no symbolic link.
 */
async function seedTarget(factoryRoot: string, courseRoot: string): Promise<SeedTarget> {
  const codebaseRoot = dirname(await realpath(factoryRoot));
  const seedsLabel = `${basename(codebaseRoot)}/${FACTORY_FILES.seedsDir}/`;
  const dir = await ownFolder(codebaseRoot, FACTORY_FILES.seedsDir, seedsLabel);
  if (overlaps(dir, await realPath(courseRoot))) {
    throw new Error(`${seedsLabel} is, or shares a folder with, the course, so Tutor will not write the seed there. Keep the course checkout apart from your repo.`);
  }
  const name = seedFileName(codebaseRoot);
  const path = join(dir, name);
  return { dir, path, shown: `../${FACTORY_FILES.seedsDir}/${name}`, alreadyThere: await seedPresent(path, `${seedsLabel}${name}`) };
}

/** The course's stand-ins/, or null when it has none as a real folder. */
async function courseStandIns(courseRoot: string): Promise<string | null> {
  const path = join(courseRoot, COURSE_FILES.standIns);
  const stats = await lstat(path).catch(() => null);
  return stats?.isDirectory() === true ? path : null;
}

export interface SpecCopyResult {
  /** Paths written, relative to the factory root. */
  written: string[];
  /** The seed's path relative to the factory root (../seeds/tetris.md), or null when the lesson has none. */
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

/** Copies the course's stand-ins/ into `staging`, links as links; the names copied. */
async function stageStandIns(source: string, staging: string): Promise<string[]> {
  await cp(source, staging, { recursive: true, verbatimSymlinks: true });
  return (await readdir(staging)).filter((entry) => !isWorkingFolder(entry));
}

/** A folder being refreshed: where it is, how the student reads its name, and which of its entries give way. */
interface Refreshed {
  dir: string;
  /** Relative to the factory root: "spec" or "stand-ins". */
  shown: string;
  replaces: (entry: string) => boolean;
}

/** A path in a refreshed folder as the student reads it, relative to the factory root. */
function shownPath(folder: Refreshed, ...parts: string[]): string {
  return [folder.shown, ...parts].join("/");
}

/**
 * Puts back what a crashed adoption left in a refreshed folder. Each working
 * folder that is a real folder gives back its entries that the folder is
 * missing (an entry it has is never overwritten), oldest role first: the
 * moved-aside previous files, then legacy staging folders. Then the working
 * folder is removed. One that is anything else (a symbolic link above all) is
 * removed itself and never read or followed. A working folder with an entry
 * that can't be taken back is kept, and the adoption refused.
 */
async function recoverLeftovers(folder: Refreshed): Promise<void> {
  const dir = folder.dir;
  const leftovers = (await readdir(dir)).filter(isWorkingFolder).sort((a, b) => {
    const rank = (name: string) => (name === PREVIOUS_DIR ? 0 : name === ADOPTING_DIR ? 2 : 1);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  for (const leftover of leftovers) {
    const path = join(dir, leftover);
    const stats = await lstat(path);
    if (!stats.isDirectory()) {
      await unlink(path);
      continue;
    }
    // The staged files are copies of course files: never worth restoring.
    if (leftover !== ADOPTING_DIR) {
      for (const entry of await readdir(path)) {
        if (isWorkingFolder(entry)) continue;
        if (await occupied(join(dir, entry))) continue;
        try {
          await rename(join(path, entry), join(dir, entry));
        } catch (cause) {
          throw new Error(
            `An earlier adoption didn't finish and Tutor couldn't put ${shownPath(folder, leftover, entry)} back (${errorText(cause)}). ` +
              `Move what you want to keep from ${shownPath(folder, leftover)}/ into ${shownPath(folder)}/, delete ${shownPath(folder, leftover)}/, then adopt again.`,
            { cause },
          );
        }
      }
    }
    await rm(path, { recursive: true, force: true });
  }
}

/**
 * Replaces the folder's entries that give way with the staged ones. The old
 * files move aside into PREVIOUS_DIR first and come back if moving a new one
 * in fails. They are deleted only once the swap finished or every one of them
 * is back; otherwise they stay where they are and the error says where.
 */
async function swapIn(folder: Refreshed, staging: string, names: string[], hooks: SpecCopyHooks): Promise<void> {
  const dir = folder.dir;
  const previous = join(dir, PREVIOUS_DIR);
  await mkdir(previous);
  const movedAside: string[] = [];
  const movedIn: string[] = [];
  try {
    for (const entry of await readdir(dir)) {
      if (isWorkingFolder(entry) || !folder.replaces(entry)) continue;
      await rename(join(dir, entry), join(previous, entry));
      movedAside.push(entry);
    }
    await hooks.afterMovedAside?.();
    for (const name of names) {
      await rename(join(staging, name), join(dir, name));
      movedIn.push(name);
    }
  } catch (cause) {
    for (const name of movedIn) await rename(join(dir, name), join(staging, name)).catch(() => undefined);
    const stranded: string[] = [];
    for (const entry of movedAside) {
      // Whatever was written in its place meanwhile wins; the old copy stays aside.
      const restored = await occupied(join(dir, entry))
        .then((taken) => (taken ? false : rename(join(previous, entry), join(dir, entry)).then(() => true)))
        .catch(() => false);
      if (!restored) stranded.push(shownPath(folder, PREVIOUS_DIR, entry));
    }
    if (stranded.length > 0) {
      throw new Error(
        `${errorText(cause)}. Tutor couldn't put the previous ${folder.shown}/ files back, so they are kept in ${shownPath(folder, PREVIOUS_DIR)}/: ` +
          `${stranded.join(", ")}. Move them back into ${shownPath(folder)}/ yourself; the next adoption puts back the ones ${shownPath(folder)}/ is missing and then clears ${shownPath(folder, PREVIOUS_DIR)}/.`,
        { cause },
      );
    }
    await rm(previous, { recursive: true, force: true });
    throw cause;
  }
  await rm(previous, { recursive: true, force: true });
}

/**
 * Refreshes `folder` from what `stage` copies into its staging folder,
 * recovering a crashed adoption's leftovers first; the names swapped in.
 */
async function refresh(folder: Refreshed, stage: (staging: string) => Promise<string[]>, hooks: SpecCopyHooks): Promise<string[]> {
  await mkdir(folder.dir, { recursive: true });
  await recoverLeftovers(folder);
  // Stage inside the folder (checked not to be a symbolic link). A plain
  // mkdir fails rather than follow anything that appeared there meanwhile.
  const staging = join(folder.dir, ADOPTING_DIR);
  await mkdir(staging);
  try {
    const names = await stage(staging);
    await swapIn(folder, staging, names, hooks);
    return names;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export interface SpecCopyOptions {
  /** The course checkout, whose stand-ins/ is copied. */
  courseRoot: string;
  hooks?: SpecCopyHooks;
}

export async function copyLessonSpec(factoryRoot: string, lesson: Lesson, { courseRoot, hooks = {} }: SpecCopyOptions): Promise<SpecCopyResult> {
  // Every check first: a refusal writes nothing.
  await requireFeatureFiles(lesson);
  await requireCodebaseFolder(factoryRoot);
  const spec: Refreshed = {
    dir: await ownFolder(factoryRoot, FACTORY_FILES.specDir, `${FACTORY_FILES.specDir}/ in the factory`),
    shown: FACTORY_FILES.specDir,
    replaces: (entry) => REPLACED_IN_SPEC.has(entry),
  };
  const seed = lesson.seedSpec === null ? null : await seedTarget(factoryRoot, courseRoot);
  const standInsSource = await courseStandIns(courseRoot);
  const standIns: Refreshed | null =
    standInsSource === null
      ? null
      : {
          dir: await ownFolder(factoryRoot, FACTORY_FILES.standInsDir, `${FACTORY_FILES.standInsDir}/ in the factory`),
          shown: FACTORY_FILES.standInsDir,
          replaces: () => true,
        };

  const names = await refresh(spec, (staging) => stageLesson(lesson, staging), hooks);
  const written = names.map((name) => (name === FEATURES_DIR ? `${FACTORY_FILES.specDir}/${FEATURES_DIR}/` : `${FACTORY_FILES.specDir}/${name}`));

  if (lesson.seedSpec !== null && seed !== null && !seed.alreadyThere) {
    await mkdir(seed.dir, { recursive: true });
    // "wx" never follows a symbolic link created since the check to write elsewhere.
    await writeFile(seed.path, lesson.seedSpec, { encoding: "utf8", flag: "wx" });
    written.push(seed.shown);
  }

  if (standIns !== null && standInsSource !== null) {
    await refresh(standIns, (staging) => stageStandIns(standInsSource, staging), {});
    written.push(`${FACTORY_FILES.standInsDir}/`);
  }
  return { written, seed: seed?.shown ?? null, seedAlreadyThere: seed?.alreadyThere ?? false };
}
