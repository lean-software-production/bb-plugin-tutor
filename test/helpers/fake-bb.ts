// A fake BB host for Tutor's backend: createFakePluginHost plus an in-memory
// thread table and one factory project, so spawn/list/get/metadata behave
// like the real server's.
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { SKILL_ID } from "../../shared/constants.ts";
import type { Course } from "../../shared/model.ts";
import { registerTutor } from "../../server/coach/register.ts";
import { createProgressStore } from "../../server/progress/store.ts";
import type { TutorRuntime } from "../../server/coach/runtime.ts";

export const PROJECT_ID = "prj_factory";
export const NOW = new Date("2026-09-25T11:00:00Z");

export interface FakeThread {
  id: string;
  projectId: string;
  parentThreadId: string | null;
  sourceThreadId: string | null;
  lifecycleOwnerThreadId: string | null;
  originKind: "fork" | null;
  originPluginId: string | null;
  visibility: "hidden" | "visible";
  title: string | null;
  titleFallback: string | null;
  createdAt: number;
  archivedAt: number | null;
  metadata: Record<string, unknown>;
  prompt: string;
  /** A fork's agent-only seed. */
  seed: string;
}

export interface FakeTabs {
  revision: number;
  tabs: { id: string; kind: string; [field: string]: unknown }[];
}

export interface TutorHost extends FakePluginHost {
  rt: TutorRuntime;
  threads: FakeThread[];
  running: Set<string>;
  sent: { threadId: string; text: string }[];
  /** Each thread's right-panel tabs, as BB stores them. */
  tabs: Map<string, FakeTabs>;
  /**
   * Tab writes to fail with BB's revision conflict before one succeeds. With
   * `withOurTab`, the other client's write behind the last of those conflicts
   * already carries the tab being written (as when two clients add the same tab).
   */
  tabConflicts: { remaining: number; withOurTab: boolean };
  /**
   * When set, every tab write fails with this message; with `landed`, the
   * write is stored first (as when BB applies it but the reply is lost).
   */
  tabWriteError: { message: string | null; landed: boolean };
  /** When set, forks fail the way BB fails them for a provider that cannot fork. */
  forkRefusal: { message: string | null };
  /** When set, archiving a thread fails with this message. */
  archiveRefusal: { message: string | null };
  /**
   * Runs before each `threads.list` call is answered, so a test can change
   * the threads between pages (as another client archiving one would).
   */
  beforeList: { hook: ((args: { offset?: number; limit?: number }) => void) | null };
  /** Adds a thread Tutor did not spawn (or one in another project). */
  addThread(thread: Partial<FakeThread> & { id: string }): FakeThread;
}

interface SpawnArgs {
  projectId: string;
  parentThreadId?: string;
  originPluginId?: string;
  title?: string;
  pluginMetadata?: Record<string, unknown>;
  prompt?: string;
}

interface ForkArgs {
  sourceThreadId: string;
  lifecycleOwnerThreadId?: string;
  originPluginId?: string;
  visibility?: "hidden" | "visible";
  title?: string;
  pluginMetadata?: Record<string, unknown>;
  agentContextSeed?: { type: string; text?: string }[];
}

/** An error shaped like the SDK's BbHttpError. */
function httpError(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code });
}

