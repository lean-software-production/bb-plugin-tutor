// The factory's move at lesson 004, as the starter's fetch.sh does it: in a
// capstone-project-starter clone, adopting 004 (or later) while the factory is
// still tetris/.factory runs
//
//   git mv tetris/.factory factory
//   ln -sfn ../../.agents/skills factory/.claude/skills
//   git add factory/.claude/skills
//
// from the repo's top folder, so the factory gets a codebase of its own
// beside tetris/. Tutor does the same on the student's machine (adopt.ts),
// under the host lock, with every check first: the lesson's spec-copy checks,
// factory/ absent, and a dry run of the git mv. Then the move, then the usual
// adoption into factory/. A copy that fails after the move leaves factory/ as
// it was at 003 (ITERATION "003 Done"), and a retry adopts there without
// moving again.
import { execFile } from "node:child_process";
import { lstat, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { STARTER_LAYOUT } from "../../shared/constants.ts";
import type { Layout } from "./detect.ts";

const run = promisify(execFile);

const EARLY = STARTER_LAYOUT.earlyFactory;
const LATE = STARTER_LAYOUT.lateFactory;

/** Whether adopting `lesson` moves the factory: a starter clone, the factory still at tetris/.factory, lesson 004 or later. */
export function needsFactoryMove(layout: Layout, lesson: { id: string; builtin?: boolean }): boolean {
  if (lesson.builtin === true || layout.mode !== "repo" || layout.factoryAt !== "early") return false;
  const number = Number.parseInt(lesson.id, 10);
  return Number.isInteger(number) && number >= STARTER_LAYOUT.moveAtLesson;
}

/** What the move does with factory/.claude/skills. */
export interface FactoryMove {
  /** "link": (re)point it at the repo's skills, as fetch.sh does; "none": the factory has no .claude/; "kept": a real folder or file, left alone. */
  skills: "link" | "none" | "kept";
  /** For the adopt text, when something was left alone. */
  note: string | null;
}

async function git(repo: string, ...args: string[]): Promise<void> {
  await run("git", ["-C", repo, ...args], { encoding: "utf8" });
}

function gitError(cause: unknown): string {
  if (typeof cause === "object" && cause !== null) {
    const { stderr, code } = cause as { stderr?: unknown; code?: unknown };
    if (typeof stderr === "string" && stderr.trim() !== "") return stderr.trim();
    if (code === "ENOENT") return "git is not installed";
  }
  return cause instanceof Error ? cause.message : String(cause);
}

function refusal(reason: string): Error {
  return new Error(`Tutor could not move ${EARLY} to ${LATE}/, as lesson 004 does: ${reason}. Nothing was changed.`);
}

/** Every check the move makes, writing nothing; throws the refusal. */
export async function checkFactoryMove(layout: Layout): Promise<FactoryMove> {
  const repo = layout.repoRoot;
  if (layout.mode !== "repo" || layout.factoryAt !== "early" || repo === null) throw refusal(`the factory is not ${EARLY} in a starter clone`);
  if (layout.blocked !== null) throw refusal(layout.blocked);
  if ((await lstat(join(repo, LATE)).catch(() => null)) !== null) throw refusal(`${LATE}/ already exists`);
  try {
    await git(repo, "mv", "-n", EARLY, LATE);
  } catch (cause) {
    throw refusal(`git mv refused: ${gitError(cause)}`);
  }
  const claude = await lstat(join(layout.factoryDir, ".claude")).catch(() => null);
  if (claude === null || !claude.isDirectory()) return { skills: "none", note: null };
  const skills = await lstat(join(layout.factoryDir, STARTER_LAYOUT.claudeSkillsLink)).catch(() => null);
  if (skills === null || skills.isSymbolicLink()) return { skills: "link", note: null };
  return {
    skills: "kept",
    note:
      `${LATE}/${STARTER_LAYOUT.claudeSkillsLink} is a ${skills.isDirectory() ? "folder" : "file"} of your own, so Tutor left it alone. ` +
      `The starter makes it a link to ${STARTER_LAYOUT.linkTarget}, the repo's skills.`,
  };
}

/** The move itself, once checkFactoryMove has passed: git mv, then the skills link, staged. */
export async function moveFactory(layout: Layout, move: FactoryMove): Promise<void> {
  const repo = layout.repoRoot;
  if (repo === null) throw refusal("there is no repo");
  await git(repo, "mv", EARLY, LATE);
  if (move.skills !== "link") return;
  const link = join(repo, LATE, STARTER_LAYOUT.claudeSkillsLink);
  await unlink(link).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "ENOENT") throw cause;
  });
  await symlink(STARTER_LAYOUT.linkTarget, link);
  await git(repo, "add", `${LATE}/${STARTER_LAYOUT.claudeSkillsLink}`);
}
