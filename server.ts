// bb-plugin-tutor backend entry. The wiring lives in server/coach/register.ts.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { FEATURE_CONFIG_FILE } from "./shared/constants.ts";
import { registerTutor } from "./server/coach/register.ts";
import { createCourseSource } from "./server/course/index.ts";
import { createProgressStore } from "./server/progress/store.ts";

export default async function plugin(bb: BbPluginApi): Promise<void> {
  await registerTutor(bb, {
    courseSource: createCourseSource(),
    store: createProgressStore(),
    env: process.env,
    featureConfigFile: FEATURE_CONFIG_FILE,
    now: () => new Date(),
  });
}
