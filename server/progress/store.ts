// The ProgressStore port over the student's factory repo on this machine.
import { lstat, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_LESSON_ID, FACTORY_FILES } from "../../shared/constants.ts";
import type { IterationState, ProgressFile, StudentState } from "../../shared/model.ts";
import type { ProgressStore } from "../../shared/ports.ts";
import { writeFileAtomic } from "./atomic-write.ts";
import { formatIteration, ITERATION_FILES, parseIteration } from "./iteration.ts";
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

/**
 * The root ITERATION's text, else the legacy spec/ITERATION's, with the file
 * it came from. A file that is there but unreadable is a problem, and hides
 * the legacy one rather than falling back past it.
 */
async function readIteration(factoryRoot: string, problems: string[]): Promise<{ text: string; label: string } | null> {
  for (const label of ITERATION_FILES) {
    try {
      const text = await readOptional(join(factoryRoot, label));
      if (text !== null) return { text, label };
    } catch (cause) {
      problems.push(`${label} could not be read (${(cause as Error).message}).`);
      return null;
    }
  }
  return null;
}

/**
 * Removes a factory's older spec/ITERATION once the root one is written, so
 * the two never disagree. Only inside a real spec/ folder: through a symbolic
 * link it could delete some other file of the student's.
 */
async function removeLegacyIteration(factoryRoot: string): Promise<void> {
  const spec = await lstat(join(factoryRoot, FACTORY_FILES.specDir)).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
  if (spec === null || spec.isSymbolicLink() || !spec.isDirectory()) return;
  await unlink(join(factoryRoot, FACTORY_FILES.legacyIteration)).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "ENOENT") throw cause;
  });
}

export function createProgressStore(): ProgressStore {
  return {
    async read(factoryRoot: string): Promise<StudentState> {
      const problems: string[] = [];
      const iterationFile = await readIteration(factoryRoot, problems);
      const progressText = await readSafely(join(factoryRoot, FACTORY_FILES.progress), FACTORY_FILES.progress, problems);

      let iteration: IterationState | null = null;
      if (iterationFile !== null) {
        const parsed = parseIteration(iterationFile.text, iterationFile.label);
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
      if (state.iteration === BUILTIN_LESSON_ID) {
        throw new Error("Lesson 0 is tracked in spec/PROGRESS.yaml only; ITERATION is never written for it.");
      }
      await writeFileAtomic(join(factoryRoot, FACTORY_FILES.iteration), formatIteration(state));
      await removeLegacyIteration(factoryRoot);
    },
  };
}
