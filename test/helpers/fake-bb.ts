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
  originPluginId: string | null;
  title: string | null;
  createdAt: number;
  archivedAt: number | null;
  metadata: unknown;
  prompt: string;
}

export interface TutorHost extends FakePluginHost {
  rt: TutorRuntime;
  threads: FakeThread[];
  running: Set<string>;
  sent: { threadId: string; text: string }[];
  /** Adds a thread Tutor did not spawn (or one in another project). */
  addThread(thread: Partial<FakeThread> & { id: string }): FakeThread;
}

interface SpawnArgs {
  projectId: string;
  parentThreadId?: string;
  originPluginId?: string;
  title?: string;
  pluginMetadata?: unknown;
  prompt?: string;
}

export async function makeTutorHost(
  course: Course,
  factoryRoot: string,
  settings: Record<string, string> = { factoryProject: PROJECT_ID },
): Promise<TutorHost> {
  const threads: FakeThread[] = [];
  const running = new Set<string>();
  const sent: { threadId: string; text: string }[] = [];
  let clock = 1000;
  const addThread = (thread: Partial<FakeThread> & { id: string }): FakeThread => {
    const row: FakeThread = {
      projectId: PROJECT_ID,
      parentThreadId: null,
      originPluginId: null,
      title: null,
      createdAt: (clock += 1),
      archivedAt: null,
      metadata: {},
      prompt: "",
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
        get: async ({ threadId }) => find(threadId),
        list: async (args = {}) =>
          threads.filter(
            (thread) =>
              (args.originPluginId === undefined || thread.originPluginId === args.originPluginId) &&
              (args.projectId === undefined || thread.projectId === args.projectId) &&
              (args.archived !== false || thread.archivedAt === null),
          ),
        getPluginMetadata: async ({ threadId }) => find(threadId).metadata,
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
    env: {},
    featureConfigFile: "/nonexistent/tutor/config.json",
    now: () => NOW,
  });
  return { ...host, rt, threads, running, sent, addThread };
}
