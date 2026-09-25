// Tutor's coach threads: one coach thread per lesson in the factory project,
// with side chats as hidden forks of it (and, from before side chats, side
// threads as its children). Plugin metadata is used to list and find them,
// and to know a verified coach thread's lesson (auth.ts); it is writable by
// the thread's own agent, so it never decides whether a thread is Tutor's.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { coachThreadTitle } from "../../shared/constants.ts";
import { RULE_KEY_PATTERN } from "../../shared/keys.ts";
import {
  MAX_REACHED_RULES,
  REACHED_RULES_METADATA_KEY,
  coachThreadMetadataSchema,
  type CoachThreadMetadata,
} from "../../shared/model.ts";
import type { TutorThread } from "../../shared/rpc.ts";

type Sdk = BbPluginApi["sdk"];

const LIST_LIMIT = 200;

export interface ThreadRow {
  id: string;
  projectId: string;
  parentThreadId: string | null;
  /** The thread it was forked from; set for side chats. */
  sourceThreadId: string | null;
  originKind: "fork" | null;
  originPluginId: string | null;
  visibility: "hidden" | "visible";
  title: string | null;
  createdAt: number;
  archivedAt: number | null;
}

export interface TutorThreadRecord extends TutorThread {
  courseId: string;
  projectId: string;
  createdAt: number;
  /** Coach threads only: the Rules the coach has focused there, oldest first. */
  reachedRules: string[];
}

/**
 * A thread's place under its lesson, from its structure, which the
 * thread's agent cannot rewrite: a fork (a side chat) or a child (a side
 * thread from before side chats) is a side thread, whatever the metadata
 * claims. A hidden thread that is neither is not Tutor's to list.
 */
export function threadRole(row: Pick<ThreadRow, "parentThreadId" | "sourceThreadId" | "originKind" | "visibility">): TutorThread["role"] | null {
  if (row.parentThreadId !== null) return "sideChat";
  if (row.sourceThreadId !== null || row.originKind === "fork") return row.sourceThreadId === null ? null : "sideChat";
  return row.visibility === "hidden" ? null : "coach";
}

/** The Rule keys in `metadata[REACHED_RULES_METADATA_KEY]`, ignoring anything that is not one. */
export function reachedRulesOf(metadata: unknown): string[] {
  const value =
    typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>)[REACHED_RULES_METADATA_KEY] : undefined;
  if (!Array.isArray(value)) return [];
  const keys = value.filter((key): key is string => typeof key === "string" && RULE_KEY_PATTERN.test(key));
  return [...new Set(keys)].slice(0, MAX_REACHED_RULES);
}

/** The thread as Tutor lists it, or null when its metadata is not Tutor's. */
export function toTutorThread(row: ThreadRow, metadata: unknown): TutorThreadRecord | null {
  const parsed = coachThreadMetadataSchema.safeParse(metadata);
  const role = threadRole(row);
  if (!parsed.success || role === null) return null;
  return {
    id: row.id,
    lessonId: parsed.data.lesson,
    role,
    ruleKey: role === "coach" ? null : (parsed.data.ruleKey ?? null),
    title: row.title,
    coachThreadId: row.parentThreadId ?? row.sourceThreadId ?? row.id,
    fork: row.parentThreadId === null && row.sourceThreadId !== null,
    courseId: parsed.data.course,
    projectId: row.projectId,
    createdAt: row.createdAt,
    reachedRules: role === "coach" ? reachedRulesOf(metadata) : [],
  };
}

/** Live (not archived) Tutor threads in `projectId`, side chats included, newest first. */
export async function listTutorThreads(sdk: Sdk, pluginId: string, projectId: string): Promise<TutorThreadRecord[]> {
  const rows = await sdk.threads.list({
    originPluginId: pluginId,
    projectId,
    archived: false,
    includeHidden: true,
    limit: LIST_LIMIT,
  });
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

/** The lesson's coach thread: the newest one wins. Side chats and side threads never do. */
export function findCoachThread(
  threads: readonly TutorThreadRecord[],
  courseId: string,
  lessonId: string,
): TutorThreadRecord | undefined {
  return threads
    .filter((thread) => thread.role === "coach" && thread.courseId === courseId && thread.lessonId === lessonId)
    .reduce<TutorThreadRecord | undefined>((newest, thread) => (newest === undefined || thread.createdAt > newest.createdAt ? thread : newest), undefined);
}

/**
 * The student's repo itself, so the coach edits the tree Tutor reads
 * spec/PROGRESS.yaml from. Side chats reuse the coach's environment.
 */
function factoryEnvironment(factory: FactoryLocation) {
  return { type: "host", hostId: factory.hostId, workspace: { type: "unmanaged", path: factory.root } } as const;
}

/** The factory repo: every Tutor thread works directly in it, never in a worktree of its own. */
export interface FactoryLocation {
  root: string;
  hostId: string;
}

export interface SpawnCoach {
  projectId: string;
  factory: FactoryLocation;
  courseId: string;
  lessonId: string;
  prompt: string;
}

export async function spawnCoachThread(sdk: Sdk, spawn: SpawnCoach): Promise<string> {
  const pluginMetadata: CoachThreadMetadata = { course: spawn.courseId, lesson: spawn.lessonId, role: "coach" };
  const thread = await sdk.threads.spawn({
    projectId: spawn.projectId,
    environment: factoryEnvironment(spawn.factory),
    title: coachThreadTitle(spawn.lessonId),
    pluginMetadata,
    prompt: spawn.prompt,
  });
  return thread.id;
}

/** Adds `ruleKey` to the coach thread's reached Rules, keeping the ones already there. */
export async function recordReachedRule(sdk: Sdk, threadId: string, ruleKey: string): Promise<void> {
  const metadata = await sdk.threads.getPluginMetadata({ threadId }).catch(() => null);
  const reached = reachedRulesOf(metadata);
  if (reached.includes(ruleKey) || reached.length >= MAX_REACHED_RULES) return;
  await sdk.threads.updatePluginMetadata({ threadId, set: { [REACHED_RULES_METADATA_KEY]: [...reached, ruleKey] } });
}
