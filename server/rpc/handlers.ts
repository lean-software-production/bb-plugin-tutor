// The RPC contract in shared/rpc.ts, served from the re-derived world. Every
// handler fails by throwing an Error written for the student.
import { withoutLeadingDirectives } from "../../shared/directives.ts";
import { rpcContract } from "../../shared/rpc.ts";
import type { Binding } from "../../shared/rpc.ts";
import { findLesson, findRule, lessonStatus } from "../../shared/derive.ts";
import type { Course, Lesson, Rule } from "../../shared/model.ts";
import { adoptionTargets } from "../coach/actions.ts";
import { coachThreadOf } from "../coach/auth.ts";
import { resolveFactory } from "../coach/binding.ts";
import { mainThreadLockKey } from "../coach/lock-keys.ts";
import type { FactoryLocation } from "../coach/threads.ts";
import {
  mainThreadPrompt,
  redirectMessage,
  sideChatAnchor,
  sideChatSeed,
  sideChatTitle,
  type MainThreadStart,
} from "../coach/prompts.ts";
import type { TutorRuntime } from "../coach/runtime.ts";
import { BB_REPLY_PREFIX, ensureSideChatTab, forkSideChat, listSideChats } from "../coach/side-chats.ts";
import {
  findMainThread,
  listTutorThreads,
  spawnMainThread,
  toTutorThread,
  type TutorThreadRecord,
} from "../coach/threads.ts";
import type { World } from "../coach/world.ts";
import { overlaps, realPath } from "../paths.ts";
import { listCandidates } from "./candidates.ts";
import { buildCompletion, buildLessonDetail, buildOverview, publicThread, requireCourse, requireLesson } from "./views.ts";

type Bound = Extract<Binding, { status: "bound" }>;

interface BoundFactory extends Bound {
  location: FactoryLocation;
}

function requireBound(world: World): BoundFactory {
  if (world.binding.status === "bound" && world.factoryHostId !== null) {
    return { ...world.binding, location: { root: world.binding.root, hostId: world.factoryHostId } };
  }
  throw new Error(
    world.binding.status === "missing"
      ? "The factory project Tutor was set up with has gone. Pick it again on the Course page."
      : "No factory project is set up yet. Confirm it on the Course page.",
  );
}

function requireRule(lesson: Lesson, ruleKey: string): Rule {
  const rule = findRule(lesson, ruleKey);
  if (rule === undefined) throw new Error(`Lesson ${lesson.id} has no Rule ${ruleKey}.`);
  return rule;
}


