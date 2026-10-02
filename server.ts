// bb-plugin-tutor backend entry. The wiring lives in server/coach/register.ts.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { FEATURE_CONFIG_FILE } from "./shared/constants.ts";
import { registerTutor } from "./server/coach/register.ts";
import { createCourseSource } from "./server/course/index.ts";
import { createProgressStore } from "./server/progress/store.ts";
import { createLocalAccess } from "./server/workspace/local-access.ts";

export default async function plugin(bb: BbPluginApi): Promise<void> {
  await registerTutor(bb, {
    courseSource: createCourseSource(),
    store: createProgressStore(),
    env: process.env,
    featureConfigFile: FEATURE_CONFIG_FILE,
    now: () => new Date(),
    // The local disk until Task 8 reaches the workspace through its machine.
    access: () => createLocalAccess(),
  });
}
