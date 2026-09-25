// Records that the student is using BB, for the tutor feature's keep-alive:
// one ISO-8601 UTC line in <BB data dir>/.tutor-feature/activity. GitHub does
// not count browser traffic through a forwarded port as Codespace activity,
// so without this a Codespace can idle-stop under a student who is working.
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { ACTIVITY_FILE } from "../../shared/constants.ts";
import type { Env } from "../coach/course-path.ts";
import { writeFileAtomic } from "../progress/atomic-write.ts";

/** Several windows each send heartbeats; the file changes at most this often. */
export const MIN_WRITE_INTERVAL_MS = 30_000;

export function shouldWrite(lastWrittenAt: number | null, now: number): boolean {
  return lastWrittenAt === null || now < lastWrittenAt || now - lastWrittenAt >= MIN_WRITE_INTERVAL_MS;
}

export function activityFilePath(dataDir: string): string {
  return join(dataDir, ACTIVITY_FILE);
}

function absolute(path: string | undefined): string | null {
  const trimmed = path?.trim();
  return trimmed !== undefined && trimmed !== "" && isAbsolute(trimmed) ? trimmed : null;
}

export interface DataDirSources {
  /** `bb.server.experimental_dataDir`; may throw. */
  fromBb: () => string;
  env: Env;
  /** `dataDir` in the feature's config file. */
  configDataDir: string | undefined;
}

/** BB's own answer first, then BB_DATA_DIR, then the feature's config; null when none is absolute. */
export function resolveDataDir({ fromBb, env, configDataDir }: DataDirSources): string | null {
  let bbDir: string | undefined;
  try {
    bbDir = fromBb();
  } catch {
    bbDir = undefined;
  }
  return absolute(bbDir) ?? absolute(env.BB_DATA_DIR) ?? absolute(configDataDir);
}

export interface ActivityRecorderDeps {
  dataDir: () => Promise<string | null>;
  now: () => Date;
}

export interface ActivityRecorder {
  record(): Promise<{ recorded: boolean }>;
}

export function createActivityRecorder({ dataDir, now }: ActivityRecorderDeps): ActivityRecorder {
  let lastWrittenAt: number | null = null;
  return {
    async record() {
      const at = now();
      if (!shouldWrite(lastWrittenAt, at.getTime())) return { recorded: false };
      // Claimed before the first await, so concurrent heartbeats write once.
      const previous = lastWrittenAt;
      lastWrittenAt = at.getTime();
      try {
        const dir = await dataDir();
        if (dir === null) {
          lastWrittenAt = previous;
          return { recorded: false };
        }
        const file = activityFilePath(dir);
        // mkdir's mode applies only to directories it creates; an existing one keeps its own.
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        await writeFileAtomic(file, `${at.toISOString()}\n`);
        return { recorded: true };
      } catch (cause) {
        lastWrittenAt = previous;
        throw cause;
      }
    },
  };
}
