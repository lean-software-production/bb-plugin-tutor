// The seven coach tools. Each call re-derives the world, re-checks the calling
// thread with BB, runs the pure action, then writes the files it returned.
import type { PluginAgentToolContext, PluginAgentToolResult, PluginRowLabels } from "@get-bb/plugin-sdk";
import { FACTORY_FILES, TOOL_NAMES, type ToolName } from "../../shared/constants.ts";
import { findLesson, findRule } from "../../shared/derive.ts";
import { toolParameterSchemas, type ToolParameters } from "../../shared/tools.ts";
import type { IterationState, Lesson, ProgressFile } from "../../shared/model.ts";
import { lessonSpecBundle, standInsBundle } from "../content/make-bundle.ts";
import { overlaps, realPath } from "../paths.ts";
import { isoSeconds } from "../progress/time.ts";
import { WorkspaceUnreachableError, WriteConflictError } from "../workspace/access.ts";
import {
  adoptAction,
  adoptionByOtherError,
  coachStateOf,
  completeAction,
  focusAction,
  layoutError,
  markAction,
  otherLessonError,
  type CoachState,
  type Outcome,
} from "./actions.ts";
import { authorizeCaller, type Caller } from "./auth.ts";
import { addCourse, addedCourseText } from "./add-course.ts";
import { workspaceLockKey } from "./lock-keys.ts";
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
  /** The world the state came from, read under the workspace lock. */
  world: World,
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
  /**
   * Refused while the course's layout isn't ready for the current lesson
   * (layoutError): the tools that change its progress. tutor_status always
   * answers; tutor_adopt_iteration checks the lesson it adopts itself.
   */
  needsLayout: boolean;
  action: Action<Name>;
}

/** A tool's second write conflict in one call (Decision 7): the coach sees it and starts again. */
export const PROGRESS_CONFLICT_TEXT = "Your progress file changed while Tutor was writing it. Call tutor_status and try again.";

function refusal(text: string): PluginAgentToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Refuses a seed that would land in the course: a seeds folder that is, or
 * shares a folder with, the course checkout (the course is on the server's
 * side, so this is checked here, before the machine is asked to write).
 */
async function refuseSeedsInCourse(rt: TutorRuntime, state: CoachState, lesson: Lesson): Promise<void> {
  if (state.layout.id !== "capstone-factory" || lesson.seedSpec === null) return;
  const { layout } = state.layout;
  if (overlaps(await rt.access(state.hostId).realPath(layout.seedsDir), await realPath(state.course.root))) {
    throw new Error(
      `${layout.codebase}/${FACTORY_FILES.seedsDir}/ is, or shares a folder with, the course, so Tutor will not write the seed there. Keep the course checkout apart from your repo.`,
    );
  }
}

/**
 * Adopts a capstone lesson as one host call on the workspace's machine
 * (layouts/capstone-factory/adopt.ts): from 004 in a starter clone the factory
 * moves to factory/ first, then spec/, the seed and stand-ins/ are written
 * from bundles built here, then PROGRESS.yaml and ITERATION, so ITERATION
 * never names a lesson that isn't there. A progress file edited since the
 * world was read is a WriteConflictError, with nothing written; the tool
 * then reads the world again and acts once more. Returns the host's note.
 */
async function adoptOnMachine(rt: TutorRuntime, state: CoachState, lesson: Lesson, outcome: { progress?: ProgressFile; iteration?: IterationState }): Promise<string | null> {
  if (state.layout.id !== "capstone-factory") throw new Error("Only a capstone course's lessons are adopted into the workspace.");
  if (outcome.progress === undefined || outcome.iteration === undefined) throw new Error(`Adopting lesson ${lesson.id} needs its progress and ITERATION.`);
  await refuseSeedsInCourse(rt, state, lesson);
  const adopted = await rt.host.adoptLesson(state.hostId, {
    root: state.layout.layout.projectRoot,
    lesson: { id: lesson.id, seedSpec: lesson.seedSpec },
    spec: await lessonSpecBundle(lesson.dir),
    standIns: await standInsBundle(state.course.root),
    progress: outcome.progress,
    iteration: outcome.iteration,
    progressSha256: state.student.progressSha256 ?? null,
  });
  return adopted.note;
}

