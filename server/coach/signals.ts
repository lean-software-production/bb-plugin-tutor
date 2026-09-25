// The "state-changed" realtime signal. Frontends refetch on it; the payload
// is a hint, not data.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { REALTIME_CHANNELS } from "../../shared/constants.ts";
import type { StateChangedSignal } from "../../shared/rpc.ts";
import type { World } from "./world.ts";

export interface StateSignals {
  publish(reason: StateChangedSignal["reason"], homeworkId: string | null): void;
  /**
   * Remembers what the factory looked like and publishes when it differs from
   * last time. With `publishIfUnseen`, a first look publishes too.
   */
  observe(world: World, options?: { publishIfUnseen?: boolean }): void;
}

function fingerprint(world: World): { iteration: string; progress: string } {
  return { iteration: JSON.stringify(world.student.iteration), progress: JSON.stringify(world.student.progress) };
}

export function createStateSignals(bb: BbPluginApi): StateSignals {
  const seen = new Map<string, { iteration: string; progress: string }>();
  const publish = (reason: StateChangedSignal["reason"], homeworkId: string | null) => {
    const payload: StateChangedSignal = { reason, homeworkId };
    bb.realtime.publish(REALTIME_CHANNELS.stateChanged, payload);
  };
  return {
    publish,
    observe(world, options = {}) {
      if (world.binding.status !== "bound") return;
      const next = fingerprint(world);
      const previous = seen.get(world.binding.root);
      seen.set(world.binding.root, next);
      const homeworkId = world.pointer?.homeworkId ?? null;
      if (previous === undefined) {
        if (options.publishIfUnseen === true) publish("progress", homeworkId);
      } else if (previous.iteration !== next.iteration) {
        publish("iteration", homeworkId);
      } else if (previous.progress !== next.progress) {
        publish("progress", homeworkId);
      }
    },
  };
}
