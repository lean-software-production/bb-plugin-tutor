// What the server sends the host to adopt a lesson (host/contract.ts
// adoptLesson), built from a sandbox's course and its factory as they are now.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AdoptLessonInput } from "../../host/contract.ts";
import { resolveLayout } from "../../layouts/capstone-factory/detect.ts";
import { lessonSpecBundle, standInsBundle } from "../../server/content/make-bundle.ts";
import { FACTORY_FILES } from "../../shared/constants.ts";
import type { ProgressFile } from "../../shared/model.ts";
import { createDiskAccess } from "./disk-access.ts";
import type { Sandbox } from "./disk.ts";

/** The sha256 of the factory's spec/PROGRESS.yaml where the layout at `root` has it now, or null when there is none. */
export async function progressSha(root: string): Promise<string | null> {
  const layout = await resolveLayout(root, createDiskAccess());
  const data = await readFile(join(layout.factoryDir, FACTORY_FILES.progress)).catch(() => null);
  return data === null ? null : createHash("sha256").update(data).digest("hex");
}

/**
 * Adopting `lessonId` of the sandbox's course into the project at `root` (the
 * clone's top folder unless given): its bundles, a fresh progress file for
 * it, ITERATION "<id> WIP", and the progress file's sha256 as read now.
 */
export async function adoptInput(
  sandbox: Sandbox,
  lessonId: string,
  options: { root?: string; progress?: ProgressFile } = {},
): Promise<AdoptLessonInput> {
  const lesson = sandbox.course.lessons.find((candidate) => candidate.id === lessonId);
  if (lesson === undefined) throw new Error(`no lesson ${lessonId}`);
  const root = options.root ?? sandbox.repoRoot;
  return {
    root,
    lesson: { id: lesson.id, seedSpec: lesson.seedSpec },
    spec: await lessonSpecBundle(lesson.dir),
    standIns: await standInsBundle(sandbox.course.root),
    progress: options.progress ?? { iteration: lesson.id, examples: {} },
    iteration: { iteration: lesson.id, status: "WIP" },
    progressSha256: await progressSha(root),
  };
}
