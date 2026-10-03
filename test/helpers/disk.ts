// Temp directories holding a fixture course and a student's starter clone, for
// tests that exercise real file I/O. The layout follows capstone-project-starter:
// the git root is the clone, the codebase is tetris/ and the factory is
// tetris/.factory (factory/ from lesson 004).
//
// makeSandbox is the bare layout that tests aim at the factory folder itself
// (a legacy, v0.1.0-style project); makeRepoSandbox is the starter as it is
// now, with its skills, seeds folder and factory files, optionally a real git
// repo with everything committed, for tests aimed at the repo's top folder.
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { fixtureCourse } from "../../shared/fixtures.ts";
import { FACTORY_FILES } from "../../shared/constants.ts";
import type { Course, ProgressFile } from "../../shared/model.ts";
import { formatProgress } from "../../layouts/progress/progress-yaml.ts";

export interface Sandbox {
  root: string;
  course: Course;
  /** The student's clone: the folder holding .git. */
  repoRoot: string;
  /** The codebase the factory builds: tetris/. */
  codebaseRoot: string;
  /** The factory through lesson 003: tetris/.factory. */
  factoryRoot: string;
  cleanup(): Promise<void>;
}

/** A fixture course (fixtureCourse unless given) with every lesson, and the course's stand-ins/, written to disk under `courseRoot`. */
async function writeCourse(courseRoot: string, source: Course = fixtureCourse): Promise<Course> {
  await mkdir(join(courseRoot, "stand-ins"), { recursive: true });
  await writeFile(join(courseRoot, "stand-ins/README.md"), "# Stand-ins\n");
  await writeFile(join(courseRoot, "stand-ins/plan-alpha-beta"), "#!/bin/sh\necho alpha beta\n");
  await chmod(join(courseRoot, "stand-ins/plan-alpha-beta"), 0o755);
  const lessons = [];
  for (const lesson of source.lessons) {
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
  const coachPath = join(courseRoot, ".agents/coach-me.md");
  await mkdir(join(courseRoot, ".agents"), { recursive: true });
  await writeFile(coachPath, "## Coaching process\nBaby steps, one Rule at a time.\n");
  return { ...source, root: courseRoot, coachPath, lessons };
}

/**
 * fixtureCourse written to disk under a temp course root, beside an empty
 * starter clone: just .git and tetris/.factory.
 */
export async function makeSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "tutor-test-"));
  const repoRoot = join(root, "capstone-project-starter");
  const codebaseRoot = join(repoRoot, "tetris");
  const factoryRoot = join(codebaseRoot, ".factory");
  await mkdir(join(repoRoot, ".git"), { recursive: true });
  await mkdir(factoryRoot, { recursive: true });
  const course = await writeCourse(join(root, "tutorial"));
  return { root, course, repoRoot, codebaseRoot, factoryRoot, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Runs git in `dir` with a fixed identity and none of the user's config, returning its output. */
export function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Student",
      GIT_AUTHOR_EMAIL: "student@example.com",
      GIT_COMMITTER_NAME: "Student",
      GIT_COMMITTER_EMAIL: "student@example.com",
    },
  });
}

export interface RepoSandboxOptions {
  /** The capstone's progress file, tetris/.factory/spec/PROGRESS.yaml, as an older Tutor left it. */
  progress?: Omit<ProgressFile, "examples"> & { examples?: ProgressFile["examples"] };
  /** tetris/.factory/ITERATION's text, without its newline ("001 WIP"). */
  iteration?: string;
  /** A real git repo with the starter committed, instead of an empty .git folder. */
  git?: boolean;
  /** The course to write: fixtureCourse unless given (fixtureCourseTo004 for the factory's move). */
  course?: Course;
}

/**
 * A capstone-project-starter clone as the starter ships it: the skills in
 * .agents/skills (coach-me among them), tetris/seeds/, and tetris/.factory
 * with its AGENTS.md and the .claude/skills link to the skills.
 */