/** Performs the outcome's writes; returns a note to add to the tool's text, or null. */
async function applyOutcome(rt: TutorRuntime, state: CoachState, outcome: Outcome, caller: Caller): Promise<string | null> {
  if ("error" in outcome) return null;
  const writes = outcome.adopt !== undefined || outcome.iteration !== undefined || outcome.progress !== undefined;
  // A factory Tutor can't find (or won't use) gets nothing written into where it should be.
  if (writes && state.layout.blocked !== null) throw new Error(state.layout.blocked);
  if (outcome.reached !== undefined) await recordReachedRule(rt.bb.sdk, caller.coachThreadId, outcome.reached);
  let note: string | null = null;
  // Only the capstone copies a lesson's spec into the workspace, all of it on the machine in one call;
  // a course without a layout keeps it in the course, and Lesson 0 lives in Tutor.
  if (outcome.adopt !== undefined && state.layout.id === "capstone-factory") {
    note = await adoptOnMachine(rt, state, outcome.adopt, outcome);
  } else {
    const access = rt.access(state.hostId);
    const progressAt = state.layout.progress;
    if (outcome.iteration !== undefined) await rt.store.writeIteration(access, progressAt, outcome.iteration);
    // Only if the file is still what the world read: an edit since then is a conflict, not lost.
    if (outcome.progress !== undefined) await rt.store.writeProgress(access, progressAt, outcome.progress, state.student.progressSha256 ?? null);
  }
  if (outcome.iteration !== undefined || outcome.progress !== undefined) {
    rt.signals.publish(outcome.iteration === undefined ? "progress" : "iteration", outcome.progress?.iteration ?? null);
  }
  return note;
}

