// Everything a handler needs, re-derived from disk and BB on each call: the
// workspace and, for each course (Tutor's built-in one first), its layout in
// the workspace (layouts/state.ts) and the student's state. Nothing here
// comes from thread metadata. The workspace is reached only through the
// WorkspaceAccess for its machine.
//
// The courses after Lesson 0 are the configured course when there is one
// (Decision 12), else every course fetched into BB's data dir
// (server/content/store.ts), in the order they were fetched.
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { BUILTIN_COURSE_ID, BUILTIN_LESSON_ID, BUILTIN_PROGRESS, DEFAULT_WORKSPACE_FOLDER, SETTING_KEYS } from "../../shared/constants.ts";
import { resolveCurrent, type CurrentPointer } from "../../shared/derive.ts";
import { slugify } from "../../shared/keys.ts";
import type { Course, ProgressFile, StudentState } from "../../shared/model.ts";
import type { CourseSource, ProgressStore } from "../../shared/ports.ts";
import type { AvailableCourse, Workspace } from "../../shared/rpc.ts";
import { resolveCourseLayout, type CourseLayoutState } from "../../layouts/state.ts";
import { overlaps, realPath } from "../paths.ts";
import { WorkspaceUnreachableError, type WorkspaceAccess } from "../workspace/access.ts";
import { resolveWorkspace, workspaceSetting, type ResolvedWorkspace } from "../workspace/workspace-project.ts";
import { resolveDataDir } from "../activity/heartbeat.ts";
import { catalogFrom, type CatalogEntry } from "../content/catalog.ts";
import { createContentStore, withCatalogId, type FetchedCourse } from "../content/store.ts";
import { resolveCoachMethod, type CoachMethod } from "./coach-file.ts";
import { readFeatureConfig, resolveConfiguredCourse, resolveProjectHint, type Env, type FeatureConfig } from "./course-path.ts";
import type { TutorSettings } from "./settings.ts";

/**
 * The machine to ask about the Feature's project hint while there is no
 * workspace yet: BB's own host, the one the server shares with the Feature
 * (the Codespace). BB gives it no machine provider; a machine enrolled by
 * hand has "manual". A standalone bb-server has none, and the hint is left as
 * it is. Null when there is no such host, or it is not connected.
 */
async function serverHostId(sdk: BbPluginApi["sdk"]): Promise<string | null> {
  const hosts = await sdk.hosts.list().catch(() => []);
  const own = hosts.find((host) => host.machineProviderId === null);
  return own !== undefined && own.status === "connected" ? own.id : null;
}

/** Page loads fire several calls at once; they share one course read. */
const COURSE_TTL_MS = 3000;

export { BUILTIN_COURSE_ID };

/** One course as the workspace has it: its layout there, the student's state in it, and where they are. */
export interface LoadedCourse {
  course: Course;
  layout: CourseLayoutState;
  student: StudentState;
  pointer: CurrentPointer;
  /** The coaching method: the course's own coach file (inlined as text), else the starter's coach-me skill (coach-file.ts). */
  coach: CoachMethod;
}

export interface World {
  /** Where the configured course is: the course checkout the workspace must stay clear of. Null when there is none (Decision 12). */
  coursePath: string | null;
  /** The BB project Tutor coaches in: the student's repo, or (legacy) the factory folder itself. */
  workspace: Workspace;
  /** The machine holding the project's folder; null without a workspace. */
  hostId: string | null;
  /** Every course that loaded, built-in first, workspace or not: what the outline shows before setup. */
  allCourses: Course[];
  /** The catalog of courses that can be fetched (catalog.ts); empty when a configured course wins or the courseCatalog setting is broken. */
  catalog: readonly CatalogEntry[];
  /**
   * Catalog entries offered as "Add the course" (Overview.available): those not fetched yet, and, as "Finish
   * adding the course" (unfinished), fetched ones whose seed is not complete in the workspace or that no longer
   * load. Empty when a configured course wins.
   */
  fetchable: AvailableCourse[];
  /** BB's data dir, which holds fetched content under content/; null when BB cannot say. */
  dataDir: string | null;
  /** The agent provider coach threads are pinned to; empty means BB's default (settings.ts). */
  coachProvider: string;
  /** The model coach threads are pinned to, as provider/model; empty means the agent's default (settings.ts). */
  coachModel: string;
  /** Tutor's built-in course first, then the configured or fetched courses. Empty only while there is no workspace. */
  courses: LoadedCourse[];
  /** Courses that could not be loaded, by id or path, with the reason. */
  courseErrors: { source: string; error: string }[];
  /** Pre-selects a candidate project on first run (resolveProjectHint). */
  projectHint: string | null;
  /** Where the student's Codespace checks out the starter: the workspaceFolder setting, else DEFAULT_WORKSPACE_FOLDER. */
  workspaceFolder: string;
}

