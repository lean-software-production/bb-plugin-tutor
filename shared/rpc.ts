// The RPC contract between the frontend (app/) and the backend (server/rpc/).
// The backend registers it with `bb.rpc.register(rpcContract, handlers)`; the
// frontend calls it with `useRpc<typeof rpcContract>()` and must import this
// module with `import type` only.
//
// Handlers fail by throwing an Error whose message is shown to the student
// as-is, so write it for them ("No factory project is set up yet.").
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  diffLineSchema,
  exampleCountsSchema,
  exampleKeySchema,
  exampleProgressSchema,
  homeworkIdSchema,
  homeworkSchema,
  homeworkStatusSchema,
  iterationProgressSchema,
  lexiconEntrySchema,
  noveltySchema,
  ruleKeySchema,
  ruleStatusSchema,
  threadIdSchema,
} from "./model.ts";

// ---------------------------------------------------------------------------
// Payload pieces
// ---------------------------------------------------------------------------

/**
 * A thread Tutor spawned or forked, as the backend knows it (live status comes
 * from useSidebarThreads). `main` is the homework's coach thread. `side` is a
 * side chat, a hidden fork of it shown in its right panel, or a side thread
 * spawned under it before side chats existed.
 */
export const tutorThreadSchema = z.object({
  id: threadIdSchema,
  homeworkId: homeworkIdSchema,
  role: z.enum(["main", "side"]),
  ruleKey: ruleKeySchema.nullable(),
  title: z.string().nullable(),
  /** The coach thread it belongs to; itself for a coach thread. */
  mainThreadId: threadIdSchema,
  /** A side chat (a hidden fork, in the coach thread's right panel), not a thread of its own. */
  sideChat: z.boolean(),
});
export type TutorThread = z.infer<typeof tutorThreadSchema>;

export const bindingSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unbound") }),
  z.object({
    status: z.literal("bound"),
    projectId: z.string(),
    projectName: z.string(),
    /** Absolute path of the project's default local source. */
    root: z.string(),
  }),
  /** The factoryProject setting names a project that is gone or has no local source. */
  z.object({ status: z.literal("missing"), projectId: z.string() }),
]);
export type Binding = z.infer<typeof bindingSchema>;

export const courseInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
});
export type CourseInfo = z.infer<typeof courseInfoSchema>;

export const ruleOutlineSchema = z.object({
  key: ruleKeySchema,
  name: z.string(),
  novelty: noveltySchema,
  status: ruleStatusSchema,
  isFocus: z.boolean(),
  counts: exampleCountsSchema,
  /** Latest `at` among its Examples' progress entries. */
  lastAt: z.string().nullable(),
  /** The coach has focused it in the homework's coach thread, so its section there can be jumped to. */
  reached: z.boolean(),
});
export type RuleOutline = z.infer<typeof ruleOutlineSchema>;

export const featureOutlineSchema = z.object({
  slug: z.string(),
  name: z.string(),
  path: z.string(),
  novelty: noveltySchema,
  counts: exampleCountsSchema,
  rules: z.array(ruleOutlineSchema),
});
export type FeatureOutline = z.infer<typeof featureOutlineSchema>;

export const homeworkSummarySchema = z.object({
  id: homeworkIdSchema,
  title: z.string(),
  set: z.string().nullable(),
  builtin: z.boolean(),
  status: homeworkStatusSchema,
  /** Recorded progress: the current homework's, a done one's history entry, else all pending. */
  counts: exampleCountsSchema,
  /** The homework's main coach thread, or null before it has one. */
  coachThreadId: threadIdSchema.nullable(),
  /** Its features and Rules, for the course outline. */
  outline: z.array(featureOutlineSchema),
});
export type HomeworkSummary = z.infer<typeof homeworkSummarySchema>;

export const lastNoteSchema = z.object({
  exampleKey: exampleKeySchema,
  exampleName: z.string(),
  note: z.string(),
  at: z.string(),
});

export const currentStateSchema = z.object({
  homeworkId: homeworkIdSchema,
  iterationStatus: iterationProgressSchema,
  focus: ruleKeySchema.nullable(),
  focusRuleName: z.string().nullable(),
  counts: exampleCountsSchema,
  outline: z.array(featureOutlineSchema),
  coachThreadId: threadIdSchema.nullable(),
  /** The most recent not-yet note, for "Last time: …" on BB home. */
  lastNote: lastNoteSchema.nullable(),
});
export type CurrentState = z.infer<typeof currentStateSchema>;

/** Everything the rail, the home section and the first-run page need in one call. */
export const overviewSchema = z.object({
  course: courseInfoSchema.nullable(),
  /** Why the course could not be loaded (course is then null). */
  courseError: z.string().nullable(),
  binding: bindingSchema,
  homeworks: z.array(homeworkSummarySchema),
  /** Null while the course is missing or the factory is not bound. */
  current: currentStateSchema.nullable(),
  threads: z.array(tutorThreadSchema),
});
export type Overview = z.infer<typeof overviewSchema>;

export const lessonSchema = z.object({
  homework: homeworkSchema,
  status: homeworkStatusSchema,
  /** The student's iteration status when this is the current homework, else null. */
  iterationStatus: iterationProgressSchema.nullable(),
  focus: ruleKeySchema.nullable(),
  /**
   * Recorded progress: the current PROGRESS.yaml, or its `history` entry for a done homework.
   * Empty for homeworks ahead (a preview) and for done homeworks finished before history was kept.
   */
  progress: z.record(exampleKeySchema, exampleProgressSchema),
  coachThreadId: threadIdSchema.nullable(),
  /** Rules the coach has focused in that thread: their sections can be jumped to. */
  reachedRules: z.array(ruleKeySchema),
});
export type Lesson = z.infer<typeof lessonSchema>;

