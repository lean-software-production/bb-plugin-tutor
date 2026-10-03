// Reads a folder on the server into a Bundle (shared/bundle.ts), for the
// host to write onto the student's machine. Only this module, on the server
// side, reads a course checkout's bytes to send across (test/no-workspace-io.test.ts
// allowlists it: it never touches the student's workspace).
import { readdir, readFile, lstat, readlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { isLessonSpecPath } from "../../layouts/capstone-factory/spec-copy.ts";
import { COURSE_FILES } from "../../shared/constants.ts";
import { bundleBytes, MAX_BUNDLE_BYTES, type Bundle, type BundleEntry } from "../../shared/bundle.ts";

export interface BundleFolderOptions {
  /** Top-level entries of `dir` left out of the bundle. */
  skip?: readonly string[];
  /** Prefixed to every entry's path, joined with "/" (e.g. a sub-folder's name when flattening several folders into one bundle). */
  prefix?: string;
}

/** The executable flag: any of the x bits set. */
function isExecutable(mode: number): boolean {
  return (mode & 0o111) !== 0;
}

/** Every file and link under `dir`, relative to it; `skip` names top-level entries left out. Throws past MAX_BUNDLE_BYTES. */
export async function bundleFolder(dir: string, options: BundleFolderOptions = {}): Promise<Bundle> {
  const skip = new Set(options.skip ?? []);
  const entries: BundleEntry[] = [];

  async function visit(current: string, atTop: boolean): Promise<void> {
    const names = await readdir(current, { withFileTypes: true });
    for (const name of names) {
      if (atTop && skip.has(name.name)) continue;
      const absolute = join(current, name.name);
      const rel = relative(dir, absolute);
      const path = options.prefix === undefined ? rel : `${options.prefix}/${rel}`;
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink()) {
        const target = await readlink(absolute);
        entries.push({ kind: "symlink", path, target });
      } else if (stats.isDirectory()) {
        await visit(absolute, false);
      } else if (stats.isFile()) {
        const data = await readFile(absolute);
        entries.push({ kind: "file", path, executable: isExecutable(stats.mode), base64: data.toString("base64") });
      }
      // Anything else (a socket, a FIFO) is left out: a course checkout never has one deliberately.
    }
  }

  await visit(dir, true);
  const bundle: Bundle = { entries };
  const size = bundleBytes(bundle);
  if (size > MAX_BUNDLE_BYTES) {
    throw new Error(`${dir} encodes to ${size} bytes, over the ${MAX_BUNDLE_BYTES}-byte bundle limit.`);
  }
  return bundle;
}

/**
 * What an adoption copies of a lesson into spec/: its README.md, FACTORY.md
 * and features/, as fetch-iteration copies them. The seed (spec.md) travels
 * as text, and nothing else in the lesson's folder is sent.
 */
export async function lessonSpecBundle(lessonDir: string): Promise<Bundle> {
  const bundle = await bundleFolder(lessonDir, { skip: ["spec.md"] });
  return { entries: bundle.entries.filter((entry) => isLessonSpecPath(entry.path)) };
}

/** The course's stand-ins/, or null when it has none as a real folder (the factory's stand-ins/ is then left alone). */
export async function standInsBundle(courseRoot: string): Promise<Bundle | null> {
  const dir = join(courseRoot, COURSE_FILES.standIns);
  const stats = await lstat(dir).catch(() => null);
  return stats?.isDirectory() === true ? bundleFolder(dir) : null;
}

/**
 * Why an adoption is too big to send in one host call, or null. The spec,
 * stand-ins and seed are each capped by bundleFolder, but they travel
 * together, under the 32 MiB host-call limit, so their sum is capped at
 * `limit` too (MAX_BUNDLE_BYTES, leaving room for the rest of the call).
 */
export function adoptionSizeError(
  lessonId: string,
  parts: { spec: Bundle; standIns: Bundle | null; seedSpec: string | null },
  limit: number = MAX_BUNDLE_BYTES,
): string | null {
  const size =
    bundleBytes(parts.spec) +
    (parts.standIns === null ? 0 : bundleBytes(parts.standIns)) +
    (parts.seedSpec === null ? 0 : Buffer.byteLength(JSON.stringify(parts.seedSpec), "utf8"));
  if (size <= limit) return null;
  return `Lesson ${lessonId}'s spec, stand-ins and seed come to ${size} bytes together, over the ${limit} bytes Tutor can send to your machine in one go. The course is too big for this version of Tutor.`;
}
