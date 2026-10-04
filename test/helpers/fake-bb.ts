// A fake BB host for Tutor's backend: createFakePluginHost plus an in-memory
// thread table and one factory project, so spawn/list/get/metadata behave
// like the real server's.
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createFakePluginHost, makeHostResponse, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import hostEntry from "../../host.ts";
import { SKILL_ID } from "../../shared/constants.ts";
import { lessonExamples } from "../../shared/derive.ts";
import type { Course, ExampleProgress, Lesson } from "../../shared/model.ts";
import type { BbPluginApi, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { loadBuiltinCourse, loadCourse } from "../../server/course/load-course.ts";
import { registerTutor } from "../../server/coach/register.ts";
import { createProgressStore } from "../../server/progress/store.ts";
import type { WorkspaceAccess } from "../../server/workspace/access.ts";
import { createHostClient } from "../../server/workspace/host-client.ts";
import { createMachineAccess } from "../../server/workspace/machine-access.ts";
import { createDiskAccess, diskSnapshot } from "./disk-access.ts";
import type { TutorRuntime } from "../../server/coach/runtime.ts";

export const PROJECT_ID = "prj_factory";
export const NOW = new Date("2026-09-25T11:00:00Z");

/** One host as a test wants `sdk.hosts.list`/`get` to answer it: the real shape has far more fields. */
export interface FakeHost {
  id: string;
  name?: string;
  status: "connected" | "disconnected";
  machineProviderId: string | null;
}

type Sdk = BbPluginApi["sdk"];
type ProjectResponse = Awaited<ReturnType<Sdk["projects"]["get"]>>;

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

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** sdk.files over this disk, answering as BB 0.44.0's host daemon does (ENOENT for a missing file). */
const diskFiles = {
  read: async ({ path }: { path: string }) => {
    const data = await readFile(path).catch((cause: NodeJS.ErrnoException) => {
      throw cause.code === "ENOENT" ? httpError(404, "ENOENT", `Path does not exist: ${path}`) : cause;
    });
    return { path, content: data.toString("base64"), contentEncoding: "base64" as const, sha256: sha256(data), sizeBytes: data.length };
  },
  write: async (args: { path: string; content: string; contentEncoding?: "utf8" | "base64"; createParents?: boolean; expectedSha256?: string | null }) => {
    if (args.expectedSha256 !== undefined) {
      const current = await readFile(args.path).then(sha256, () => null);
      if (current !== args.expectedSha256) return { outcome: "conflict" as const, currentSha256: current };
    }
    const data = Buffer.from(args.content, args.contentEncoding === "base64" ? "base64" : "utf8");
    if (args.createParents === true) await mkdir(dirname(args.path), { recursive: true });
    await writeFile(args.path, data);
    return { outcome: "written" as const, sha256: sha256(data), sizeBytes: data.length };
  },
  remove: async ({ path }: { path: string }) => {
    await unlink(path).catch((cause: NodeJS.ErrnoException) => {
      throw cause.code === "ENOENT" ? httpError(404, "ENOENT", `Path does not exist: ${path}`) : cause;
    });
    return { ok: true };
  },
};

/** An error shaped like the SDK's BbHttpError. */
function httpError(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code });
}

/** Every Example of `lesson` passing, as its progress entries. */
export function allPassing(lesson: Lesson, at = NOW.toISOString().replace(/\.\d{3}Z$/, "Z")): Record<string, ExampleProgress> {
  return Object.fromEntries(lessonExamples(lesson).map((example) => [example.key, { status: "passing", hash: example.hash, at }]));
}

/** Calls a coach tool as `threadId`, in the workspace project. */
export async function callTool(host: TutorHost, name: string, input: unknown, threadId: string): Promise<PluginAgentToolResult> {
  return host.harness.behavior.callAgentTool(name, input, { threadId, projectId: PROJECT_ID });
}

/**
 * A fake BB host running Tutor. `course` is the configured course, or null
 * for none (Tutor then has its built-in course alone); the built-in course is
 * the real one. `workspaceRoot` is the project's folder.
 */
