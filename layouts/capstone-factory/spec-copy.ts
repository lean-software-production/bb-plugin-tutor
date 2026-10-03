// Adopting a lesson's spec on the student's machine, with the same result as
// the starter's fetch-iteration (fetch.sh): spec/README.md, spec/FACTORY.md
// and spec/features/ become the lesson's, leaving anything else in spec/
// alone; the lesson's sample seed is written to <seeds>/<codebase>.md
// (tetris.md: tetris/seeds/ in a starter clone, ../seeds for a factory that is
// its own project; see detect.ts) unless that file is already there; and
// stand-ins/ is refreshed wholesale from the course's. The course's files
// arrive as bundles the server built (server/content/make-bundle.ts), and the
// seed as text. Every check runs before anything is written, so a refusal
// leaves the factory as it was (checkLessonSpec runs them alone, for the
// factory move to go first). adopt.ts writes PROGRESS.yaml and ITERATION last.
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
import { lstat, mkdir, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { validateBundle, writeBundle } from "../../host/bundle.ts";
import type { Bundle } from "../../shared/bundle.ts";
import { FACTORY_FILES } from "../../shared/constants.ts";
import { ownFolder } from "./own-folder.ts";

const README = "README.md";
const OPTIONAL_SPEC_FILES = ["FACTORY.md"];
const FEATURES_DIR = "features";
/** The lesson's names in spec/: the only entries an adoption replaces there. */
const REPLACED_IN_SPEC = new Set([README, ...OPTIONAL_SPEC_FILES, FEATURES_DIR]);

/** Whether a lesson's file, by its path in the lesson's folder, is one an adoption copies into spec/: README.md, FACTORY.md, or under features/. */
export function isLessonSpecPath(path: string): boolean {
  return path === README || OPTIONAL_SPEC_FILES.includes(path) || path.startsWith(`${FEATURES_DIR}/`);
}

/** What an adoption needs to know of the lesson itself: its files come as a bundle. */
export interface AdoptedLesson {
  id: string;
  /** The sample seed's text (the lesson's spec.md), or null when it has none. */
  seedSpec: string | null;
}
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

/** Whether the seed is already there. A symbolic link in its place is refused, dangling or not. */
async function seedPresent(path: string, display: string): Promise<boolean> {
  const stats = await lstat(path).catch(() => null);
  if (stats?.isSymbolicLink()) throw new Error(`${display} is a symbolic link; replace it with the seed file itself.`);
  return stats !== null;
}

/** The bundle's entries an adoption copies into spec/ (isLessonSpecPath); anything else in it is left out. */
function specEntries(spec: Bundle): Bundle {
  return { entries: spec.entries.filter((entry) => isLessonSpecPath(entry.path)) };
}

/**
 * Refuses a lesson with nothing to coach before anything in spec/ is
 * replaced, and a bundle that would write anywhere but inside its folder
 * (host/bundle.ts validateBundle).
 */
function requireLessonFiles(lesson: AdoptedLesson, spec: Bundle, standIns: Bundle | null): void {
  const features = spec.entries.filter((entry) => entry.path.startsWith(`${FEATURES_DIR}/`) && !entry.path.slice(FEATURES_DIR.length + 1).includes("/"));
  if (!features.some((entry) => entry.path.endsWith(".feature"))) {
    throw new Error(`Lesson ${lesson.id} has no feature files, so it cannot be adopted.`);
  }
  validateBundle(spec);
  if (standIns !== null) validateBundle(standIns);
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

/** Where the lesson's sample seed goes (layouts/capstone-factory/detect.ts works it out). */
export interface SeedsLocation {
  /** The seeds folder: tetris/seeds. */
  dir: string;
  /** The codebase folder's name, which names the seed: tetris → tetris.md. */
  codebase: string;
  /** The seeds folder as the student reads it: tetris/seeds, or ../seeds from the factory. */
  shown: string;
}

/** A factory that is its own project: the seeds are ../seeds, beside it in the codebase folder, its real parent. */
async function legacySeeds(factoryRoot: string): Promise<SeedsLocation> {
  const codebaseRoot = dirname(await realpath(factoryRoot));
  return { dir: join(codebaseRoot, FACTORY_FILES.seedsDir), codebase: basename(codebaseRoot), shown: `../${FACTORY_FILES.seedsDir}` };
}

interface SeedTarget {
  /** The seeds folder. */
  dir: string;
  path: string;
  /** The seed's path as the student reads it: tetris/seeds/tetris.md, or ../seeds/tetris.md. */
  shown: string;
  alreadyThere: boolean;
}

/**
 * Where the seed goes. The seeds folder must be a real one, and the seed no
 * symbolic link. (That it is apart from the course, the server checks: the
 * course is on its side.)
 */
async function seedTarget(seeds: SeedsLocation): Promise<SeedTarget> {
  const seedsLabel = `${seeds.codebase}/${basename(seeds.dir)}/`;
  const dir = await ownFolder(dirname(seeds.dir), basename(seeds.dir), seedsLabel);
  const name = `${seeds.codebase}.md`;
  const path = join(dir, name);
  return { dir, path, shown: `${seeds.shown}/${name}`, alreadyThere: await seedPresent(path, `${seedsLabel}${name}`) };
}

export interface SpecCopyResult {
  /** Paths written, as the student reads them: relative to the factory, or to the repo with `factoryShown`. */
  written: string[];
  /** The seed's path as the student reads it (tetris/seeds/tetris.md, ../seeds/tetris.md), or null when the lesson has none. */
  seed: string | null;
  seedAlreadyThere: boolean;
}

/** Writes the lesson's spec bundle into `staging`; the names written, README.md and features/ always among them. */
async function stageLesson(lesson: AdoptedLesson, lessonBundle: Bundle, staging: string): Promise<string[]> {
  const spec = specEntries(lessonBundle);
  if (!spec.entries.some((entry) => entry.path === README)) {
    throw new Error(`Lesson ${lesson.id} has no README.md, so it cannot be adopted.`);
  }
  await writeBundle(staging, spec, { onlyIfAbsent: false });
  const present = new Set(spec.entries.map((entry) => entry.path.split("/")[0] ?? ""));
  return [README, ...OPTIONAL_SPEC_FILES.filter((file) => present.has(file)), FEATURES_DIR];
}

/** Writes the course's stand-ins/ bundle into `staging`, links as links and modes kept; the names written. */
async function stageStandIns(standIns: Bundle, staging: string): Promise<string[]> {
  await writeBundle(staging, standIns, { onlyIfAbsent: false });
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
  /** The lesson's README.md, FACTORY.md and features/ (server/content/make-bundle.ts lessonSpecBundle). */
  spec: Bundle;
  /** The course's stand-ins/, or null when it has none: the factory's stand-ins/ is then left alone. */
  standIns: Bundle | null;
  /** Where the seed goes. Without it, ../seeds beside the factory's real folder, as for a factory that is its own project. */
  seeds?: SeedsLocation;
  /** The factory's folder relative to the repo (factory, tetris/.factory), prefixed to the paths written. */
  factoryShown?: string;
  hooks?: SpecCopyHooks;
}

interface Prepared {
  spec: Refreshed;
  seed: SeedTarget | null;
  standIns: Refreshed | null;
}

/** Every check an adoption makes, before anything is written. */
async function prepare(factoryRoot: string, lesson: AdoptedLesson, options: SpecCopyOptions): Promise<Prepared> {
  requireLessonFiles(lesson, options.spec, options.standIns);
  await requireCodebaseFolder(factoryRoot);
  const spec: Refreshed = {
    dir: await ownFolder(factoryRoot, FACTORY_FILES.specDir, `${FACTORY_FILES.specDir}/ in the factory`),
    shown: FACTORY_FILES.specDir,
    replaces: (entry) => REPLACED_IN_SPEC.has(entry),
  };
  const seed = lesson.seedSpec === null ? null : await seedTarget(options.seeds ?? (await legacySeeds(factoryRoot)));
  const standIns: Refreshed | null =
    options.standIns === null
      ? null
      : {
          dir: await ownFolder(factoryRoot, FACTORY_FILES.standInsDir, `${FACTORY_FILES.standInsDir}/ in the factory`),
          shown: FACTORY_FILES.standInsDir,
          replaces: () => true,
        };
  return { spec, seed, standIns };
}

/** Runs every check copyLessonSpec makes, writing nothing: it throws what copyLessonSpec would refuse with. */
export async function checkLessonSpec(factoryRoot: string, lesson: AdoptedLesson, options: SpecCopyOptions): Promise<void> {
  await prepare(factoryRoot, lesson, options);
}

export async function copyLessonSpec(factoryRoot: string, lesson: AdoptedLesson, options: SpecCopyOptions): Promise<SpecCopyResult> {
  // Every check first: a refusal writes nothing.
  const { spec, seed, standIns } = await prepare(factoryRoot, lesson, options);
  const hooks = options.hooks ?? {};
  const inFactory = (path: string) => (options.factoryShown === undefined ? path : `${options.factoryShown}/${path}`);

  const names = await refresh(spec, (staging) => stageLesson(lesson, options.spec, staging), hooks);
  const written = names.map((name) => inFactory(name === FEATURES_DIR ? `${FACTORY_FILES.specDir}/${FEATURES_DIR}/` : `${FACTORY_FILES.specDir}/${name}`));

  if (lesson.seedSpec !== null && seed !== null && !seed.alreadyThere) {
    await mkdir(seed.dir, { recursive: true });
    // "wx" never follows a symbolic link created since the check to write elsewhere.
    await writeFile(seed.path, lesson.seedSpec, { encoding: "utf8", flag: "wx" });
    written.push(seed.shown);
  }

  const standInsBundle = options.standIns;
  if (standIns !== null && standInsBundle !== null) {
    await refresh(standIns, (staging) => stageStandIns(standInsBundle, staging), {});
    written.push(inFactory(`${FACTORY_FILES.standInsDir}/`));
  }
  return { written, seed: seed?.shown ?? null, seedAlreadyThere: seed?.alreadyThere ?? false };
}
