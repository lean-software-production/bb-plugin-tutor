// Wires Tutor's backend into BB: settings, coach tools, configure scoping,
// the dispatch guard, thread events and the RPC handlers.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerRpc } from "../rpc/handlers.ts";
import { coachConfiguration } from "./configure.ts";
import { decideDispatch } from "./dispatch-guard.ts";
import type { TutorRuntime } from "./runtime.ts";
import { defineTutorSettings } from "./settings.ts";
import { createStateSignals } from "./signals.ts";
import { registerCoachTools } from "./tools.ts";
import { createWorldSource, type WorldDeps } from "./world.ts";

export async function registerTutor(bb: BbPluginApi, deps: WorldDeps): Promise<TutorRuntime> {
  const settings = defineTutorSettings(bb);
  const rt: TutorRuntime = {
    bb,
    settings,
    world: createWorldSource(bb, settings, deps),
    store: deps.store,
    signals: createStateSignals(bb),
    now: deps.now,
  };

  registerCoachTools(rt);
  bb.agents.configure((context) =>
    coachConfiguration(context, bb.pluginId, { coachPath: rt.world.lastCourse()?.coachPath ?? null }),
  );
  bb.experimental_hooks.on("message.dispatch", async (context) => {
    const decision = await decideDispatch(bb.sdk, bb.pluginId, context, deps.now().getTime());
    if (decision.action === "wait") bb.log.info(`[tutor] holding ${context.thread.id}: ${decision.reason}`);
    return decision;
  });

  const recheck = () => void bb.experimental_hooks.recheck("message.dispatch");
  bb.events.on("thread.idle", async ({ thread }) => {
    if (thread.originPluginId !== bb.pluginId) return;
    recheck();
    rt.signals.observe(await rt.world.load(), { publishIfUnseen: true });
  });
  bb.events.on("thread.failed", ({ thread }) => {
    if (thread.originPluginId === bb.pluginId) recheck();
  });
  for (const event of ["thread.archived", "thread.unarchived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) => {
      if (thread.originPluginId !== bb.pluginId) return;
      recheck();
      rt.signals.publish("threads", null);
    });
  }

  registerRpc(rt);
  settings.onChange(() => rt.signals.publish("binding", null));
  return rt;
}
