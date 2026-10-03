// The ProgressStore port over the student's workspace, reached through
// WorkspaceAccess: where the files are comes from a ProgressLocation.
import { dirname, join } from "node:path";
import { formatIteration, parseIteration } from "../../layouts/progress/iteration.ts";
import { formatProgress, parseProgress } from "../../layouts/progress/progress-yaml.ts";
import type { ProgressLocation } from "../../layouts/types.ts";
import { BUILTIN_LESSON_ID } from "../../shared/constants.ts";
import type { IterationState, ProgressFile, StudentState } from "../../shared/model.ts";
import type { ProgressStore } from "../../shared/ports.ts";
import { WorkspaceUnreachableError, type WorkspaceAccess } from "../workspace/access.ts";

/**
 * The progress file's progress. `unreadable`: the file is there but could not
 * be read or parsed, which is not the same as having none (StudentState). A
 * machine that can't be reached is not an unreadable file: that is thrown.
 */
async function readProgressFile(
  access: WorkspaceAccess,
  at: ProgressLocation,
  problems: string[],
): Promise<{ progress: ProgressFile | null; unreadable: boolean }> {
  let text: string | null;
  try {
    text = (await access.read(join(at.dir, at.progressFile)))?.text ?? null;
  } catch (cause) {
    if (cause instanceof WorkspaceUnreachableError) throw cause;
    problems.push(`${at.progressFile} could not be read (${(cause as Error).message}).`);
    return { progress: null, unreadable: true };
  }
  if (text === null) return { progress: null, unreadable: false };
  const parsed = parseProgress(text);
  problems.push(...parsed.problems);
  return { progress: parsed.progress, unreadable: parsed.progress === null };
}

/**
 * The first ITERATION file's text, else the next one's (an older factory's
 * spec/ITERATION), with the file it came from. A file that is there but
 * unreadable is a problem, and hides the later ones rather than falling back past it.
 */
async function readIteration(
  access: WorkspaceAccess,
  at: ProgressLocation,
  problems: string[],
): Promise<{ text: string; label: string } | null> {
  for (const label of at.iterationFiles) {
    try {
      const file = await access.read(join(at.dir, label));
      if (file !== null) return { text: file.text, label };
    } catch (cause) {
      if (cause instanceof WorkspaceUnreachableError) throw cause;
      problems.push(`${label} could not be read (${(cause as Error).message}).`);
      return null;
    }
  }
  return null;
}

/**
 * Refuses to write `file` (relative to `dir`) when its folder is anything but
 * a real folder or nothing yet: a symbolic link there (spec -> ../src) could
 * point anywhere, and writing through it would touch the student's other work.
 */
async function ownFolderOf(access: WorkspaceAccess, dir: string, file: string): Promise<void> {
  const folder = dirname(file);
  if (folder === ".") return;
  const path = join(dir, folder);
  const kind = (await access.kinds([path]))[path] ?? "none";
  const label = `${folder}/ in the factory`;
  if (kind === "link") throw new Error(`${label} is a symbolic link, so Tutor will not write through it. Make it a real folder.`);
  if (kind === "file") throw new Error(`${label} is a file, not a folder. Move it aside so Tutor can write there.`);
}

/**
 * Removes the older ITERATION files once the first is written, so they never
 * disagree. Only inside a real folder: through a symbolic link it could
 * delete some other file of the student's.
 */
async function removeOlderIterations(access: WorkspaceAccess, at: ProgressLocation): Promise<void> {
  for (const file of at.iterationFiles.slice(1)) {
    const folder = dirname(file);
    if (folder !== ".") {
      const path = join(at.dir, folder);
      if ((await access.kinds([path]))[path] !== "folder") continue;
    }
    await access.remove(join(at.dir, file));
  }
}

export function createProgressStore(): ProgressStore {
  return {
    async read(access: WorkspaceAccess, at: ProgressLocation): Promise<StudentState> {
      const problems: string[] = [];
      const iterationFile = await readIteration(access, at, problems);
      let iteration: IterationState | null = null;
      if (iterationFile !== null) {
        const parsed = parseIteration(iterationFile.text, iterationFile.label);
        if ("state" in parsed) iteration = parsed.state;
        else problems.push(parsed.problem);
      }
      const { progress, unreadable } = await readProgressFile(access, at, problems);
      return unreadable ? { iteration, progress, progressUnreadable: true, problems } : { iteration, progress, problems };
    },

    async writeProgress(access: WorkspaceAccess, at: ProgressLocation, progress: ProgressFile): Promise<void> {
      await ownFolderOf(access, at.dir, at.progressFile);
      const path = join(at.dir, at.progressFile);
      const previous = await access.read(path);
      // Written only if the file is still what was just read (or still absent).
      await access.write(path, formatProgress(progress, previous?.text ?? null), previous?.sha256 ?? null);
    },

    async writeIteration(access: WorkspaceAccess, at: ProgressLocation, state: IterationState): Promise<void> {
      if (state.iteration === BUILTIN_LESSON_ID) {
        throw new Error("Lesson 0 is tracked in spec/PROGRESS.yaml only; ITERATION is never written for it.");
      }
      const [file] = at.iterationFiles;
      if (file === undefined) throw new Error("This course keeps no ITERATION file, so Tutor has nowhere to write it.");
      await access.write(join(at.dir, file), formatIteration(state));
      await removeOlderIterations(access, at);
    },
  };
}
