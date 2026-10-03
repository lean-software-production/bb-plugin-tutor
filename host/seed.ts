// Seeds a workspace from a course's starter bundle, on the student's
// machine, resumably (Decision 10): writeBundle's `onlyIfAbsent` means a
// file that is already there with the same content counts as done, and a
// file that is there with different content — the student's own — is kept
// and reported, never overwritten. Once every entry has been tried, a
// marker at `<root>/.tutor/seeds/<courseId>.json` records that the seed for
// that `ref` finished. A later call for the same `ref` returns at once,
// `written: []`; a call for a different `ref` means the course moved on, and
// seeds again with `onlyIfAbsent`, so a newer starter never overwrites what
// the student changed. A call interrupted partway (a crash, a dropped
// connection) simply finishes on the next call: files already on disk come
// back as "same". Run under the host lock (host.ts), keyed on the
// workspace's real path, so a seed and an adoption of the same workspace
// never race. A bundle is refused whole, writing nothing, if any entry's
// first path segment is `.git` or `.tutor` (case-insensitive): a starter
// must never write a git hook or a forged seed marker into either.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { validateBundle, writeBundle } from "./bundle.ts";
import type { SeedWorkspaceInput, SeedWorkspaceOutput } from "./contract.ts";

/** Hooks for tests: run after each entry is tried, so a test can interrupt a seed partway. Never reachable through the host contract. */
export interface SeedWorkspaceHooks {
  afterEntry?: (path: string, index: number) => Promise<void>;
}

export interface SeedWorkspaceOptions {
  hooks?: SeedWorkspaceHooks;
}

interface SeedMarker {
  ref: string;
  complete: true;
  at: string;
}

function isMissing(cause: unknown): boolean {
  return (cause as { code?: unknown }).code === "ENOENT";
}

function seedsDir(root: string): string {
  return join(root, ".tutor", "seeds");
}

function markerPath(root: string, courseId: string): string {
  return join(seedsDir(root), `${courseId}.json`);
}

/** The reserved top folders a starter bundle may never write into: Tutor's own `.tutor/` (seed markers, progress) and the student's `.git/` (hooks, config). Compared case-insensitively: macOS filesystems are case-insensitive, so `.TUTOR/x` reaches the same place as `.tutor/x`. */
const RESERVED_TOP_SEGMENTS = new Set([".git", ".tutor"]);

/** Refuses the whole bundle, writing nothing, if any entry's first path segment is `.git` or `.tutor` (case-insensitive): a starter must never write a forged seed marker, a git hook, or anything else into either. */
function refuseReservedPaths(bundle: SeedWorkspaceInput["bundle"]): void {
  for (const entry of bundle.entries) {
    const first = entry.path.split("/")[0] ?? "";
    if (RESERVED_TOP_SEGMENTS.has(first.toLowerCase())) {
      throw new Error(`Bundle entry refused: ${entry.path} writes into ${first}/, which a starter may never write into.`);
    }
  }
}

/** The marker at `path`, or null when there is none, or it is unreadable: the seed simply runs again. */
async function readMarker(path: string): Promise<SeedMarker | null> {
  const text = await readFile(path, "utf8").catch((cause: unknown) => {
    if (isMissing(cause)) return null;
    throw cause;
  });
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as Partial<SeedMarker>;
    if (parsed.complete === true && typeof parsed.ref === "string" && typeof parsed.at === "string") {
      return { ref: parsed.ref, complete: true, at: parsed.at };
    }
  } catch {
    // Falls through: a corrupt marker is treated as none.
  }
  return null;
}

/** Writes `path`'s bytes through a hidden sibling temp file and a rename, so a reader never sees a half-written marker. */
async function writeAtomically(path: string, text: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await writeFile(temp, text, { encoding: "utf8", flag: "wx" });
    await rename(temp, path);
  } catch (cause) {
    await rm(temp, { force: true });
    throw cause;
  }
}

/**
 * Seeds `input.root` from `input.bundle`. Validates the whole bundle before
 * writing a byte of it (a refusal writes nothing, the marker included), then
 * writes each entry with `onlyIfAbsent`, so the student's own changes are
 * kept rather than overwritten, and finally records the marker for
 * `input.ref`. A marker already there for `input.ref` short-circuits the
 * call.
 */
export async function seedWorkspace(input: SeedWorkspaceInput, options: SeedWorkspaceOptions = {}): Promise<SeedWorkspaceOutput> {
  const marker = await readMarker(markerPath(input.root, input.courseId));
  if (marker !== null && marker.ref === input.ref) {
    return { written: [], same: [], kept: [], complete: true };
  }

  validateBundle(input.bundle);
  refuseReservedPaths(input.bundle);

  const written: string[] = [];
  const same: string[] = [];
  const kept: string[] = [];
  const hooks = options.hooks ?? {};
  for (const [index, entry] of input.bundle.entries.entries()) {
    const result = await writeBundle(input.root, { entries: [entry] }, { onlyIfAbsent: true });
    written.push(...result.written);
    same.push(...result.same);
    kept.push(...result.kept);
    await hooks.afterEntry?.(entry.path, index);
  }

  await mkdir(seedsDir(input.root), { recursive: true });
  const marked: SeedMarker = { ref: input.ref, complete: true, at: new Date().toISOString() };
  await writeAtomically(markerPath(input.root, input.courseId), `${JSON.stringify(marked, null, 2)}\n`);

  return { written, same, kept, complete: true };
}