export interface WorldDeps {
  courseSource: CourseSource;
  store: ProgressStore;
  env: Env;
  featureConfigFile: string;
  now: () => Date;
  /** How the server reaches the workspace on a machine. */
  access: (hostId: string) => WorkspaceAccess;
  /** Whether a folder exists on the server: for the default course path (Decision 12). The disk unless given. */
  courseExists?: (path: string) => Promise<boolean>;
}

export interface WorldSource {
  load(): Promise<World>;
  /** The courses from the most recent load, for synchronous callers (configure). */
  lastCourses(): readonly LoadedCourse[];
}

/** The loaded course with this id, if any. */
export function findCourse(world: World, courseId: string): LoadedCourse | undefined {
  return world.courses.find((entry) => entry.course.id === courseId);
}

/**
 * The course whose coaching method and factory a coach of `loaded` follows:
 * its own, except that Lesson 0 follows the course after it, as it did when
 * it was part of that course (the capstone's coach-me and its factory).
 */
export function methodCourse(courses: readonly LoadedCourse[], loaded: LoadedCourse): LoadedCourse {
  if (loaded.course.id !== BUILTIN_COURSE_ID) return loaded;
  return courses.find((entry) => entry.course.id !== BUILTIN_COURSE_ID) ?? loaded;
}

/** The built-in course's progress: .tutor/progress.yaml in the workspace, with no ITERATION, whatever layout other courses use. */
export function builtinLayout(workspaceRoot: string): CourseLayoutState {
  return {
    id: null,
    ready: true,
    progress: { dir: join(workspaceRoot, BUILTIN_PROGRESS.dir), progressFile: BUILTIN_PROGRESS.file, iterationFiles: [] },
    problems: [],
    blocked: null,
  };
}

/**
 * Lesson 0 as an older Tutor recorded it, in the capstone's progress file
 * (current, or in its history): read while .tutor/progress.yaml is absent, so
 * a Codespace that did Lesson 0 before keeps it. Writes go to .tutor/progress.yaml.
 */
export function legacyLesson0(capstone: StudentState): ProgressFile | null {
  const current = capstone.progress?.iteration === BUILTIN_LESSON_ID ? capstone.progress : null;
  if (current !== null) {
    const { history: _history, ...rest } = current;
    return rest;
  }
  const past = capstone.progress?.history?.[BUILTIN_LESSON_ID];
  if (past === undefined) return null;
  const progress: ProgressFile = { iteration: BUILTIN_LESSON_ID, examples: past.examples };
  if (past.adopted !== undefined) progress.adopted = past.adopted;
  if (past.summary !== undefined) progress.summary = past.summary;
  return progress;
}

/**
 * Where a layoutless course keeps its files in the workspace: .tutor/courses/<id>.
 * course.yaml's id is any text, so it is slugged: an id like "../x" never leads out of .tutor/courses.
 */
function courseDirOf(course: Course): string {
  return `.tutor/courses/${slugify(course.id)}`;
}

type CourseResult = { course: Course; error: null } | { course: null; error: string };

/** A course after Lesson 0, where it comes from, and (a fetched course with a starter) the seed it waits for. */
interface CourseEntry {
  /** For courseErrors: the configured path, or the fetched course's catalog id. */
  source: string;
  result: Promise<CourseResult>;
  /** The catalog id its seed marker is under (.tutor/seeds/<id>.json); null for a configured course. */
  seedId: string | null;
}

/** Where host/seed.ts records a finished seed, relative to the workspace. */
const SEED_MARKERS_DIR = ".tutor/seeds";

/**
 * Whether the starter of the course fetched as `seedId` is all in the
 * workspace: its marker says complete. Until then the course's lessons wait
 * for the course to be added (again), whatever else the workspace holds.
 */
async function seeded(access: WorkspaceAccess, root: string, seedId: string): Promise<boolean> {
  const marker = await access.read(join(root, SEED_MARKERS_DIR, `${seedId}.json`));
  if (marker === null) return false;
  try {
    return (JSON.parse(marker.text) as { complete?: unknown }).complete === true;
  } catch {
    return false;
  }
}

