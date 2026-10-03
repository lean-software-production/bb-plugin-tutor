// The server's typed client for the plugin's own host entry (host.ts) on a machine.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, type InspectInput, type InspectOutput } from "../../host/contract.ts";

export interface TutorHostClient {
  inspect(hostId: string, input: InspectInput): Promise<InspectOutput>;
}

export function createHostClient(bb: BbPluginApi): TutorHostClient {
  const client = bb.hosts.experimental_client({ contract: hostContract });
  return {
    inspect: (hostId, input) => client.call("inspect", input, { hostId }),
  };
}