export async function makeRepoSandbox(options: RepoSandboxOptions = {}): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "tutor-test-"));
  const repoRoot = join(root, "capstone-project-starter");
  const codebaseRoot = join(repoRoot, "tetris");
  const factoryRoot = join(codebaseRoot, ".factory");
  await mkdir(join(repoRoot, ".agents/skills/coach-me"), { recursive: true });
  await writeFile(join(repoRoot, ".agents/skills/coach-me/SKILL.md"), "---\nname: coach-me\n---\nWalk the student through their next homework iteration.\n");
  await mkdir(join(codebaseRoot, "seeds"), { recursive: true });
  await writeFile(join(codebaseRoot, "seeds/.gitkeep"), "");
  await mkdir(join(factoryRoot, ".claude"), { recursive: true });
  await writeFile(join(factoryRoot, "AGENTS.md"), "# Agent instructions\n\nSkills, in `.agents/skills/` at the repository's root: **coach-me**.\n");
  await writeFile(join(factoryRoot, "CLAUDE.md"), "@AGENTS.md\n");
  await writeFile(join(factoryRoot, ".gitignore"), "jobs/\n");
  await symlink("../../../.agents/skills", join(factoryRoot, ".claude/skills"));
  if (options.git === true) {
    git(repoRoot, "init", "-q", "-b", "main");
    git(repoRoot, "add", "-A");
    git(repoRoot, "commit", "-q", "-m", "Start from capstone-project-starter");
  } else {
    await mkdir(join(repoRoot, ".git"));
  }
  if (options.progress !== undefined) {
    await mkdir(join(factoryRoot, "spec"), { recursive: true });
    await writeFile(join(factoryRoot, FACTORY_FILES.progress), formatProgress({ examples: {}, ...options.progress }, null));
  }
  if (options.iteration !== undefined) await writeFile(join(factoryRoot, FACTORY_FILES.iteration), `${options.iteration}\n`);
  const course = await writeCourse(join(root, "tutorial"), options.course);
  return { root, course, repoRoot, codebaseRoot, factoryRoot, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** A temp folder holding only an empty git repo: a standalone student's workspace before Tutor adds anything. */
export async function emptyGitWorkspace(): Promise<string> {
  const ws = await mkdtemp(join(tmpdir(), "tutor-ws-"));
  git(ws, "init", "-q", "-b", "main");
  return ws;
}

export interface FixtureCourseRepoOptions {
  /** course.yaml's layout; none unless given. */
  layout?: "capstone-factory";
  /** Give the course a starter repo (tetris/.factory/AGENTS.md and the coach-me skill). */
  starter?: boolean;
  /** The catalog entry's and course's id: "fixture" unless given. */
  id?: string;
  /** course.yaml's own id, when it should differ from the catalog entry's. */
  courseYamlId?: string;
  /** Leave course.yaml out: the repo is not a course Tutor can load. */
  notACourse?: boolean;
}

export interface FixtureCourseRepo {
  /** A courseCatalog setting naming the course by its file:// URL, at its v1 tag. */
  catalogJson: string;
  courseRepo: string;
  starterRepo: string | null;
  /** The course repo's v1 commit. */
  courseSha: string;
  cleanup(): Promise<void>;
}

/**
 * fixtureCourse as a git repo with a course.yaml (its `layout` and `starter`),
 * and, with `starter`, a starter repo it names by file:// URL: both committed
 * and tagged v1. Nothing here touches the network.
 */
export async function makeFixtureCourseRepo(options: FixtureCourseRepoOptions = {}): Promise<FixtureCourseRepo> {
  const id = options.id ?? "fixture";
  const root = await mkdtemp(join(tmpdir(), "tutor-course-repo-"));
  const courseRepo = join(root, "course");
  const course = await writeCourse(courseRepo);
  let starterRepo: string | null = null;
  if (options.starter === true) {
    starterRepo = join(root, "starter");
    await mkdir(join(starterRepo, "tetris/.factory"), { recursive: true });
    await writeFile(join(starterRepo, "tetris/.factory/AGENTS.md"), "# Agent instructions\n\nSkills, in `.agents/skills/` at the repository's root: **coach-me**.\n");
    await mkdir(join(starterRepo, ".agents/skills/coach-me"), { recursive: true });
    await writeFile(join(starterRepo, ".agents/skills/coach-me/SKILL.md"), "---\nname: coach-me\n---\nWalk the student through their next homework iteration.\n");
    // Left out of the seed: a starter's own CI and devcontainer are not the student's.
    await mkdir(join(starterRepo, ".github"), { recursive: true });
    await writeFile(join(starterRepo, ".github/ci.yml"), "on: push\n");
    git(starterRepo, "init", "-q", "-b", "main");
    git(starterRepo, "add", "-A");
    git(starterRepo, "commit", "-q", "-m", "Starter");
    git(starterRepo, "tag", "v1");
  }
  const lessons = course.lessons
    .map((lesson) => `  - id: "${lesson.id}"\n    title: ${JSON.stringify(lesson.title)}\n    dir: ${relative(courseRepo, lesson.dir)}\n`)
    .join("");
  const yaml =
    `id: ${options.courseYamlId ?? id}\n` +
    `title: ${JSON.stringify(course.title)}\n` +
    `description: ${JSON.stringify(course.description ?? "")}\n` +
    (options.layout === undefined ? "" : `layout: ${options.layout}\n`) +
    "coach: .agents/coach-me.md\n" +
    (starterRepo === null ? "" : `starter:\n  repo: ${pathToFileURL(starterRepo).href}\n  ref: v1\n`) +
    `lessons:\n${lessons}`;
  if (options.notACourse !== true) await writeFile(join(courseRepo, "course.yaml"), yaml);
  git(courseRepo, "init", "-q", "-b", "main");
  git(courseRepo, "add", "-A");
  git(courseRepo, "commit", "-q", "-m", "Course");
  git(courseRepo, "tag", "v1");
  const catalog = [{ id, title: course.title, description: course.description ?? "", repo: pathToFileURL(courseRepo).href, ref: "v1" }];
  return {
    catalogJson: JSON.stringify(catalog),
    courseRepo,
    starterRepo,
    courseSha: git(courseRepo, "rev-parse", "HEAD").trim(),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
