// The server's typed client for the plugin's own host entry (host.ts) on a machine.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  hostContract,
  type AdoptLessonInput,
  type AdoptLessonOutput,
  type InspectInput,
  type InspectOutput,
  type SeedWorkspaceInput,
  type SeedWorkspaceOutput,
} from "../../host/contract.ts";
import { WriteConflictError } from "./access.ts";
import { onMachine } from "./machine-access.ts";

/** adoptLesson's git mv and copies can pass the default 30 seconds on a slow disk. */
export const ADOPT_TIMEOUT_MS = 120_000;

export interface TutorHostClient {
  inspect(hostId: string, input: InspectInput): Promise<InspectOutput>;
  /**
   * Adopts a capstone lesson on the machine, as one operation. Throws
   * WriteConflictError when the progress file changed since the server read
   * it (nothing written), WorkspaceUnreachableError when the machine is not
   * connected, and the host's refusal otherwise.
   */
  adoptLesson(hostId: string, input: AdoptLessonInput): Promise<AdoptLessonOutput>;
  /**
   * Seeds a workspace from a course's starter bundle on the machine,
   * resumably (host/seed.ts). `timeoutMs` is the caller's: a starter's files
   * can be many and large, so Tutor's own call (Task 13) passes longer than
   * the default. Throws WorkspaceUnreachableError when the machine is not
   * connected, and the host's refusal otherwise.
   */
  seedWorkspace(hostId: string, input: SeedWorkspaceInput, options: { timeoutMs: number }): Promise<SeedWorkspaceOutput>;
}

export function createHostClient(bb: BbPluginApi): TutorHostClient {
  const client = bb.hosts.experimental_client({ contract: hostContract });
  return {
    inspect: (hostId, input) => client.call("inspect", input, { hostId }),
    async adoptLesson(hostId, input) {
      const output = await onMachine(() => client.call("adoptLesson", input, { hostId, timeoutMs: ADOPT_TIMEOUT_MS }));
      if ("conflict" in output) throw new WriteConflictError("The progress file changed since Tutor read it.");
      return output;
    },
    seedWorkspace: (hostId, input, options) => onMachine(() => client.call("seedWorkspace", input, { hostId, timeoutMs: options.timeoutMs })),
  };
}
