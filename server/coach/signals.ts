// The "state-changed" realtime signal. Frontends refetch on it; the payload
// is a hint, not data.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { REALTIME_CHANNELS } from "../../shared/constants.ts";
import type { StateChangedSignal } from "../../shared/rpc.ts";
import type { World } from "./world.ts";

export interface StateSignals {
  publish(reason: StateChangedSignal["reason"], lessonId: string | null): void;
  /**
   * Remembers what the factory looked like and publishes when it differs from
   * last time. With `publishIfUnseen`, a first look publishes too.
   */
  observe(world: World, options?: { publishIfUnseen?: boolean }): void;
}

type Fingerprint = Map<string, { iteration: string; progress: string; lessonId: string }>;

/** Each course's ITERATION and progress, by course id. */
function fingerprint(world: World): Fingerprint {
  return new Map(
    world.courses.map((entry) => [
      entry.course.id,
      { iteration: JSON.stringify(entry.student.iteration), progress: JSON.stringify(entry.student.progress), lessonId: entry.pointer.lessonId },
    ]),
  );
}

/** What changed since last time, and in which course's lesson: the first course that changed. */
function changeOf(previous: Fingerprint, next: Fingerprint): { reason: "iteration" | "progress"; lessonId: string | null } | null {
  for (const [courseId, now] of next) {
    const before = previous.get(courseId);
    if (before === undefined || before.iteration !== now.iteration) return { reason: "iteration", lessonId: now.lessonId };
    if (before.progress !== now.progress) return { reason: "progress", lessonId: now.lessonId };
  }
  return null;
}

export function createStateSignals(bb: BbPluginApi): StateSignals {
  const seen = new Map<string, Fingerprint>();
  const publish = (reason: StateChangedSignal["reason"], lessonId: string | null) => {
    const payload: StateChangedSignal = { reason, lessonId };
    bb.realtime.publish(REALTIME_CHANNELS.stateChanged, payload);
  };
  return {
    publish,
    observe(world, options = {}) {
      if (world.workspace.status !== "found") return;
      const next = fingerprint(world);
      const previous = seen.get(world.workspace.root);
      seen.set(world.workspace.root, next);
      if (previous === undefined) {
        if (options.publishIfUnseen === true) publish("progress", world.courses[0]?.pointer.lessonId ?? null);
        return;
      }
      const change = changeOf(previous, next);
      if (change !== null) publish(change.reason, change.lessonId);
    },
  };
}
