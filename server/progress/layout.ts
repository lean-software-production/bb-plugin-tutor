// Where the student's factory, codebase and seeds are, worked out from the
// BB project's folder on every read.
//
// Repo mode: the project is a capstone-project-starter clone (its folder
// holds the factory folder, or .git). The factory is factory/ once lesson 004
// moved it there, else tetris/.factory; the seeds are always tetris/seeds.
// The project's folder never moves, so the coach threads spawned there stay
// valid when the factory does.
//
// Legacy mode: the project's folder is the factory itself, as Tutor v0.1.0
// set up tetris/.factory, or a factory repo of its own. The codebase is the
// factory's parent and the seeds ../seeds, as before.
import { lstat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { FACTORY_FILES, STARTER_LAYOUT } from "../../shared/constants.ts";
import { realPath } from "../paths.ts";
import { ITERATION_FILES } from "./iteration.ts";

export type LayoutMode = "repo" | "legacy";

export interface Layout {
  mode: LayoutMode;
  /** The BB project's folder: coach threads spawn here, and the factory lock is keyed on it. */
  projectRoot: string;
  /** The folder holding .git: the project's folder in repo mode; the nearest above the factory in legacy mode, or null. */
  repoRoot: string | null;
  /** The factory's folder: every file Tutor reads and writes (ITERATION, spec/, stand-ins/) is under it. */
  factoryDir: string;
  /** Repo mode: which of the starter's two factory folders it is. Null in legacy mode. */
  factoryAt: "early" | "late" | null;
  /** The factory's folder as the student reads it: relative to the repo in repo mode, else its full path. */
  factoryShown: string;
  /** The codebase the factory builds: tetris/. */
  codebaseDir: string;
  /** The codebase folder's name, which names the seed (tetris.md). */
  codebase: string;
  seedsDir: string;
  /** The seeds folder as the student reads it: tetris/seeds in repo mode, ../seeds (from the factory) in legacy mode. */
  seedsShown: string;
  /** The starter's skills (.agents/skills) at the repo's top folder, or null without a repo. */
  skillsDir: string | null;
  /** What is odd about the layout, for tutor_status. */
  problems: string[];
  /** Set when Tutor must not write into the factory: why. */
  blocked: string | null;
}

type Kind = "folder" | "link" | "file" | "none";

async function kindOf(path: string): Promise<Kind> {
  const stats = await lstat(path).catch(() => null);
  if (stats === null) return "none";
  if (stats.isSymbolicLink()) return "link";
  return stats.isDirectory() ? "folder" : "file";
}

async function occupied(path: string): Promise<boolean> {
  return (await kindOf(path)) !== "none";
}

/** Whether `folder` is a factory itself: it holds ITERATION (either place), spec/PROGRESS.yaml or AGENTS.md. */
async function looksLikeFactory(folder: string): Promise<boolean> {
  for (const file of [...ITERATION_FILES, FACTORY_FILES.progress, FACTORY_FILES.agents]) {
    if (await occupied(join(folder, file))) return true;
  }
  return false;
}

/** The nearest folder at or above `from` that holds .git, or null. */
export async function findRepoRoot(from: string): Promise<string | null> {
  for (let dir = from; ; dir = dirname(dir)) {
    if (await occupied(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

function notAFolder(kind: Kind, name: string): string {
  return kind === "link"
    ? `${name} is a symbolic link, so Tutor will not use it as the factory. Make it a real folder.`
    : `${name} is a file, not a folder, so Tutor will not use it as the factory. Move it aside.`;
}

function repoLayout(root: string, factoryAt: "early" | "late", problems: string[], blocked: string | null): Layout {
  const factoryShown = factoryAt === "late" ? STARTER_LAYOUT.lateFactory : STARTER_LAYOUT.earlyFactory;
  const codebaseDir = join(root, STARTER_LAYOUT.codebase);
  return {
    mode: "repo",
    projectRoot: root,
    repoRoot: root,
    factoryDir: join(root, factoryShown),
    factoryAt,
    factoryShown,
    codebaseDir,
    codebase: STARTER_LAYOUT.codebase,
    seedsDir: join(codebaseDir, FACTORY_FILES.seedsDir),
    seedsShown: `${STARTER_LAYOUT.codebase}/${FACTORY_FILES.seedsDir}`,
    skillsDir: join(root, STARTER_LAYOUT.skillsDir),
    problems,
    blocked,
  };
}

export async function resolveLayout(projectRoot: string): Promise<Layout> {
  const late = await kindOf(join(projectRoot, STARTER_LAYOUT.lateFactory));
  const early = await kindOf(join(projectRoot, STARTER_LAYOUT.earlyFactory));
  const repoMode =
    late !== "none" ||
    early !== "none" ||
    ((await occupied(join(projectRoot, ".git"))) && !(await looksLikeFactory(projectRoot)));
  if (repoMode) {
    const lateName = `${STARTER_LAYOUT.lateFactory}/`;
    const earlyName = `${STARTER_LAYOUT.earlyFactory}/`;
    if (late === "folder") {
      const problems =
        early === "none"
          ? []
          : [`Both ${lateName} and ${STARTER_LAYOUT.earlyFactory} exist; Tutor uses ${lateName}, where the factory lives from lesson 004. Move anything you still need out of ${earlyName} and delete it.`];
      return repoLayout(projectRoot, "late", problems, null);
    }
    if (late !== "none") {
      const problem = notAFolder(late, STARTER_LAYOUT.lateFactory);
      return repoLayout(projectRoot, "early", [problem], problem);
    }
    if (early === "folder") return repoLayout(projectRoot, "early", [], null);
    if (early !== "none") {
      const problem = notAFolder(early, STARTER_LAYOUT.earlyFactory);
      return repoLayout(projectRoot, "early", [problem], problem);
    }
    const problem =
      `This repo has no factory folder: neither ${earlyName}, where it is through lesson 003, nor ${lateName}, where it is from 004. ` +
      "Restore it from git, or pick the clone of capstone-project-starter you build your factory in.";
    return repoLayout(projectRoot, "early", [problem], problem);
  }
  const real = await realPath(projectRoot);
  const codebaseDir = dirname(real);
  const repoRoot = await findRepoRoot(real);
  return {
    mode: "legacy",
    projectRoot,
    repoRoot,
    factoryDir: projectRoot,
    factoryAt: null,
    factoryShown: projectRoot,
    codebaseDir,
    codebase: basename(codebaseDir),
    seedsDir: join(codebaseDir, FACTORY_FILES.seedsDir),
    seedsShown: `../${FACTORY_FILES.seedsDir}`,
    skillsDir: repoRoot === null ? null : join(repoRoot, STARTER_LAYOUT.skillsDir),
    problems: [],
    blocked: null,
  };
}
