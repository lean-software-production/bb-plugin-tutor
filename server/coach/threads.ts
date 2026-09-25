// Tutor's coach threads: one main thread per homework in the factory project,
// side threads as its children. Plugin metadata is used to list and find them
// only; it is writable by the thread's own agent, so it never authorises.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { coachThreadTitle } from "../../shared/constants.ts";
import { coachThreadMetadataSchema, type CoachThreadMetadata } from "../../shared/model.ts";
import type { TutorThread } from "../../shared/rpc.ts";

type Sdk = BbPluginApi["sdk"];

const LIST_LIMIT = 200;

export interface ThreadRow {
  id: string;
  projectId: string;
  parentThreadId: string | null;
  originPluginId: string | null;
  title: string | null;
  createdAt: number;
  archivedAt: number | null;
}

export interface TutorThreadRecord extends TutorThread {
  courseId: string;
  projectId: string;
  createdAt: number;
}

/**
 * The thread as Tutor lists it, or null when its metadata is not Tutor's.
 * The role comes from the thread's structure (side threads have a parent),
 * which the thread's agent cannot rewrite.
 */
export function toTutorThread(row: ThreadRow, metadata: unknown): TutorThreadRecord | null {
  const parsed = coachThreadMetadataSchema.safeParse(metadata);
  if (!parsed.success) return null;
  const role = row.parentThreadId === null ? "main" : "side";
  return {
    id: row.id,
    homeworkId: parsed.data.iteration,
    role,
    ruleKey: role === "side" ? (parsed.data.ruleKey ?? null) : null,
    title: row.title,
    courseId: parsed.data.course,
    projectId: row.projectId,
    createdAt: row.createdAt,
  };
}

/** Live (not archived) Tutor threads in `projectId`, newest first. */
export async function listTutorThreads(sdk: Sdk, pluginId: string, projectId: string): Promise<TutorThreadRecord[]> {
  const rows = await sdk.threads.list({ originPluginId: pluginId, projectId, archived: false, limit: LIST_LIMIT });
  const mine = rows.filter(
    (row) => row.originPluginId === pluginId && row.projectId === projectId && row.archivedAt === null,
  );
  const records = await Promise.all(
    mine.map(async (row) => {
      const metadata = await sdk.threads.getPluginMetadata({ threadId: row.id }).catch(() => null);
      return toTutorThread(row, metadata);
    }),
  );
  return records.filter((record) => record !== null).sort((a, b) => b.createdAt - a.createdAt);
}

/** The homework's main coach thread: the newest one wins. */
export function findMainThread(
  threads: readonly TutorThreadRecord[],
  courseId: string,
  homeworkId: string,
): TutorThreadRecord | undefined {
  return threads
    .filter((thread) => thread.role === "main" && thread.courseId === courseId && thread.homeworkId === homeworkId)
    .reduce<TutorThreadRecord | undefined>((newest, thread) => (newest === undefined || thread.createdAt > newest.createdAt ? thread : newest), undefined);
}

/**
 * The student's repo itself, so the coach edits the tree Tutor reads
 * spec/PROGRESS.yaml from, and side threads share it with the main thread.
 */
function factoryEnvironment(factory: FactoryLocation) {
  return { type: "host", hostId: factory.hostId, workspace: { type: "unmanaged", path: factory.root } } as const;
}

/** The factory repo: every Tutor thread works directly in it, never in a worktree of its own. */
export interface FactoryLocation {
  root: string;
  hostId: string;
}

export interface SpawnMain {
  projectId: string;
  factory: FactoryLocation;
  courseId: string;
  homeworkId: string;
  prompt: string;
}

export async function spawnMainThread(sdk: Sdk, spawn: SpawnMain): Promise<string> {
  const pluginMetadata: CoachThreadMetadata = { course: spawn.courseId, iteration: spawn.homeworkId, role: "main" };
  const thread = await sdk.threads.spawn({
    projectId: spawn.projectId,
    environment: factoryEnvironment(spawn.factory),
    title: coachThreadTitle(spawn.homeworkId),
    pluginMetadata,
    prompt: spawn.prompt,
  });
  return thread.id;
}

export interface SpawnSide extends SpawnMain {
  parentThreadId: string;
  ruleKey: string | null;
  title: string;
}

export async function spawnSideThread(sdk: Sdk, spawn: SpawnSide): Promise<string> {
  const pluginMetadata: CoachThreadMetadata = { course: spawn.courseId, iteration: spawn.homeworkId, role: "side" };
  if (spawn.ruleKey !== null) pluginMetadata.ruleKey = spawn.ruleKey;
  const thread = await sdk.threads.spawn({
    projectId: spawn.projectId,
    parentThreadId: spawn.parentThreadId,
    environment: factoryEnvironment(spawn.factory),
    title: spawn.title,
    pluginMetadata,
    prompt: spawn.prompt,
  });
  return thread.id;
}
