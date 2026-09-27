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
import { join } from "node:path";
import { fixtureCourse } from "../../shared/fixtures.ts";
import type { Course } from "../../shared/model.ts";

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
  return { ...source, root: courseRoot, coachPath: join(courseRoot, ".agents/coach-me.md"), lessons };
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
  const course = await writeCourse(join(root, "tutorial"), options.course);
  return { root, course, repoRoot, codebaseRoot, factoryRoot, cleanup: () => rm(root, { recursive: true, force: true }) };
}
