// The ProgressStore port over the student's factory repo on this machine.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_HOMEWORK_ID, FACTORY_FILES } from "../../shared/constants.ts";
import type { IterationState, ProgressFile, StudentState } from "../../shared/model.ts";
import type { ProgressStore } from "../../shared/ports.ts";
import { writeFileAtomic } from "./atomic-write.ts";
import { formatIteration, parseIteration } from "./iteration.ts";
import { ownFolder } from "./own-folder.ts";
import { formatProgress, parseProgress } from "./progress-yaml.ts";

/** The file's text, or null when it does not exist. */
async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

async function readSafely(path: string, label: string, problems: string[]): Promise<string | null> {
  try {
    return await readOptional(path);
  } catch (cause) {
    problems.push(`${label} could not be read (${(cause as Error).message}).`);
    return null;
  }
}

export function createProgressStore(): ProgressStore {
  return {
    async read(factoryRoot: string): Promise<StudentState> {
      const problems: string[] = [];
      const iterationText = await readSafely(join(factoryRoot, FACTORY_FILES.iteration), FACTORY_FILES.iteration, problems);
      const progressText = await readSafely(join(factoryRoot, FACTORY_FILES.progress), FACTORY_FILES.progress, problems);

      let iteration: IterationState | null = null;
      if (iterationText !== null) {
        const parsed = parseIteration(iterationText);
        if ("state" in parsed) iteration = parsed.state;
        else problems.push(parsed.problem);
      }
      let progress: ProgressFile | null = null;
      if (progressText !== null) {
        const parsed = parseProgress(progressText);
        progress = parsed.progress;
        problems.push(...parsed.problems);
      }
      return { iteration, progress, problems };
    },

    async writeProgress(factoryRoot: string, progress: ProgressFile): Promise<void> {
      await ownFolder(factoryRoot, FACTORY_FILES.specDir);
      const path = join(factoryRoot, FACTORY_FILES.progress);
      await writeFileAtomic(path, formatProgress(progress, await readOptional(path)));
    },

    async writeIteration(factoryRoot: string, state: IterationState): Promise<void> {
      if (state.iteration === BUILTIN_HOMEWORK_ID) {
        throw new Error("Lesson 0 is tracked in spec/PROGRESS.yaml only; spec/ITERATION is never written for it.");
      }
      await ownFolder(factoryRoot, FACTORY_FILES.specDir);
      await writeFileAtomic(join(factoryRoot, FACTORY_FILES.iteration), formatIteration(state));
    },
  };
}
