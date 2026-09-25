// The six coach tools. Each call re-derives the world, re-checks the calling
// thread with BB, runs the pure action, then writes the files it returned.
import type { PluginAgentToolContext, PluginAgentToolResult, PluginRowLabels } from "@get-bb/plugin-sdk";
import { TOOL_NAMES, type ToolName } from "../../shared/constants.ts";
import { findRule } from "../../shared/derive.ts";
import { toolParameterSchemas, type ToolParameters } from "../../shared/tools.ts";
import { copyHomeworkSpec } from "../progress/spec-copy.ts";
import { isoSeconds } from "../progress/time.ts";
import {
  adoptAction,
  coachStateOf,
  completeAction,
  focusAction,
  markAction,
  type CoachState,
  type Outcome,
} from "./actions.ts";
import { authorizeCaller, type Caller } from "./auth.ts";
import { factoryLockKey } from "./lock-keys.ts";
import type { TutorRuntime } from "./runtime.ts";
import { statusText } from "./status-text.ts";
import { spawnSideThread } from "./threads.ts";
import type { World } from "./world.ts";

type Action<Name extends ToolName> = (
  state: CoachState,
  input: ToolParameters<Name>,
  caller: Caller,
  now: string,
) => Outcome | Promise<Outcome>;

interface ToolSpec<Name extends ToolName> {
  name: Name;
  description: string;
  label: PluginRowLabels;
  action: Action<Name>;
}

function refusal(text: string): PluginAgentToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

async function applyOutcome(rt: TutorRuntime, root: string, outcome: Outcome): Promise<void> {
  if ("error" in outcome) return;
  if (outcome.adopt !== undefined) await copyHomeworkSpec(root, outcome.adopt);
  if (outcome.iteration !== undefined) await rt.store.writeIteration(root, outcome.iteration);
  if (outcome.progress !== undefined) await rt.store.writeProgress(root, outcome.progress);
  if (outcome.iteration !== undefined || outcome.progress !== undefined) {
    rt.signals.publish(outcome.iteration === undefined ? "progress" : "iteration", outcome.progress?.iteration ?? null);
  }
}

function register<Name extends ToolName>(rt: TutorRuntime, spec: ToolSpec<Name>): void {
  rt.bb.agents.registerTool({
    name: spec.name,
    description: spec.description,
    presentation: { label: spec.label },
    parameters: toolParameterSchemas[spec.name],
    async execute(input: ToolParameters<Name>, context: PluginAgentToolContext): Promise<PluginAgentToolResult> {
      const run = async (world: World): Promise<PluginAgentToolResult> => {
        const caller = await authorizeCaller(rt.bb.sdk, rt.bb.pluginId, context.threadId, world.binding);
        if ("error" in caller) return refusal(caller.error);
        const state = coachStateOf(world);
        if ("error" in state) return refusal(state.error);
        const outcome = await spec.action(state, input, caller, isoSeconds(rt.now()));
        if ("error" in outcome) return refusal(outcome.error);
        await applyOutcome(rt, state.root, outcome);
        return outcome.text;
      };
      try {
        const world = await rt.world.load();
        if (world.binding.status !== "bound") return await run(world);
        // Read-modify-write of the factory's files: re-read them once earlier calls have written.
        return await rt.locks.run(factoryLockKey(world.binding.root), async () => run(await rt.world.load()));
      } catch (cause) {
        rt.bb.log.error(`[tutor] ${spec.name} failed: ${String(cause)}`);
        return refusal(`${spec.name} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    },
  });
}

async function sideThread(
  rt: TutorRuntime,
  state: CoachState,
  input: ToolParameters<"tutor_side_thread">,
  caller: Caller,
): Promise<Outcome> {
  const rule = input.rule === undefined ? null : (findRule(state.homework, input.rule) ?? null);
  if (input.rule !== undefined && rule === null) {
    return { error: `There is no Rule ${input.rule} in homework ${state.homework.id}. Call tutor_status for the keys.` };
  }
  const threadId = await spawnSideThread(rt.bb.sdk, {
    projectId: state.projectId,
    factory: { root: state.root, hostId: state.hostId },
    courseId: state.course.id,
    homeworkId: state.homework.id,
    parentThreadId: caller.mainThreadId,
    ruleKey: rule?.key ?? null,
    title: input.title,
    prompt: input.prompt,
  });
  rt.signals.publish("threads", state.homework.id);
  return { text: `Started side thread ${threadId} ("${input.title}"). It shares this working tree.` };
}

export function registerCoachTools(rt: TutorRuntime): void {
  register(rt, {
    name: TOOL_NAMES.status,
    description:
      "Where the student is: the current homework, the Rule in focus, and every Rule's Examples with their keys and status. Call it before using the other tutor tools.",
    label: { pending: "Checking course progress", completed: "Checked course progress" },
    action: (state) => ({ text: statusText(state) }),
  });
  register(rt, {
    name: TOOL_NAMES.focusRule,
    description:
      "Move the cursor to a Rule of the current homework (main coach thread only). Returns a ::tutor-progress card to echo.",
    label: { pending: "Moving to a Rule", completed: "Moved to a Rule" },
    action: (state, input, caller) => focusAction(state, input, caller.isMain),
  });
  register(rt, {
    name: TOOL_NAMES.markExample,
    description:
      "Record one Example's status. passing needs evidence (the command you ran and its output, or a test name); not-yet needs a note saying what happened instead. Returns a ::tutor-progress card to echo.",
    label: { pending: "Marking an Example", completed: "Marked an Example" },
    action: (state, input, _caller, now) => markAction(state, input, now),
  });
  register(rt, {
    name: TOOL_NAMES.adoptIteration,
    description:
      "Adopt the next homework as coach-me does: copy its README.md, FACTORY.md and features/ into spec/, its sample seed into seeds/, write spec/ITERATION as WIP and start spec/PROGRESS.yaml, carrying over Examples already passing. Does not commit.",
    label: { pending: "Adopting the homework", completed: "Adopted the homework" },
    action: (state, input, _caller, now) => adoptAction(state, input, now),
  });
  register(rt, {
    name: TOOL_NAMES.completeIteration,
    description:
      "Finish the current homework: write spec/ITERATION as Done and store your two- or three-sentence summary for the student. Returns a ::tutor-progress card to echo.",
    label: { pending: "Completing the homework", completed: "Completed the homework" },
    action: (state, input) => completeAction(state, input),
  });
  register(rt, {
    name: TOOL_NAMES.sideThread,
    description:
      "Start a side thread under this homework's coach, optionally about one Rule, for a question that would derail the main thread. It shares the working tree.",
    label: { pending: "Starting a side thread", completed: "Started a side thread" },
    action: (state, input, caller) => sideThread(rt, state, input, caller),
  });
}
