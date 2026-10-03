// Wires Tutor's backend into BB: settings, coach tools, configure scoping,
// the dispatch guard, thread events and the RPC handlers.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { coachThreadMetadataSchema } from "../../shared/model.ts";
import { createActivityRecorder, resolveDataDir } from "../activity/heartbeat.ts";
import { registerRpc } from "../rpc/handlers.ts";
import { createHostClient } from "../workspace/host-client.ts";
import { createCoachRegistry } from "./coach-registry.ts";
import { coachConfiguration } from "./configure.ts";
import { factoryWhere } from "./prompts.ts";
import { readFeatureConfig } from "./course-path.ts";
import { decideDispatch } from "./dispatch-guard.ts";
import { createKeyedLock } from "./keyed-lock.ts";
import type { TutorRuntime } from "./runtime.ts";
import { defineTutorSettings } from "./settings.ts";
import { createStateSignals } from "./signals.ts";
import { listTutorThreads, threadCourse } from "./threads.ts";
import { registerCoachTools } from "./tools.ts";
import { createWorldSource, methodCourse, type WorldDeps } from "./world.ts";

export async function registerTutor(bb: BbPluginApi, deps: WorldDeps): Promise<TutorRuntime> {
  const settings = defineTutorSettings(bb);
  const rt: TutorRuntime = {
    bb,
    settings,
    world: createWorldSource(bb, settings, deps),
    store: deps.store,
    access: deps.access,
    host: createHostClient(bb),
    signals: createStateSignals(bb),
    locks: createKeyedLock(),
    coaches: createCoachRegistry(),
    activity: createActivityRecorder({
      dataDir: async () =>
        resolveDataDir({
          fromBb: () => bb.server.experimental_dataDir,
          env: deps.env,
          configDataDir: (await readFeatureConfig(deps.featureConfigFile)).dataDir,
        }),
      now: deps.now,
    }),
    now: deps.now,
  };

  registerCoachTools(rt);
  bb.agents.configure((context) => {
    // The thread's course: its own Tutor metadata, else (a side chat BB made) its coach thread's.
    const metadata = coachThreadMetadataSchema.safeParse(context.pluginMetadata);
    const forkOf = context.origin.kind === "fork" ? context.thread.sourceThreadId : null;
    const courseId = metadata.success
      ? threadCourse(metadata.data.course, metadata.data.lesson)
      : forkOf === null
        ? undefined
        : rt.coaches.courseOf(forkOf);
    const courses = rt.world.lastCourses();
    const loaded = courses.find((entry) => entry.course.id === courseId);
    const method = loaded === undefined ? null : methodCourse(courses, loaded);
    return coachConfiguration(context, bb.pluginId, {
      coach: method?.coach ?? null,
      factory: factoryWhere(method?.layout ?? null),
      coachLesson: (threadId) => rt.coaches.lessonOf(threadId),
    });
  });
  bb.experimental_hooks.on("message.dispatch", async (context) => {
    const decision = await decideDispatch(bb.sdk, bb.pluginId, context, deps.now().getTime());
    if (decision.action === "wait") bb.log.info(`[tutor] holding ${context.thread.id}: ${decision.reason}`);
    return decision;
  });

  const recheck = () => void bb.experimental_hooks.recheck("message.dispatch");
  // A side chat BB made of a coach thread is not Tutor's, but a coach turn may be waiting for it.
  const mayHoldATurn = (thread: { originPluginId: string | null; originKind: string | null }) =>
    thread.originPluginId === bb.pluginId || thread.originKind === "fork";
  bb.events.on("thread.idle", async ({ thread }) => {
    if (!mayHoldATurn(thread)) return;
    recheck();
    if (thread.originPluginId === bb.pluginId) rt.signals.observe(await rt.world.load(), { publishIfUnseen: true });
  });
  bb.events.on("thread.failed", ({ thread }) => {
    if (mayHoldATurn(thread)) recheck();
  });
  for (const event of ["thread.archived", "thread.unarchived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) => {
      if (!mayHoldATurn(thread)) return;
      recheck();
      rt.signals.publish("threads", null);
    });
  }

  // A side chat BB made of a coach thread belongs in the course outline straight away.
  bb.events.on("thread.created", ({ thread }) => {
    const lessonId = thread.originKind === "fork" && thread.sourceThreadId !== null ? rt.coaches.lessonOf(thread.sourceThreadId) : undefined;
    if (lessonId !== undefined) rt.signals.publish("threads", lessonId);
  });

  registerRpc(rt);
  settings.onChange(() => rt.signals.publish("workspace", null));
  void warmCoachRegistry(rt);
  return rt;
}

/** So configure knows the coach threads from the start, not only after the first page load. */
async function warmCoachRegistry(rt: TutorRuntime): Promise<void> {
  try {
    const world = await rt.world.load();
    if (world.workspace.status !== "found") return;
    rt.coaches.remember(await listTutorThreads(rt.bb.sdk, rt.bb.pluginId, world.workspace.projectId));
  } catch (cause) {
    rt.bb.log.warn(`[tutor] could not list coach threads at start: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
