// bb-plugin-tutor backend entry. The wiring lives in server/coach/register.ts.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { FEATURE_CONFIG_FILE } from "./shared/constants.ts";
import { registerTutor } from "./server/coach/register.ts";
import { createCourseSource } from "./server/course/index.ts";
import { createProgressStore } from "./server/progress/store.ts";
import { createHostClient } from "./server/workspace/host-client.ts";
import { createMachineAccess } from "./server/workspace/machine-access.ts";

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const host = createHostClient(bb);
  await registerTutor(bb, {
    courseSource: createCourseSource(),
    store: createProgressStore(),
    env: process.env,
    featureConfigFile: FEATURE_CONFIG_FILE,
    now: () => new Date(),
    // The workspace is on the student's machine: reached through sdk.files and the host entry.
    access: (hostId) => createMachineAccess(bb, host, hostId),
    // A page load's reads in one call to the machine.
    snapshot: (hostId, input) => host.snapshot(hostId, input),
  });
}
