import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ProgressStore } from "../../shared/ports.ts";
import type { WorkspaceAccess } from "../workspace/access.ts";
import type { TutorHostClient } from "../workspace/host-client.ts";
import type { ActivityRecorder } from "../activity/heartbeat.ts";
import type { CoachRegistry } from "./coach-registry.ts";
import type { KeyedLock } from "./keyed-lock.ts";
import type { TutorSettings } from "./settings.ts";
import type { StateSignals } from "./signals.ts";
import type { TurnFailures } from "./turn-failures.ts";
import type { WorldSource } from "./world.ts";

/** What the tools, events and RPC handlers share for one plugin load. */
export interface TutorRuntime {
  bb: BbPluginApi;
  settings: TutorSettings;
  world: WorldSource;
  store: ProgressStore;
  /** How the server reaches the workspace on a machine. */
  access: (hostId: string) => WorkspaceAccess;
  /** The plugin's own host entry on a machine: what the server can't do through sdk.files (adopting a lesson). */
  host: TutorHostClient;
  signals: StateSignals;
  /** Serialises changes to one factory's files, and find-or-spawn of one lesson's coach. */
  locks: KeyedLock;
  /** Coach threads seen so far, for configure (which cannot ask BB). */
  coaches: CoachRegistry;
  /** The last failed turn of each coach thread, for the outline. */
  turnFailures: TurnFailures;
  /** The student-activity stamp the feature's keep-alive reads. */
  activity: ActivityRecorder;
  now: () => Date;
}