export async function makeTutorHost(
  course: Course | null,
  workspaceRoot: string,
  settings: Record<string, string | boolean> = { factoryProject: PROJECT_ID },
  options: {
    dataDir?: string;
    env?: Record<string, string>;
    featureConfigFile?: string;
    projectName?: string;
    /**
     * The workspace access per machine: the local disk unless given. "machine"
     * is production's: sdk.files (faked over this disk) and the real host
     * entry's handlers, reached through bb.hosts.experimental_client.
     */
    access?: ((hostId: string) => WorkspaceAccess) | "machine";
    /** What sdk.hosts.get says of the workspace's machine; "connected" unless given. */
    hostStatus?: "connected" | "disconnected";
    /** Whether BB has a host of its own (the Codespace's); a standalone bb-server has none. Yes unless given. */
    serverHost?: boolean;
    /** Runs before each call to the host entry is dispatched: to watch the calls, or to fail one by throwing. */
    onHostCall?: (method: string, input: unknown) => unknown;
    /** What sdk.system.providerStates says of each agent on a machine; without it, the call fails (as on an older BB). */
    providerStates?: {
      providerId: string;
      status: "ready" | "unauthenticated" | "expired" | "not_installed" | "unknown" | "unsupported_version";
      loginCommand?: string | null;
    }[];
    /** Hosts sdk.hosts.list returns; the server's own host unless given. */
    hosts?: FakeHost[];
    /** When true, sdk.projects.list starts empty and sdk.projects.create adds to it. */
    noProjectYet?: boolean;
  } = {},
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
  const project: ProjectResponse = {
    id: PROJECT_ID,
    name: options.projectName ?? "tetris/.factory",
    kind: "standard",
    gitRemoteUrl: null,
    createdAt: 1,
    updatedAt: 1,
    sources: [
      { id: "src_1", projectId: PROJECT_ID, hostId: "host_1", type: "local_path", path: workspaceRoot, isDefault: true, createdAt: 1, updatedAt: 1 },
    ],
  };
  const projects: ProjectResponse[] = options.noProjectYet === true ? [] : [project];

  // The real host entry, run in-process as BB's host daemon would run it.
  const hostHarness = experimental_createHostEntryHarness(hostEntry);
  const host = createFakePluginHost({
    pluginId: "tutor",
    experimental_callHostRpc: async (call) => {
      await options.onHostCall?.(call.method, call.input);
      return hostHarness.experimental_call(call.method as keyof typeof hostEntry.contract, call.input as never, call.signal === undefined ? {} : { signal: call.signal });
    },
    agentSkillIds: [SKILL_ID],
    settings,
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    sdk: {
      hosts: {
        get: async ({ hostId }) => {
          const found = options.hosts?.find((h) => h.id === hostId);
          if (found !== undefined) {
            return { ...makeHostResponse({ id: found.id, name: found.name ?? found.id, status: found.status, machineProviderId: found.machineProviderId }), connectMachineId: null };
          }
          return { ...makeHostResponse({ id: hostId, status: options.hostStatus ?? "connected" }), connectMachineId: null };
        },
        // The server's own host has no machine provider; a machine enrolled by hand has "manual".
        list: async () =>
          options.hosts !== undefined
            ? options.hosts.map((h) => makeHostResponse({ id: h.id, name: h.name ?? h.id, status: h.status, machineProviderId: h.machineProviderId }))
            : options.serverHost === false
              ? []
              : [makeHostResponse({ id: "host_1", machineProviderId: null })],
      },
      files: diskFiles,
      ...(options.providerStates === undefined
        ? {}
        : {
            system: {
              providerStates: async () => ({
                providers: options.providerStates!.map((state) => ({
                  accountEmail: null,
                  canInstall: false,
                  canUpdate: false,
                  displayName: state.providerId,
                  installedVersion: null,
                  loginCommand: null,
                  minimumSupportedVersion: null,
                  planLabel: null,
                  statusMessage: null,
                  ...state,
                })),
              }),
            },
          }),
      projects: {
        get: async ({ projectId }) => {
          const found = projects.find((p) => p.id === projectId);
          if (found === undefined) throw new Error(`HTTP 404: project ${projectId} not found`);
          return found;
        },
        list: async () => projects,
        create: async ({ name, source }) => {
          const id = `proj_${projects.length + 1}`;
          const created: ProjectResponse = {
            id,
            name,
            kind: "standard",
            sources: [
              { id: "src_x", projectId: id, hostId: source.hostId, type: "local_path", path: source.path, isDefault: true, createdAt: 1, updatedAt: 1 },
            ],
            gitRemoteUrl: null,
            createdAt: 1,
            updatedAt: 1,
          };
          projects.push(created);
          return created;
        },
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
  const client = createHostClient(host.bb);
  const rt = await registerTutor(host.bb, {
    courseSource: {
      // Without a configured course, the courses Tutor reads are fetched ones, read from disk for real.
      loadCourse: async (path) => (course === null ? loadCourse(path) : course),
      loadBuiltin: loadBuiltinCourse,
    },
    store: createProgressStore(),
    env: options.env ?? {},
    featureConfigFile: options.featureConfigFile ?? "/nonexistent/tutor/config.json",
    now: () => NOW,
    // The configured course stands in for whatever folder is named, the default one included; without one, nothing is at the default.
    courseExists: async () => course !== null,
    access:
      options.access === "machine"
        ? (hostId: string) => createMachineAccess(host.bb, client, hostId)
        : (options.access ?? (() => createDiskAccess())),
    // The snapshot goes the way the access does: through the host entry, or over the disk. An access a test
    // gives (to watch or fail calls) gets none, so every read reaches it.
    ...(options.access === "machine"
      ? { snapshot: client.snapshot }
      : options.access === undefined
        ? { snapshot: diskSnapshot }
        : {}),
  });
  return { ...host, rt, threads, running, sent, tabs, tabConflicts, tabWriteError, forkRefusal, archiveRefusal, beforeList, addThread };
}