function register<Name extends ToolName>(rt: TutorRuntime, spec: ToolSpec<Name>): void {
  rt.bb.agents.registerTool({
    name: spec.name,
    description: spec.description,
    presentation: { label: spec.label },
    parameters: toolParameterSchemas[spec.name],
    async execute(input: ToolParameters<Name>, context: PluginAgentToolContext): Promise<PluginAgentToolResult> {
      const run = async (world: World): Promise<PluginAgentToolResult> => {
        const caller = await authorizeCaller(rt.bb.sdk, rt.bb.pluginId, context.threadId, world.workspace);
        if ("error" in caller) return refusal(caller.error);
        // The caller's course: the tools act on the course its coach thread coaches.
        const state = coachStateOf(world, caller.courseId);
        if ("error" in state) return refusal(state.error);
        const otherLesson = spec.lesson === "current" ? otherLessonError(state, caller) : null;
        if (otherLesson !== null) return refusal(otherLesson);
        const notReady = spec.needsLayout ? layoutError(state) : null;
        if (notReady !== null) return refusal(notReady);
        const outcome = await spec.action(state, input, caller, isoSeconds(rt.now()), world);
        if ("error" in outcome) return refusal(outcome.error);
        const note = await applyOutcome(rt, state, outcome, caller);
        return note === null ? outcome.text : `${outcome.text}\n${note}`;
      };
      try {
        const world = await rt.world.load();
        if (world.workspace.status !== "found") return await run(world);
        // Read-modify-write of the workspace's files: re-read them once earlier calls have written.
        // Keyed on the project's folder, which stays put when the factory moves to factory/.
        return await rt.locks.run(workspaceLockKey(world.workspace.root), async () => {
          try {
            return await run(await rt.world.load());
          } catch (cause) {
            if (!(cause instanceof WriteConflictError)) throw cause;
          }
          // Something else wrote a file between Tutor's read and its write: read it again, and act once more.
          try {
            return await run(await rt.world.load());
          } catch (cause) {
            if (cause instanceof WriteConflictError) return refusal(PROGRESS_CONFLICT_TEXT);
            throw cause;
          }
        });
      } catch (cause) {
        // The machine went offline mid-call: say so as every gate does.
        if (cause instanceof WorkspaceUnreachableError) return refusal(cause.message);
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
    needsLayout: false,
    action: (state, _input, caller) => ({ text: statusText(state, { lessonId: caller.lessonId, otherLesson: otherLessonError(state, caller) }) }),
  });
  register(rt, {
    name: TOOL_NAMES.focusRule,
    description:
      "Move the focus to a Rule of the current lesson (coach thread only). Returns the Rule card, a ::tutor-progress line to put at the top of your next message.",
    label: { pending: "Moving to a Rule", completed: "Moved to a Rule" },
    lesson: "current",
    needsLayout: true,
    action: (state, input, caller) => focusAction(state, input, caller.isCoachThread),
  });
  register(rt, {
    name: TOOL_NAMES.markExample,
    description:
      "Record one Example's status. passing needs evidence (the command you ran and its output, or a test name); not-yet needs a note saying what happened instead. Returns a ::tutor-progress card to echo.",
    label: { pending: "Marking an Example", completed: "Marked an Example" },
    lesson: "current",
    needsLayout: true,
    action: (state, input, _caller, now) => markAction(state, input, now),
  });
  register(rt, {
    name: TOOL_NAMES.adoptIteration,
    description:
      "Adopt this coach thread's lesson (an iteration, in the course repo's words) as fetch-iteration does, from the course on this machine: copy its README.md, FACTORY.md and features/ into the factory's spec/, its sample seed into tetris/seeds/ (../seeds/ beside a factory that is its own project) unless one is there, refresh stand-ins/, write ITERATION as WIP and start spec/PROGRESS.yaml, carrying over Examples already passing. In a capstone-project-starter clone, adopting lesson 004 or later while the factory is still tetris/.factory first moves it to factory/, as fetch.sh does. Use it instead of fetch-iteration or fetch.sh. Does not commit. A coach thread adopts only its own lesson.",
    label: { pending: "Adopting the lesson", completed: "Adopted the lesson" },
    // Adopting makes the caller's lesson the current one, so it checks the lesson itself.
    lesson: "any",
    needsLayout: false,
    action: (state, input, caller, now) => {
      const other = adoptionByOtherError(state, input, caller);
      return other === null ? adoptAction(state, input, now) : { error: other };
    },
  });
  register(rt, {
    name: TOOL_NAMES.completeIteration,
    description:
      "Finish the current lesson: write ITERATION as Done and store your two- or three-sentence summary for the student. Returns a ::tutor-progress card to echo.",
    label: { pending: "Completing the lesson", completed: "Completed the lesson" },
    lesson: "current",
    needsLayout: true,
    action: (state, input) => completeAction(state, input),
  });
  register(rt, {
    name: TOOL_NAMES.sideChat,
    description:
      "Move a side question into a BB side chat of this lesson's coach thread, optionally about one Rule, so the coach thread stays on its Rule. It opens as the \"Side chat\" tab in the coach thread's right panel and shares the working tree.",
    label: { pending: "Starting a side chat", completed: "Started a side chat" },
    lesson: "any",
    needsLayout: false,
    action: (state, input, caller) => sideChat(rt, state, input, caller),
  });
  register(rt, {
    name: TOOL_NAMES.fetchCourse,
    description:
      "Add a course the student asked for: fetch it, put its starter files in the workspace (only files that aren't there yet; the student's own are kept), and list its lessons after Lesson 0 in the outline. Calling it again finishes a setup that was interrupted. Does not commit: tell the student to commit the starter before its first lesson.",
    label: { pending: "Adding the course", completed: "Added the course" },
    // Any coach thread can add a course, whatever lesson it coaches; it touches no lesson's progress.
    lesson: "any",
    needsLayout: false,
    action: async (_state, input, _caller, _now, world) => {
      try {
        return { text: addedCourseText(await addCourse(rt, world, input.course)) };
      } catch (cause) {
        if (cause instanceof WorkspaceUnreachableError || cause instanceof WriteConflictError) throw cause;
        return { error: cause instanceof Error ? cause.message : String(cause) };
      }
    },
  });
}
