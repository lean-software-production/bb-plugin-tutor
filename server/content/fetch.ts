// Fetches a course's content on the server (Decision 15): a shallow git clone
// of a tag, or `git init` plus a shallow fetch of a full SHA, into BB's data
// dir. git runs through execFile, never a shell, and never prompts for a
// password (GIT_TERMINAL_PROMPT=0). Every git call is pinned to https://
// (protocol.allow=never, protocol.https.allow=always); file:// is let through
// only when the caller says the URL is one it trusts (a file:// catalog entry,
// or the starter of a course fetched from one: store.ts). A clone lands in a sibling folder first
// and is renamed into place, so `dest` is either the old clone or the new one.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { FETCHABLE_URL, isFileUrl, PINNED_REF } from "./catalog.ts";

const run = promisify(execFile);

/** A fetch of the tutorial over a slow link; nothing waits on a prompt (GIT_TERMINAL_PROMPT=0). */
const GIT_TIMEOUT_MS = 300_000;

const SHA = /^[0-9a-f]{40}$/;

/** The transports one git call may use: https always, file only when allowed. */
function transports(allowFile: boolean): string[] {
  return ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", ...(allowFile ? ["-c", "protocol.file.allow=always"] : [])];
}

async function git(args: readonly string[], cwd?: string, allowFile = false): Promise<string> {
  const { stdout } = await run("git", [...transports(allowFile), "-c", "advice.detachedHead=false", ...args], {
    ...(cwd === undefined ? {} : { cwd }),
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/** The commit `ref` names in the clone at `dir`, or null when it names none there. */
async function commitOf(dir: string, ref: string): Promise<string | null> {
  const name = SHA.test(ref) ? ref : `refs/tags/${ref}`;
  return git(["rev-parse", "--verify", "--quiet", `${name}^{commit}`], dir).catch(() => null);
}

/** Whether `dest` already holds a clone checked out at `ref`. Reads only: the clone is left as it is. */
async function hasClone(dest: string, ref: string): Promise<boolean> {
  if ((await stat(join(dest, ".git")).catch(() => null)) === null) return false;
  const head = await git(["rev-parse", "--verify", "--quiet", "HEAD"], dest).catch(() => null);
  return head !== null && head === (await commitOf(dest, ref));
}

function describe(cause: unknown): string {
  const stderr = (cause as { stderr?: unknown }).stderr;
  const detail = typeof stderr === "string" && stderr.trim() !== "" ? stderr.trim() : cause instanceof Error ? cause.message : String(cause);
  return detail.split("\n").slice(-3).join(" ");
}

export interface FetchRepoOptions {
  /** Let git use file://: only for a file:// catalog entry, or the starter of a course fetched from one. */
  allowFile?: boolean;
}

/** Clones `repo` at `ref` into `dest` (shallow); an existing clone at the same ref is kept. */
export async function fetchRepo(repo: string, ref: string, dest: string, options: FetchRepoOptions = {}): Promise<void> {
  if (!PINNED_REF.test(ref)) throw new Error(`Tutor fetches a tag or a full SHA, not "${ref}".`);
  if (!FETCHABLE_URL.test(repo)) throw new Error(`Tutor fetches only https:// repositories, not "${repo}".`);
  const allowFile = options.allowFile === true && isFileUrl(repo);
  if (isFileUrl(repo) && !allowFile) throw new Error(`Tutor fetches only https:// repositories here, not "${repo}".`);
  if (await hasClone(dest, ref)) return;
  await mkdir(dirname(dest), { recursive: true });
  const fresh = join(dirname(dest), `.${basename(dest)}.${randomBytes(6).toString("hex")}`);
  try {
    if (SHA.test(ref)) {
      await mkdir(fresh);
      await git(["init", "--quiet"], fresh);
      await git(["remote", "add", "origin", repo], fresh);
      await git(["fetch", "--quiet", "--depth", "1", "origin", ref], fresh, allowFile);
      await git(["checkout", "--quiet", "FETCH_HEAD"], fresh);
    } else {
      await git(["clone", "--quiet", "--depth", "1", "--branch", ref, "--", repo, fresh], undefined, allowFile);
    }
  } catch (cause) {
    await rm(fresh, { recursive: true, force: true });
    throw new Error(`Could not fetch ${repo} at ${ref}: ${describe(cause)}`);
  }
  await rm(dest, { recursive: true, force: true });
  await rename(fresh, dest);
}
