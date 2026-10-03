// Writes a validated Bundle (shared/bundle.ts) onto the student's machine,
// under a folder BB's host daemon already resolved. Every entry is checked
// — paths, link targets, duplicates, and that no entry's path runs through a
// symbolic link already in the target or created by another entry — before
// anything is written: a refusal writes nothing.
import { lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Bundle, BundleEntry } from "../shared/bundle.ts";
import { escapingLink, unsafePath } from "../shared/bundle.ts";

export interface WriteBundleOptions {
  /** Skip an entry whose file already exists with the same bytes ("same"); keep a different one untouched ("kept"), rather than overwrite it. */
  onlyIfAbsent: boolean;
}

export interface WriteBundleResult {
  written: string[];
  same: string[];
  kept: string[];
}

function isMissing(cause: unknown): boolean {
  return (cause as { code?: unknown }).code === "ENOENT";
}

/** The entry's every proper parent segment ("a/b/c" -> "a", "a/b"), shallowest first. */
function parentsOf(path: string): string[] {
  const segments = path.split("/");
  const parents: string[] = [];
  for (let end = 1; end < segments.length; end += 1) parents.push(segments.slice(0, end).join("/"));
  return parents;
}

/** Validates every entry before anything is written: safe paths, links staying inside, no duplicate paths, and no entry's path running through another entry (a file or a symbolic link, neither of which can also be a folder). */
function validate(bundle: Bundle): void {
  const seen = new Set<string>();
  for (const entry of bundle.entries) {
    const badPath = unsafePath(entry.path);
    if (badPath !== null) throw new Error(`Bundle entry refused: ${badPath}.`);
    if (seen.has(entry.path)) throw new Error(`Bundle entry refused: ${entry.path} appears more than once.`);
    seen.add(entry.path);
    if (entry.kind === "symlink") {
      const badLink = escapingLink(entry.path, entry.target);
      if (badLink !== null) throw new Error(`Bundle entry refused: ${badLink}.`);
    }
  }
  // Every entry is a file or a link, never a folder, so none of them can also
  // be a parent segment of another entry's path.
  for (const entry of bundle.entries) {
    for (const parent of parentsOf(entry.path)) {
      if (seen.has(parent)) {
        throw new Error(`Bundle entry refused: ${entry.path} runs through ${parent}, which the bundle itself writes as a file or a symbolic link, not a folder.`);
      }
    }
  }
}

/** Whether `path`, or any of its parent segments down to and including `root`, is a symbolic link already on disk. Never follows one. */
async function hasLinkInPath(root: string, relativePath: string): Promise<string | null> {
  for (const parent of parentsOf(relativePath)) {
    const stats = await lstat(join(root, parent)).catch((cause) => {
      if (isMissing(cause)) return null;
      throw cause;
    });
    if (stats?.isSymbolicLink() === true) return parent;
  }
  return null;
}

function isExists(cause: unknown): boolean {
  return (cause as { code?: unknown }).code === "EEXIST";
}

async function sameBytes(path: string, data: Buffer): Promise<boolean> {
  const existing = await readFile(path).catch((cause) => {
    if (isMissing(cause)) return null;
    throw cause;
  });
  return existing !== null && existing.equals(data);
}

async function writeOneFile(root: string, entry: Extract<BundleEntry, { kind: "file" }>, onlyIfAbsent: boolean): Promise<"written" | "same" | "kept"> {
  const absolute = join(root, entry.path);
  await mkdir(dirname(absolute), { recursive: true });
  const data = Buffer.from(entry.base64, "base64");
  const mode = entry.executable ? 0o755 : 0o644;
  // The leaf itself, never followed: "w" opens whatever a symbolic link
  // there points at, so a link in the way is removed and replaced rather
  // than written through.
  const leaf = await lstat(absolute).catch((cause) => {
    if (isMissing(cause)) return null;
    throw cause;
  });
  if (leaf?.isSymbolicLink() === true) {
    if (onlyIfAbsent) return "kept";
    await rm(absolute, { force: true });
    await writeFile(absolute, data, { flag: "wx", mode });
    return "written";
  }
  try {
    await writeFile(absolute, data, { flag: onlyIfAbsent ? "wx" : "w", mode });
    return "written";
  } catch (cause) {
    if (!onlyIfAbsent || !isExists(cause)) throw cause;
    return (await sameBytes(absolute, data)) ? "same" : "kept";
  }
}

async function writeOneLink(root: string, entry: Extract<BundleEntry, { kind: "symlink" }>, onlyIfAbsent: boolean): Promise<"written" | "same" | "kept"> {
  const absolute = join(root, entry.path);
  await mkdir(dirname(absolute), { recursive: true });
  try {
    await symlink(entry.target, absolute);
    return "written";
  } catch (cause) {
    if (!isExists(cause)) throw cause;
    const current = await readlink(absolute).catch(() => null);
    if (current === entry.target) return "same";
    if (onlyIfAbsent) return "kept";
    await rm(absolute, { force: true });
    await symlink(entry.target, absolute);
    return "written";
  }
}

/** Validates every entry (unsafePath, escapingLink, no duplicate paths), then writes them under `target`, which must be a real folder. */
export async function writeBundle(target: string, bundle: Bundle, options: WriteBundleOptions): Promise<WriteBundleResult> {
  const targetStats = await lstat(target).catch((cause) => {
    if (isMissing(cause)) throw new Error(`${target} does not exist, so Tutor cannot write the bundle there.`);
    throw cause;
  });
  if (!targetStats.isDirectory()) throw new Error(`${target} is not a real folder, so Tutor cannot write the bundle there.`);

  validate(bundle);

  // No entry's path may run through a symbolic link already on disk.
  for (const entry of bundle.entries) {
    const through = await hasLinkInPath(target, entry.path);
    if (through !== null) {
      throw new Error(`Bundle entry refused: ${entry.path} runs through ${through}, already a symbolic link in ${target}.`);
    }
  }

  const written: string[] = [];
  const same: string[] = [];
  const kept: string[] = [];
  for (const entry of bundle.entries) {
    const outcome =
      entry.kind === "file" ? await writeOneFile(target, entry, options.onlyIfAbsent) : await writeOneLink(target, entry, options.onlyIfAbsent);
    if (outcome === "written") written.push(entry.path);
    else if (outcome === "same") same.push(entry.path);
    else kept.push(entry.path);
  }
  return { written, same, kept };
}
