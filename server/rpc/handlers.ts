// The RPC contract in shared/rpc.ts, served from the re-derived world. Every
// handler fails by throwing an Error written for the student.
import { rpcContract } from "../../shared/rpc.ts";
import type { Binding } from "../../shared/rpc.ts";
import { findRule, homeworkStatus } from "../../shared/derive.ts";
import type { Course, Homework, Rule } from "../../shared/model.ts";
import { adoptionTargets } from "../coach/actions.ts";
import { resolveFactory } from "../coach/binding.ts";
import type { FactoryLocation } from "../coach/threads.ts";
import { mainThreadPrompt, redirectMessage, sideThreadPrompt, sideThreadTitle, type MainThreadStart } from "../coach/prompts.ts";
import type { TutorRuntime } from "../coach/runtime.ts";
import {
  findMainThread,
  listTutorThreads,
  spawnMainThread,
  spawnSideThread,
  toTutorThread,
  type TutorThreadRecord,
} from "../coach/threads.ts";
import type { World } from "../coach/world.ts";
import { listCandidates } from "./candidates.ts";
import { buildCompletion, buildLesson, buildOverview, publicThread, requireCourse, requireHomework } from "./views.ts";

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

function requireRule(homework: Homework, ruleKey: string): Rule {
  const rule = findRule(homework, ruleKey);
  if (rule === undefined) throw new Error(`Homework ${homework.id} has no Rule ${ruleKey}.`);
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
    return world.binding.status === "bound" ? listTutorThreads(bb.sdk, bb.pluginId, world.binding.projectId) : [];
  }

  async function spawnMain(course: Course, binding: BoundFactory, homework: Homework, prompt: string): Promise<string> {
    const threadId = await spawnMainThread(bb.sdk, {
      projectId: binding.projectId,
      factory: binding.location,
      courseId: course.id,
      homeworkId: homework.id,
      prompt,
    });
    rt.signals.publish("threads", homework.id);
    return threadId;
  }

  function startFor(world: World, course: Course, homework: Homework): MainThreadStart {
    const pointer = world.pointer;
    if (pointer === null || homeworkStatus(course, pointer, homework.id) === "done") return "revisit";
    return pointer.iterationStatus === "not-started" ? "adopt" : "resume";
  }

  bb.rpc.register(rpcContract, {
    getOverview: async () => {
      const world = await loadWorld();
      return buildOverview(world, await threadsOf(world));
    },

    getLesson: async ({ homeworkId }) => {
      const world = await loadWorld();
      return buildLesson(world, homeworkId, await threadsOf(world));
    },

    getCompletion: async ({ homeworkId }) => {
      const world = await loadWorld();
      return buildCompletion(world, homeworkId, await threadsOf(world));
    },

    getThreadContext: async ({ threadId }) => {
      const thread = await bb.sdk.threads.get({ threadId }).catch(() => null);
      if (thread === null || thread.originPluginId !== bb.pluginId) return { thread: null };
      const metadata = await bb.sdk.threads.getPluginMetadata({ threadId }).catch(() => null);
      const record = toTutorThread(thread, metadata);
      return { thread: record === null ? null : publicThread(record) };
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
      // settings.onChange publishes the binding signal.
      await rt.settings.experimental_set({ factoryProject: projectId });
      return binding;
    },

    openCoach: async ({ homeworkId }) => {
      const world = await loadWorld();
      const course = requireCourse(world);
      const binding = requireBound(world);
      const homework = requireHomework(course, homeworkId);
      if (world.pointer === null || homeworkStatus(course, world.pointer, homework.id) === "ahead") {
        throw new Error(`Homework ${homework.id} has not started yet.`);
      }
      const existing = findMainThread(await threadsOf(world), course.id, homework.id);
      if (existing !== undefined) return { threadId: existing.id, created: false };
      const prompt = mainThreadPrompt(course, homework, startFor(world, course, homework));
      return { threadId: await spawnMain(course, binding, homework, prompt), created: true };
    },

    startNextHomework: async ({ homeworkId }) => {
      const world = await loadWorld();
      const course = requireCourse(world);
      const binding = requireBound(world);
      const homework = requireHomework(course, homeworkId);
      if (homework.builtin || world.pointer === null || !adoptionTargets(course, world.pointer).includes(homework.id)) {
        throw new Error(`Homework ${homework.id} cannot be started yet: finish the homework before it first.`);
      }
      const existing = findMainThread(await threadsOf(world), course.id, homework.id);
      if (existing !== undefined) return { threadId: existing.id };
      return { threadId: await spawnMain(course, binding, homework, mainThreadPrompt(course, homework, "adopt")) };
    },

    startSideThread: async ({ homeworkId, ruleKey, title }) => {
      const world = await loadWorld();
      const course = requireCourse(world);
      const binding = requireBound(world);
      const homework = requireHomework(course, homeworkId);
      const rule = ruleKey === null ? null : requireRule(homework, ruleKey);
      const main = findMainThread(await threadsOf(world), course.id, homework.id);
      if (main === undefined) throw new Error(`Open the coach for homework ${homework.id} first.`);
      const threadId = await spawnSideThread(bb.sdk, {
        projectId: binding.projectId,
        factory: binding.location,
        courseId: course.id,
        homeworkId: homework.id,
        parentThreadId: main.id,
        ruleKey: rule?.key ?? null,
        title: title ?? sideThreadTitle(homework, rule),
        prompt: sideThreadPrompt(homework, rule),
      });
      rt.signals.publish("threads", homework.id);
      return { threadId };
    },

    redirectFocus: async ({ homeworkId, ruleKey }) => {
      const world = await loadWorld();
      const course = requireCourse(world);
      const binding = requireBound(world);
      const homework = requireHomework(course, homeworkId);
      if (world.pointer === null || homeworkStatus(course, world.pointer, homework.id) !== "current") {
        throw new Error("You can only choose the next Rule in the homework you are on.");
      }
      const rule = requireRule(homework, ruleKey);
      const main = findMainThread(await threadsOf(world), course.id, homework.id);
      if (main === undefined) {
        const prompt = mainThreadPrompt(course, homework, startFor(world, course, homework), rule);
        return { threadId: await spawnMain(course, binding, homework, prompt) };
      }
      await bb.sdk.threads.send({
        threadId: main.id,
        input: [{ type: "text", text: redirectMessage(rule), mentions: [] }],
        mode: "queue-if-active",
      });
      return { threadId: main.id };
    },
  });
}