export async function makeTutorHost(
  course: Course,
  factoryRoot: string,
  settings: Record<string, string | boolean> = { factoryProject: PROJECT_ID },
  options: { dataDir?: string; env?: Record<string, string>; featureConfigFile?: string } = {},
): Promise<TutorHost> {
  const threads: FakeThread[] = [];
  const running = new Set<string>();
  const sent: { threadId: string; text: string }[] = [];
  const tabs = new Map<string, FakeTabs>();
  const tabConflicts = { remaining: 0, withOurTab: false };
  const tabWriteError: { message: string | null; landed: boolean } = { message: null, landed: false };
  const forkRefusal: { message: string | null } = { message: null };
  const archiveRefusal: { message: string | null } = { message: null };
  const beforeList: TutorHost["beforeList"] = { hook: null };
  let clock = 1000;
  const addThread = (thread: Partial<FakeThread> & { id: string }): FakeThread => {
    const row: FakeThread = {
      projectId: PROJECT_ID,
      parentThreadId: null,
      sourceThreadId: null,
      lifecycleOwnerThreadId: null,
      originKind: null,
      originPluginId: null,
      visibility: "visible",
      title: null,
      titleFallback: null,
      createdAt: (clock += 1),
      archivedAt: null,
      metadata: {},
      prompt: "",
      seed: "",
      ...thread,
    };
    threads.push(row);
    return row;
  };
  const find = (threadId: string) => {
    const thread = threads.find((candidate) => candidate.id === threadId);
    if (thread === undefined) throw new Error(`HTTP 404: thread ${threadId} not found`);
    return thread;
  };
  const project = {
    id: PROJECT_ID,
    name: "my-factory",
    kind: "standard",
    gitRemoteUrl: null,
    createdAt: 1,
    updatedAt: 1,
    sources: [
      { id: "src_1", projectId: PROJECT_ID, hostId: "host_1", type: "local_path", path: factoryRoot, isDefault: true, createdAt: 1, updatedAt: 1 },
    ],
  };

  const host = createFakePluginHost({
    pluginId: "tutor",
    agentSkillIds: [SKILL_ID],
    settings,
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    sdk: {
      projects: {
        get: async ({ projectId }) => {
          if (projectId !== PROJECT_ID) throw new Error(`HTTP 404: project ${projectId} not found`);
          return project;
        },
        list: async () => [project],
      },
      threads: {
        spawn: async (args) => {
          const spawn = args as SpawnArgs;
          // A real spawn is an HTTP round trip; let concurrent callers interleave around it.
          await new Promise((resolve) => setTimeout(resolve, 5));
          return addThread({
            id: `thr_${threads.length + 1}`,
            projectId: spawn.projectId,
            parentThreadId: spawn.parentThreadId ?? null,
            originPluginId: spawn.originPluginId ?? null,
            title: spawn.title ?? null,
            metadata: spawn.pluginMetadata ?? {},
            prompt: spawn.prompt ?? "",
          });
        },
        fork: async (args) => {
          const fork = args as ForkArgs;
          const source = find(fork.sourceThreadId);
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (forkRefusal.message !== null) throw httpError(400, "invalid_request", forkRefusal.message);
          return addThread({
            id: `thr_${threads.length + 1}`,
            projectId: source.projectId,
            sourceThreadId: source.id,
            lifecycleOwnerThreadId: fork.lifecycleOwnerThreadId ?? null,
            originKind: "fork",
            originPluginId: fork.originPluginId ?? null,
            visibility: fork.visibility ?? "visible",
            title: fork.title ?? null,
            metadata: fork.pluginMetadata ?? {},
            seed: (fork.agentContextSeed ?? []).map((part) => part.text ?? "").join(""),
          });
        },
        get: async ({ threadId }) => find(threadId),
        archive: async ({ threadId }) => {
          const thread = find(threadId);
          if (archiveRefusal.message !== null) throw httpError(500, "internal_error", archiveRefusal.message);
          thread.archivedAt = clock += 1;
          return { ok: true, archivedThreadIds: [threadId] };
        },
        // Pages newest first by limit and offset, as bb-app's /threads does:
        // hidden threads only with includeHidden, and hasParent filters on having a parent.
        list: async (args = {}) => {
          beforeList.hook?.(args);
          const offset = args.offset ?? 0;
          return threads
            .filter(
              (thread) =>
                (args.originPluginId === undefined || thread.originPluginId === args.originPluginId) &&
                (args.projectId === undefined || thread.projectId === args.projectId) &&
                (args.sourceThreadId === undefined || thread.sourceThreadId === args.sourceThreadId) &&
                (args.hasParent === undefined || (thread.parentThreadId !== null) === args.hasParent) &&
                (args.includeHidden === true || thread.visibility === "visible") &&
                (args.archived !== false || thread.archivedAt === null),
            )
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(offset, args.limit === undefined ? undefined : offset + args.limit);
        },
        getPluginMetadata: async ({ threadId }) => find(threadId).metadata,
        updatePluginMetadata: async ({ threadId, set = {}, remove = [] }) => {
          const thread = find(threadId);
          thread.metadata = { ...thread.metadata, ...set };
          for (const key of remove) delete thread.metadata[key];
          return thread.metadata;
        },
        tabs: {
          get: async ({ threadId }) => {
            find(threadId);
            return structuredClone(tabs.get(threadId) ?? { revision: 0, tabs: [] });
          },
          update: async ({ threadId, expectedRevision, tabs: next }) => {
            const current = tabs.get(threadId) ?? { revision: 0, tabs: [] };
            if (tabConflicts.remaining > 0) {
              // Another client wrote first: BB's tab strip adds a tab of its own.
              tabConflicts.remaining -= 1;
              const theirs = tabConflicts.withOurTab && tabConflicts.remaining === 0
                ? (structuredClone(next) as FakeTabs["tabs"]).filter((tab) => !current.tabs.some((existing) => existing.id === tab.id))
                : [{ id: `other-${current.revision}`, kind: "new-tab" }];
              tabs.set(threadId, { revision: current.revision + 1, tabs: [...current.tabs, ...theirs] });
              throw httpError(409, "thread_tabs_conflict", "Thread tabs changed on another client");
            }
            if (expectedRevision !== current.revision) throw httpError(409, "thread_tabs_conflict", "Thread tabs changed on another client");
            const stored = { revision: current.revision + 1, tabs: structuredClone(next) as FakeTabs["tabs"] };
            if (tabWriteError.message === null || tabWriteError.landed) tabs.set(threadId, stored);
            if (tabWriteError.message !== null) throw httpError(502, "bad_gateway", tabWriteError.message);
            return stored;
          },
        },
        listRunning: async () => [...running].map((id) => ({ id, hostId: "host_1" })),
        send: async (args) => {
          const block = args.input[0];
          sent.push({ threadId: args.threadId, text: block?.type === "text" ? block.text : "" });
          return { ok: true, delivery: "sent" };
        },
      },
    },
  });
  const rt = await registerTutor(host.bb, {
    courseSource: { loadCourse: async () => course },
    store: createProgressStore(),
    env: options.env ?? {},
    featureConfigFile: options.featureConfigFile ?? "/nonexistent/tutor/config.json",
    now: () => NOW,
  });
  return { ...host, rt, threads, running, sent, tabs, tabConflicts, tabWriteError, forkRefusal, archiveRefusal, beforeList, addThread };
}