export function createWorldSource(bb: BbPluginApi, settings: TutorSettings, deps: WorldDeps): WorldSource {
  const cached = new Map<string, { at: number; result: Promise<CourseResult> }>();
  let builtin: Promise<CourseResult> | null = null;
  let last: LoadedCourse[] = [];

  function loadCourse(path: string): Promise<CourseResult> {
    const now = deps.now().getTime();
    const hit = cached.get(path);
    if (hit !== undefined && now - hit.at < COURSE_TTL_MS) return hit.result;
    for (const [key, entry] of cached) if (now - entry.at >= COURSE_TTL_MS) cached.delete(key);
    const result = settle(deps.courseSource.loadCourse(path));
    cached.set(path, { at: now, result });
    return result;
  }

  /** The built-in course ships with the plugin and never changes while it runs; a failed read is tried again next time. */
  function loadBuiltin(): Promise<CourseResult> {
    if (builtin !== null) return builtin;
    const result = settle(deps.courseSource.loadBuiltin());
    builtin = result;
    void result.then((outcome) => {
      if (outcome.course === null && builtin === result) builtin = null;
    });
    return result;
  }

  /** `unseeded`: a fetched course whose starter is not all in the workspace yet. */
  async function readCourse(
    course: Course,
    root: string,
    access: WorkspaceAccess,
    seedId: string | null,
  ): Promise<{ loaded: LoadedCourse; unseeded: boolean }> {
    const resolved = await resolveCourseLayout(course.layout, root, courseDirOf(course), access);
    // A starter not all there yet: the course needs adding (again), in NOT_READY's words, not a missing factory's.
    const unseeded = seedId !== null && course.starter !== null && !(await seeded(access, root, seedId));
    const layout: CourseLayoutState = unseeded ? { ...resolved, ready: false, blocked: null } : resolved;
    const read = await deps.store.read(access, layout.progress);
    const student = layout.problems.length === 0 ? read : { ...read, problems: [...layout.problems, ...read.problems] };
    const coach = await resolveCoachMethod(course.coachPath, layout, root, access);
    return { loaded: { course, layout, student, pointer: resolveCurrent(course, student), coach }, unseeded };
  }

  async function readBuiltin(course: Course, root: string, access: WorkspaceAccess, others: readonly LoadedCourse[]): Promise<LoadedCourse> {
    const layout = builtinLayout(root);
    const read = await deps.store.read(access, layout.progress);
    const capstone = others.find((entry) => entry.layout.id === "capstone-factory");
    const legacy = read.progress === null && read.progressUnreadable !== true && capstone !== undefined ? legacyLesson0(capstone.student) : null;
    const student = legacy === null ? read : { ...read, progress: legacy };
    // The built-in course never has a coach file of its own; methodCourse borrows the next course's.
    return { course, layout, student, pointer: resolveCurrent(course, student), coach: null };
  }

  /**
   * The resolved workspace with its courses read. Re-checked on every load, not
   * just at confirmWorkspace: a project whose folder now leads into the course
   * would have the coach write spec/, stand-ins/ and the seed into the course,
   * so it counts as missing. A machine found offline while it is read makes
   * the workspace unreachable.
   */
  async function readWorkspace(
    resolved: ResolvedWorkspace,
    coursePath: string | null,
    builtin: Course | null,
    others: readonly { course: Course; seedId: string | null }[],
  ): Promise<ResolvedWorkspace & { courses: LoadedCourse[]; unseeded: Set<string> }> {
    const { workspace, hostId } = resolved;
    const unseeded = new Set<string>();
    if (workspace.status !== "found" || hostId === null) return { workspace, hostId, courses: [], unseeded };
    const access = deps.access(hostId);
    try {
      if (coursePath !== null && overlaps(await access.realPath(workspace.root), await realPath(coursePath))) {
        return { workspace: { status: "missing", projectId: workspace.projectId }, hostId: null, courses: [], unseeded };
      }
      const read = await Promise.all(others.map(({ course, seedId }) => readCourse(course, workspace.root, access, seedId)));
      read.forEach((entry, index) => {
        const seedId = others[index]?.seedId ?? null;
        if (entry.unseeded && seedId !== null) unseeded.add(seedId);
      });
      const loaded = read.map((entry) => entry.loaded);
      const courses = builtin === null ? loaded : [await readBuiltin(builtin, workspace.root, access, loaded), ...loaded];
      return { workspace, hostId, courses, unseeded };
    } catch (cause) {
      if (!(cause instanceof WorkspaceUnreachableError)) throw cause;
      return {
        workspace: { status: "unreachable", projectId: workspace.projectId, projectName: workspace.projectName },
        hostId: null,
        courses: [],
        unseeded: new Set(),
      };
    }
  }

  /** The Feature's project hint, probed on the workspace's machine, else on BB's own host; as it is when neither can be asked. */
  async function projectHint(config: FeatureConfig, hostId: string | null): Promise<string | null> {
    const on = hostId ?? (await serverHostId(bb.sdk));
    try {
      return await resolveProjectHint(deps.env, config, on === null ? null : deps.access(on));
    } catch (cause) {
      if (!(cause instanceof WorkspaceUnreachableError)) throw cause;
      return resolveProjectHint(deps.env, config, null);
    }
  }

  return {
    async load(): Promise<World> {
      const values = await settings.get();
      const config = await readFeatureConfig(deps.featureConfigFile);
      // A config this plugin can't read stops Tutor: no course at all, so every RPC and tool refuses with its message.
      const refused: CourseResult | null = config.error === undefined ? null : { course: null, error: config.error };
      const coursePath = refused !== null ? null : await resolveConfiguredCourse(values.coursePath, deps.env, config, deps.courseExists);
      const dataDir = resolveDataDir({ fromBb: () => bb.server.experimental_dataDir, env: deps.env, configDataDir: config.dataDir });
      // A configured course wins (Decision 12): fetched content is ignored, and nothing is offered.
      const standalone = refused === null && coursePath === null;
      const catalog = standalone ? readCatalog(values.courseCatalog) : { entries: [], error: null };
      // Never one under Lesson 0's id: add-course.ts refuses to record one, and an older record is ignored.
      const fetched: FetchedCourse[] =
        standalone && dataDir !== null ? (await createContentStore(dataDir).fetched()).filter((entry) => entry.id !== BUILTIN_COURSE_ID) : [];
      const entries: CourseEntry[] =
        coursePath !== null
          ? [{ source: coursePath, result: loadCourse(coursePath), seedId: null }]
          : fetched.map((entry) => ({ source: entry.id, result: underCatalogId(loadCourse(entry.coursePath), entry.id), seedId: entry.id }));
      const [builtinResult, results, resolved] = await Promise.all([
        refused ?? loadBuiltin(),
        Promise.all(entries.map((entry) => entry.result)),
        resolveWorkspace(bb.sdk, workspaceSetting(values), deps.access),
      ]);
      const others = entries.flatMap((entry, index) => {
        const course = results[index]?.course ?? null;
        return course === null ? [] : [{ course, seedId: entry.seedId }];
      });
      const { workspace, hostId, courses, unseeded } = await readWorkspace(resolved, coursePath, builtinResult.course, others);
      const courseErrors: World["courseErrors"] =
        refused !== null
          ? [{ source: deps.featureConfigFile, error: refused.error }]
          : [
              ...(builtinResult.course === null ? [{ source: BUILTIN_COURSE_ID, error: builtinResult.error }] : []),
              ...entries.flatMap((entry, index) => {
                const result = results[index];
                return result === undefined || result.course !== null ? [] : [{ source: entry.source, error: result.error }];
              }),
              ...(catalog.error === null ? [] : [{ source: SETTING_KEYS.courseCatalog, error: catalog.error }]),
            ];
      const allCourses = [...(builtinResult.course === null ? [] : [builtinResult.course]), ...others.map((entry) => entry.course)];
      const fetchedIds = new Set(fetched.map((entry) => entry.id));
      // Fetched but not finished: its seed is incomplete in this workspace, or it no longer loads. Adding it again finishes it.
      const unfinished = new Set([
        ...unseeded,
        ...fetched.filter((_entry, index) => results[index]?.course === null).map((entry) => entry.id),
      ]);
      last = courses;
      return {
        coursePath,
        workspace,
        hostId,
        allCourses,
        catalog: catalog.entries,
        fetchable: catalog.entries
          .filter((entry) => !fetchedIds.has(entry.id) || unfinished.has(entry.id))
          .map(({ id, title, description }) => ({ id, title, description, unfinished: unfinished.has(id) })),
        dataDir,
        coachProvider: values.coachProvider ?? "",
        coachModel: values.coachModel ?? "",
        courses,
        courseErrors,
        projectHint: await projectHint(config, hostId),
        workspaceFolder: values.workspaceFolder || DEFAULT_WORKSPACE_FOLDER,
      };
    },
    lastCourses: () => last,
  };
}

/** The courseCatalog setting's catalog, or the built-in one; a broken setting offers nothing and says why. */
function readCatalog(setting: string | undefined): { entries: readonly CatalogEntry[]; error: string | null } {
  try {
    return { entries: catalogFrom(setting), error: null };
  } catch (cause) {
    return { entries: [], error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** A fetched course goes by its catalog id, whatever its course.yaml or ledger says (content/store.ts). */
function underCatalogId(result: Promise<CourseResult>, id: string): Promise<CourseResult> {
  return result.then((outcome) => (outcome.course === null ? outcome : { course: withCatalogId(outcome.course, id), error: null }));
}

function settle(load: Promise<Course>): Promise<CourseResult> {
  return load.then(
    (course): CourseResult => ({ course, error: null }),
    (cause: unknown): CourseResult => ({ course: null, error: cause instanceof Error ? cause.message : String(cause) }),
  );
}