export function registerRpc(rt: TutorRuntime): void {
  const { bb } = rt;

  async function loadWorld(): Promise<World> {
    const world = await rt.world.load();
    rt.signals.observe(world);
    return world;
  }

  async function threadsOf(world: World): Promise<TutorThreadRecord[]> {
    if (world.binding.status !== "bound") return [];
    const threads = await listTutorThreads(bb.sdk, bb.pluginId, world.binding.projectId);
    rt.coaches.remember(threads);
    return threads;
  }

  /**
   * Side chats BB made ("Reply in side chat") of the coach threads, as Tutor
   * lists its own: side chats of their lesson, about no Rule in particular.
   */
  async function bbSideChatsOf(threads: readonly TutorThreadRecord[]): Promise<TutorThreadRecord[]> {
    const mains = threads.filter((thread) => thread.role === "main");
    const lists = await Promise.all(mains.map((main) => listSideChats(bb.sdk, main.id).catch(() => [])));
    return mains.flatMap((main, index) =>
      (lists[index] ?? [])
        .filter((row) => row.originPluginId !== bb.pluginId && row.projectId === main.projectId)
        .map((row) => ({
          id: row.id,
          lessonId: main.lessonId,
          role: "side" as const,
          ruleKey: null,
          title: row.title ?? (withoutLeadingDirectives((row.titleFallback ?? "").replace(BB_REPLY_PREFIX, "")) || null),
          mainThreadId: main.id,
          sideChat: true,
          courseId: main.courseId,
          projectId: row.projectId,
          createdAt: row.createdAt,
          reachedRules: [],
        })),
    );
  }

  async function spawnMain(course: Course, binding: BoundFactory, lesson: Lesson, prompt: string): Promise<string> {
    const threadId = await spawnMainThread(bb.sdk, {
      projectId: binding.projectId,
      factory: binding.location,
      courseId: course.id,
      lessonId: lesson.id,
      prompt,
    });
    rt.coaches.remember([{ id: threadId, role: "main", lessonId: lesson.id }]);
    rt.signals.publish("threads", lesson.id);
    return threadId;
  }

  /**
   * The lesson's main coach thread, spawned with `prompt` when there is none.
   * One caller at a time per lesson, re-listing once it has the lock, so two
   * clicks (or two tabs) never spawn two main coaches.
   */
  async function findOrSpawnMain(
    course: Course,
    binding: BoundFactory,
    lesson: Lesson,
    prompt: () => string,
  ): Promise<{ threadId: string; created: boolean }> {
    return rt.locks.run(mainThreadLockKey(binding.projectId, course.id, lesson.id), async () => {
      const threads = await listTutorThreads(bb.sdk, bb.pluginId, binding.projectId);
      const existing = findMainThread(threads, course.id, lesson.id);
      if (existing !== undefined) return { threadId: existing.id, created: false };
      return { threadId: await spawnMain(course, binding, lesson, prompt()), created: true };
    });
  }

  function startFor(world: World, course: Course, lesson: Lesson): MainThreadStart {
    const pointer = world.pointer;
    if (pointer === null || lessonStatus(course, pointer, lesson.id) === "done") return "revisit";
    return pointer.iterationStatus === "not-started" ? "adopt" : "resume";
  }

  bb.rpc.register(rpcContract, {
    getOverview: async () => {
      const world = await loadWorld();
      const threads = await threadsOf(world);
      return buildOverview(world, [...threads, ...(await bbSideChatsOf(threads))]);
    },

    getLessonDetail: async ({ lessonId }) => {
      const world = await loadWorld();
      return buildLessonDetail(world, lessonId, await threadsOf(world));
    },

    getCompletion: async ({ lessonId }) => {
      const world = await loadWorld();
      const threads = await threadsOf(world);
      const main = world.course === null ? undefined : findMainThread(threads, world.course.id, lessonId);
      // Side chats BB made ("Reply in side chat") are not Tutor's threads, so count them apart.
      const bbSideChats =
        main === undefined ? 0 : (await listSideChats(bb.sdk, main.id)).filter((row) => row.originPluginId !== bb.pluginId).length;
      return buildCompletion(world, lessonId, threads, bbSideChats);
    },

    getThreadContext: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId }).catch(() => null);
      if (thread === null) return { thread: null };
      if (thread.originPluginId === bb.pluginId) {
        const metadata = await bb.sdk.threads.getPluginMetadata({ threadId }).catch(() => null);
        const record = toTutorThread(thread, metadata);
        return { thread: record === null ? null : publicThread(record) };
      }
      // A side chat BB made of a coach thread: a side chat of its lesson, about no Rule in particular.
      const main = await coachThreadOf(bb.sdk, bb.pluginId, thread);
      if (main === null || main.id === thread.id) return { thread: null };
      const coach = toTutorThread(main, await bb.sdk.threads.getPluginMetadata({ threadId: main.id }).catch(() => null));
      if (coach === null) return { thread: null };
      return {
        thread: {
          id: thread.id,
          lessonId: coach.lessonId,
          role: "side" as const,
          ruleKey: null,
          title: thread.title,
          mainThreadId: main.id,
          sideChat: true,
        },
      };
    },

    getLexicon: async () => {
      const world = await rt.world.load();
      return { entries: world.course?.lexicon ?? [] };
    },

    listCandidateProjects: async () => {
      const world = await rt.world.load();
      return {
        projects: await listCandidates(bb.sdk, world.coursePath, world.course?.coachPath ?? null, world.factoryHint),
      };
    },

    confirmFactory: async ({ projectId }) => {
      const { binding } = await resolveFactory(bb.sdk, projectId);
      if (binding.status !== "bound") {
        throw new Error("That project has no folder on this machine, so Tutor cannot coach in it.");
      }
      // The coach writes spec/ and seeds/ into the factory, so it must never be the course checkout.
      const { coursePath } = await rt.world.load();
      if (overlaps(await realPath(binding.root), await realPath(coursePath))) {
        throw new Error("That project's folder is, or shares a folder with, the course. Pick the repo you build your factory in.");
      }
      // settings.onChange publishes the binding signal.
      await rt.settings.experimental_set({ factoryProject: projectId });
      return binding;
    },

    openCoach: async ({ lessonId }) => {
      const world = await loadWorld();
      const course = requireCourse(world);
      const binding = requireBound(world);
      const lesson = requireLesson(course, lessonId);
      if (world.pointer === null || lessonStatus(course, world.pointer, lesson.id) === "ahead") {
        throw new Error(`Lesson ${lesson.id} has not started yet.`);
      }
      return findOrSpawnMain(course, binding, lesson, () => mainThreadPrompt(course, lesson, startFor(world, course, lesson)));
    },

    startNextLesson: async ({ lessonId }) => {
      const world = await loadWorld();
      const course = requireCourse(world);
      const binding = requireBound(world);
      const lesson = requireLesson(course, lessonId);
      if (lesson.builtin || world.pointer === null || !adoptionTargets(course, world.pointer).includes(lesson.id)) {
        throw new Error(`Lesson ${lesson.id} cannot be started yet: finish the lesson before it first.`);
      }
      const { threadId } = await findOrSpawnMain(course, binding, lesson, () => mainThreadPrompt(course, lesson, "adopt"));
      return { threadId };
    },

    startSideThread: async ({ lessonId, ruleKey }) => {
      const world = await loadWorld();
      const course = requireCourse(world);
      requireBound(world);
      const lesson = requireLesson(course, lessonId);
      const rule = ruleKey === null ? null : requireRule(lesson, ruleKey);
      const main = findMainThread(await threadsOf(world), course.id, lesson.id);
      if (main === undefined) throw new Error(`Start with your coach for lesson ${lesson.id} first.`);
      const sideChatId = await forkSideChat(bb.sdk, {
        coachThreadId: main.id,
        courseId: course.id,
        lessonId: lesson.id,
        ruleKey: rule?.key ?? null,
        title: sideChatTitle(rule),
        seed: sideChatSeed(lesson, rule),
      });
      await ensureSideChatTab(bb.sdk, main.id, sideChatId, sideChatAnchor(lesson, rule));
      rt.signals.publish("threads", lesson.id);
      return { coachThreadId: main.id, sideChatId };
    },

    ensureSideChatTab: async ({ sideChatId }) => {
      const world = await loadWorld();
      const binding = requireBound(world);
      const thread = await bb.sdk.threads.get({ threadId: sideChatId }).catch(() => null);
      const main = thread === null ? null : await coachThreadOf(bb.sdk, bb.pluginId, thread);
      if (thread === null || main === null || main.id === thread.id || thread.originKind !== "fork" || main.projectId !== binding.projectId) {
        throw new Error("That side chat is gone, or it isn't a side chat of one of your coach threads.");
      }
      const metadata = thread.originPluginId === bb.pluginId ? await bb.sdk.threads.getPluginMetadata({ threadId: thread.id }).catch(() => null) : null;
      const record = metadata === null ? null : toTutorThread(thread, metadata);
      const lesson = record === null || world.course === null ? undefined : findLesson(world.course, record.lessonId);
      const ruleKey = record?.ruleKey ?? null;
      const rule = lesson === undefined || ruleKey === null ? null : (findRule(lesson, ruleKey) ?? null);
      const anchor =
        lesson !== undefined
          ? sideChatAnchor(lesson, rule)
          : (thread.titleFallback ?? thread.title ?? "A side question").replace(BB_REPLY_PREFIX, "");
      await ensureSideChatTab(bb.sdk, main.id, thread.id, anchor);
      return { coachThreadId: main.id };
    },

    redirectFocus: async ({ lessonId, ruleKey }) => {
      const world = await loadWorld();
      const course = requireCourse(world);
      const binding = requireBound(world);
      const lesson = requireLesson(course, lessonId);
      if (world.pointer === null || lessonStatus(course, world.pointer, lesson.id) !== "current") {
        throw new Error("You can only choose the next Rule in the lesson you are on.");
      }
      const rule = requireRule(lesson, ruleKey);
      const main = await findOrSpawnMain(course, binding, lesson, () =>
        mainThreadPrompt(course, lesson, startFor(world, course, lesson), rule),
      );
      if (main.created) return { threadId: main.threadId };
      await bb.sdk.threads.send({
        threadId: main.threadId,
        input: [{ type: "text", text: redirectMessage(rule), mentions: [] }],
        mode: "queue-if-active",
      });
      return { threadId: main.threadId };
    },

    heartbeat: async () => {
      try {
        return await rt.activity.record();
      } catch (cause) {
        // A missed stamp only risks an idle stop; never an error the student sees.
        bb.log.warn(`[tutor] could not record activity: ${cause instanceof Error ? cause.message : String(cause)}`);
        return { recorded: false };
      }
    },
  });
}
