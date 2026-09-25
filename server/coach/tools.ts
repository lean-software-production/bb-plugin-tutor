// The six coach tools. Each call re-derives the world, re-checks the calling
// thread with BB, runs the pure action, then writes the files it returned.
import type { PluginAgentToolContext, PluginAgentToolResult, PluginRowLabels } from "@get-bb/plugin-sdk";
import { TOOL_NAMES, type ToolName } from "../../shared/constants.ts";
import { findLesson, findRule } from "../../shared/derive.ts";
import { toolParameterSchemas, type ToolParameters } from "../../shared/tools.ts";
import { copyLessonSpec } from "../progress/spec-copy.ts";
import { isoSeconds } from "../progress/time.ts";
import {
  adoptAction,
  adoptionByOtherError,
  coachStateOf,
  completeAction,
  focusAction,
  markAction,
  otherLessonError,
  type CoachState,
  type Outcome,
} from "./actions.ts";
import { authorizeCaller, type Caller } from "./auth.ts";
import { factoryLockKey } from "./lock-keys.ts";
import type { TutorRuntime } from "./runtime.ts";
import { sideChatAnchor, sideChatSeed } from "./prompts.ts";
import { openSideChat } from "./side-chats.ts";
import { statusText } from "./status-text.ts";
import { recordReachedRule } from "./threads.ts";
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
  /**
   * Which lesson the calling thread must coach: the current one, for tools
   * that change the student's progress; any, for the read-only status and for
   * side chats, which stay with the caller's lesson.
   */
  lesson: "current" | "any";
  action: Action<Name>;
}

function refusal(text: string): PluginAgentToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

async function applyOutcome(rt: TutorRuntime, root: string, outcome: Outcome, caller: Caller): Promise<void> {
  if ("error" in outcome) return;
  if (outcome.reached !== undefined) await recordReachedRule(rt.bb.sdk, caller.coachThreadId, outcome.reached);
  if (outcome.adopt !== undefined) await copyLessonSpec(root, outcome.adopt);
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
        const caller = await authorizeCaller(rt.bb.sdk, rt.bb.pluginId, context.threadId, world.factoryProject);
        if ("error" in caller) return refusal(caller.error);
        const state = coachStateOf(world);
        if ("error" in state) return refusal(state.error);
        const otherLesson = spec.lesson === "current" ? otherLessonError(state, caller) : null;
        if (otherLesson !== null) return refusal(otherLesson);
        const outcome = await spec.action(state, input, caller, isoSeconds(rt.now()));
        if ("error" in outcome) return refusal(outcome.error);
        await applyOutcome(rt, state.root, outcome, caller);
        return outcome.text;
      };
      try {
        const world = await rt.world.load();
        if (world.factoryProject.status !== "found") return await run(world);
        // Read-modify-write of the factory's files: re-read them once earlier calls have written.
        return await rt.locks.run(factoryLockKey(world.factoryProject.root), async () => run(await rt.world.load()));
      } catch (cause) {
        rt.bb.log.error(`[tutor] ${spec.name} failed: ${String(cause)}`);
        return refusal(`${spec.name} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    },
  });
}

async function sideChat(
  rt: TutorRuntime,
  state: CoachState,
  input: ToolParameters<"tutor_side_chat">,
  caller: Caller,
): Promise<Outcome> {
  // A side chat belongs to its coach thread's lesson, which need not be the current one.
  const lesson = caller.courseId === state.course.id ? findLesson(state.course, caller.lessonId) : undefined;
  if (lesson === undefined) {
    return { error: `This coach thread is for a lesson that isn't in "${state.course.title}", so it can't open side chats.` };
  }
  const rule = input.rule === undefined ? null : (findRule(lesson, input.rule) ?? null);
  if (input.rule !== undefined && rule === null) {
    return { error: `There is no Rule ${input.rule} in lesson ${lesson.id}. Call tutor_status for the keys.` };
  }
  const sideChatId = await openSideChat(
    rt.bb.sdk,
    {
      coachThreadId: caller.coachThreadId,
      courseId: state.course.id,
      lessonId: lesson.id,
      ruleKey: rule?.key ?? null,
      title: input.title,
      seed: sideChatSeed(lesson, rule, input.prompt),
    },
    sideChatAnchor(lesson, rule),
  );
  rt.signals.publish("threads", lesson.id);
  return {
    text:
      `Started side chat ${sideChatId} ("${input.title}"). It opens as the "Side chat" tab in the coach thread's right panel ` +
      "and shares this working tree. Tell the student to continue there, then carry on with the Rule.",
  };
}

export function registerCoachTools(rt: TutorRuntime): void {
  register(rt, {
    name: TOOL_NAMES.status,
    description:
      "Where the student is: the current lesson, the Rule in focus, and every Rule's Examples with their keys and status. Call it before using the other tutor tools.",
    label: { pending: "Checking course progress", completed: "Checked course progress" },
    lesson: "any",
    action: (state, _input, caller) => ({ text: statusText(state, { lessonId: caller.lessonId, otherLesson: otherLessonError(state, caller) }) }),
  });
  register(rt, {
    name: TOOL_NAMES.focusRule,
    description:
      "Move the focus to a Rule of the current lesson (coach thread only). Returns the Rule card, a ::tutor-progress line to put at the top of your next message.",
    label: { pending: "Moving to a Rule", completed: "Moved to a Rule" },
    lesson: "current",
    action: (state, input, caller) => focusAction(state, input, caller.isCoachThread),
  });
  register(rt, {
    name: TOOL_NAMES.markExample,
    description:
      "Record one Example's status. passing needs evidence (the command you ran and its output, or a test name); not-yet needs a note saying what happened instead. Returns a ::tutor-progress card to echo.",
    label: { pending: "Marking an Example", completed: "Marked an Example" },
    lesson: "current",
    action: (state, input, _caller, now) => markAction(state, input, now),
  });
  register(rt, {
    name: TOOL_NAMES.adoptIteration,
    description:
      "Adopt this coach thread's lesson (an iteration, in the course repo's words) as coach-me does: copy its README.md, FACTORY.md and features/ into spec/, its sample seed into seeds/, write spec/ITERATION as WIP and start spec/PROGRESS.yaml, carrying over Examples already passing. Does not commit. A coach thread adopts only its own lesson.",
    label: { pending: "Adopting the lesson", completed: "Adopted the lesson" },
    // Adopting makes the caller's lesson the current one, so it checks the lesson itself.
    lesson: "any",
    action: (state, input, caller, now) => {
      const other = adoptionByOtherError(state, input, caller);
      return other === null ? adoptAction(state, input, now) : { error: other };
    },
  });
  register(rt, {
    name: TOOL_NAMES.completeIteration,
    description:
      "Finish the current lesson: write spec/ITERATION as Done and store your two- or three-sentence summary for the student. Returns a ::tutor-progress card to echo.",
    label: { pending: "Completing the lesson", completed: "Completed the lesson" },
    lesson: "current",
    action: (state, input) => completeAction(state, input),
  });
  register(rt, {
    name: TOOL_NAMES.sideChat,
    description:
      "Move a side question into a BB side chat of this lesson's coach thread, optionally about one Rule, so the coach thread stays on its Rule. It opens as the \"Side chat\" tab in the coach thread's right panel and shares the working tree.",
    label: { pending: "Starting a side chat", completed: "Started a side chat" },
    lesson: "any",
    action: (state, input, caller) => sideChat(rt, state, input, caller),
  });
}