export const completionSchema = z.object({
  homework: z.object({ id: homeworkIdSchema, title: z.string(), set: z.string().nullable() }),
  counts: exampleCountsSchema,
  /** Rules whose novelty is not unchanged. */
  freshRules: z.number().int().nonnegative(),
  /** Side chats (and older side threads) of the homework's coach thread. */
  sideThreads: z.number().int().nonnegative(),
  adoptedAt: z.string().nullable(),
  summary: z.string().nullable(),
  next: z
    .object({
      id: homeworkIdSchema,
      /** "ahead" until the student starts it; then the page continues it instead. */
      status: homeworkStatusSchema,
      title: z.string(),
      set: z.string().nullable(),
      dek: z.string(),
      rules: z.number().int().nonnegative(),
      examples: z.number().int().nonnegative(),
      /** Examples whose hash matches one the student has passing now. */
      carryOver: z.number().int().nonnegative(),
      fresh: z.number().int().nonnegative(),
      factoryDiff: z.array(diffLineSchema).nullable(),
    })
    .nullable(),
});
export type Completion = z.infer<typeof completionSchema>;

export const candidateProjectSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  root: z.string().nullable(),
  /** Looks like a factory repo (has spec/ITERATION, or an AGENTS.md naming the course). */
  qualifies: z.boolean(),
  /** One line for the picker: "spec/ITERATION · 001 WIP", "no spec/ITERATION". */
  detail: z.string(),
});
export type CandidateProject = z.infer<typeof candidateProjectSchema>;

/** Payload of the REALTIME_CHANNELS.stateChanged signal. */
export const stateChangedSignalSchema = z.object({
  reason: z.enum(["progress", "iteration", "binding", "threads", "course"]),
  homeworkId: homeworkIdSchema.nullable(),
});
export type StateChangedSignal = z.infer<typeof stateChangedSignalSchema>;

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

const homeworkInput = z.object({ homeworkId: homeworkIdSchema });

export const rpcContract = defineRpcContract({
  getOverview: {
    input: z.null(),
    output: overviewSchema,
  },
  getLesson: {
    input: homeworkInput,
    output: lessonSchema,
  },
  /** Between homeworks (screen 7). Fails unless the homework is done. */
  getCompletion: {
    input: homeworkInput,
    output: completionSchema,
  },
  /** For the rule tab: null unless the thread is Tutor's, or a side chat BB made of a coach thread. */
  getThreadContext: {
    input: z.object({ threadId: threadIdSchema }),
    output: z.object({ thread: tutorThreadSchema.nullable() }),
  },
  getLexicon: {
    input: z.null(),
    output: z.object({ entries: z.array(lexiconEntrySchema) }),
  },
  listCandidateProjects: {
    input: z.null(),
    output: z.object({ projects: z.array(candidateProjectSchema) }),
  },
  /** Stores the factoryProject setting. Never creates a project. */
  confirmFactory: {
    input: z.object({ projectId: z.string().min(1).max(128) }),
    output: bindingSchema,
  },
  /** Finds the homework's main coach thread, or spawns it. Current or done homeworks only. */
  openCoach: {
    input: homeworkInput,
    output: z.object({ threadId: threadIdSchema, created: z.boolean() }),
  },
  /**
   * Spawns the main thread for the homework after a Done one; its first turn
   * adopts the spec (tutor_adopt_iteration). Fails for any other homework.
   */
  startNextHomework: {
    input: homeworkInput,
    output: z.object({ threadId: threadIdSchema }),
  },
  /**
   * A BB side chat of the homework's main coach thread, optionally about one
   * Rule: a hidden fork, plus BB's "Side chat" tab in the coach thread's right
   * panel. A plugin cannot select that tab, so the frontend points to it.
   */
  startSideThread: {
    input: z.object({ homeworkId: homeworkIdSchema, ruleKey: ruleKeySchema.nullable() }),
    output: z.object({ coachThreadId: threadIdSchema, sideChatId: threadIdSchema }),
  },
  /**
   * Puts a side chat's tab back in its coach thread's right panel if it was
   * closed. The side chat must be a hidden fork of a Tutor main coach thread
   * (Tutor's, or one BB made with "Reply in side chat").
   */
  ensureSideChatTab: {
    input: z.object({ sideChatId: threadIdSchema }),
    output: z.object({ coachThreadId: threadIdSchema }),
  },
  /**
   * The student asked for a Rule (the Rule tab's "Work on this Rule next"):
   * send the main coach thread a message asking to move there. The coach
   * moves the focus (tutor_focus_rule), not the UI.
   */
  redirectFocus: {
    input: z.object({ homeworkId: homeworkIdSchema, ruleKey: ruleKeySchema }),
    output: z.object({ threadId: threadIdSchema }),
  },
  /**
   * The student is using BB (app/activity.ts). Stamps the tutor feature's
   * activity file, at most every 30 s; `recorded` is false when throttled or
   * when BB's data dir is unknown.
   */
  heartbeat: {
    input: z.null(),
    output: z.object({ recorded: z.boolean() }),
  },
});
export type RpcContract = typeof rpcContract;
