import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ProgressStore } from "../../shared/ports.ts";
import type { TutorSettings } from "./settings.ts";
import type { StateSignals } from "./signals.ts";
import type { WorldSource } from "./world.ts";

/** What the tools, events and RPC handlers share for one plugin load. */
export interface TutorRuntime {
  bb: BbPluginApi;
  settings: TutorSettings;
  world: WorldSource;
  store: ProgressStore;
  signals: StateSignals;
  now: () => Date;
}
