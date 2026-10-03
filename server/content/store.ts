// The courses fetched so far, on the server, in BB's data dir:
//
//   <dataDir>/content/<id>/course        the course's clone, at the catalog entry's ref
//   <dataDir>/content/<id>/starter       the starter course.yaml names, at its ref (when it names one)
//   <dataDir>/content/<id>/fetched.json  { ref, at }: written by record(), once both clones are in place and the course loads
//
// `<id>` is the catalog entry's id (catalog.ts), and a fetched course goes by
// it (withCatalogId), whatever its course.yaml or ledger calls itself: the
// store's key, the seed marker, routes and coach threads all agree. Nothing
// here touches the student's workspace (test/no-workspace-io.test.ts
// allowlists this module).
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { COURSE_FILES } from "../../shared/constants.ts";
import type { Course } from "../../shared/model.ts";
import { parseCourseYaml } from "../course/manifest.ts";
import { isFileUrl, type CatalogEntry } from "./catalog.ts";
import { fetchRepo } from "./fetch.ts";

export interface FetchedCourse {
  id: string;
  coursePath: string;
  starterPath: string | null;
  ref: string;
}

export interface ContentStore {
  /** <BB data dir>/content */
  root: string;
  /** Every course fetched so far, in the order it was first fetched. */
  fetched(): Promise<FetchedCourse[]>;
  /**
   * Fetches the course, then the starter its course.yaml names; a clone already at the right ref is kept.
   * Nothing counts as fetched until record() is called.
   */
  fetch(entry: CatalogEntry): Promise<{ coursePath: string; starterPath: string | null }>;
  /** Records the course as fetched (fetched.json), once its clones are in place and it has loaded. */
  record(entry: CatalogEntry, starter: boolean): Promise<void>;
}

/** A fetched course as Tutor knows it: under its catalog entry's id, whatever it calls itself. */
export function withCatalogId(course: Course, id: string): Course {
  return course.id === id ? course : { ...course, id };
}

interface FetchedRecord {
  ref: string;
  /** When the course was first fetched: the order fetched courses follow Lesson 0 in. */
  at: string;
  starter: boolean;
}

const RECORD = "fetched.json";

async function readRecord(dir: string): Promise<FetchedRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, RECORD), "utf8")) as Partial<FetchedRecord>;
    if (typeof parsed.ref !== "string" || typeof parsed.at !== "string") return null;
    return { ref: parsed.ref, at: parsed.at, starter: parsed.starter === true };
  } catch {
    return null;
  }
}

/** The starter the fetched course's course.yaml names, or null (no course.yaml, or no starter in it). */
async function starterOf(coursePath: string): Promise<{ repo: string; ref: string } | null> {
  const path = join(coursePath, COURSE_FILES.manifest);
  const source = await readFile(path, "utf8").catch(() => null);
  if (source === null) return null;
  return parseCourseYaml(source, coursePath, COURSE_FILES.manifest).starter;
}

export function createContentStore(dataDir: string, now: () => Date = () => new Date()): ContentStore {
  const root = join(dataDir, "content");
  const paths = (id: string) => ({ dir: join(root, id), course: join(root, id, "course"), starter: join(root, id, "starter") });
  return {
    root,
    async fetched() {
      const names = await readdir(root, { withFileTypes: true }).catch(() => []);
      const found: (FetchedCourse & { at: string })[] = [];
      for (const name of names) {
        if (!name.isDirectory() || name.name.startsWith(".")) continue;
        const where = paths(name.name);
        const record = await readRecord(where.dir);
        if (record === null) continue;
        found.push({ id: name.name, coursePath: where.course, starterPath: record.starter ? where.starter : null, ref: record.ref, at: record.at });
      }
      found.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
      return found.map(({ at: _at, ...course }) => course);
    },
    async fetch(entry) {
      const where = paths(entry.id);
      // A file:// catalog entry is the operator's own (tests, the end-to-end fixture): only it, and the starter
      // of a course fetched from it, may use file://. A course fetched over https names an https starter.
      const local = isFileUrl(entry.repo);
      await fetchRepo(entry.repo, entry.ref, where.course, { allowFile: local });
      const starter = await starterOf(where.course);
      if (starter !== null && isFileUrl(starter.repo) && !local) {
        throw new Error(`The course "${entry.id}" names a starter at ${starter.repo}, but a course fetched over https:// may only name an https:// starter.`);
      }
      if (starter !== null) await fetchRepo(starter.repo, starter.ref, where.starter, { allowFile: local });
      return { coursePath: where.course, starterPath: starter === null ? null : where.starter };
    },
    async record(entry, starter) {
      const where = paths(entry.id);
      const previous = await readRecord(where.dir);
      const record: FetchedRecord = { ref: entry.ref, at: previous?.at ?? now().toISOString(), starter };
      const temporary = join(where.dir, `.${RECORD}.tmp`);
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
      await rename(temporary, join(where.dir, RECORD));
    },
  };
}
