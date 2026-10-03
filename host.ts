// bb-plugin-tutor host entry: what the server half asks of the student's
// machine, run there by BB's host daemon. Declared as `bb.host` in package.json.
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { adoptIntoWorkspace, ProgressConflictError } from "./layouts/capstone-factory/adopt.ts";
import { hostContract } from "./host/contract.ts";
import { inspect, localProbe } from "./host/inspect.ts";
import { createHostLock } from "./host/lock.ts";

/** One adoption of a workspace at a time, keyed on its real folder. */
const adoptions = createHostLock();

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    inspect: (input) => inspect(input),
    adoptLesson: async (input) => {
      const key = await realpath(input.root).catch(() => resolve(input.root));
      return adoptions.run(key, async () => {
        try {
          return await adoptIntoWorkspace(input, localProbe);
        } catch (cause) {
          // Not an error: the server reads the workspace again and adopts once more.
          if (cause instanceof ProgressConflictError) return { conflict: true as const };
          throw cause;
        }
      });
    },
    // seedWorkspace: Task 11
  },
});
