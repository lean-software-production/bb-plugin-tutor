// Adopting a capstone lesson, on the student's machine, as one operation (the
// host entry's adoptLesson, run under the host lock): every check first, then
// the factory's move to factory/ at 004 (factory-move.ts), then spec/, the seed
// and stand-ins/ from the bundles the server sent (spec-copy.ts), and last
// PROGRESS.yaml and then ITERATION, so ITERATION never names a lesson that
// isn't there.
//
// A refusal throws before anything is written. So does a progress file that
// changed since the server read it (ProgressConflictError): the server reads
// the workspace again and adopts once more. A failure after the move leaves
// factory/ as it was at 003, and the next adoption goes ahead there without
// moving again.
import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { AdoptLessonInput, AdoptLessonOutput } from "../../host/contract.ts";
import type { IterationState } from "../../shared/model.ts";
import { formatIteration } from "../progress/iteration.ts";
import { formatProgress } from "../progress/progress-yaml.ts";
import type { LayoutProbe, ProgressLocation } from "../types.ts";
import { capstoneProgress, resolveLayout, type Layout } from "./detect.ts";
import { checkFactoryMove, moveFactory, needsFactoryMove } from "./factory-move.ts";
import { checkLessonSpec, copyLessonSpec, type SpecCopyHooks, type SpecCopyOptions } from "./spec-copy.ts";

/** The progress file is no longer what the server read: nothing was written. */
export class ProgressConflictError extends Error {
  override name = "ProgressConflictError";
}

export interface AdoptOptions {
  /** For tests: acts in the middle of spec/'s swap. */
  hooks?: SpecCopyHooks;
}

function isMissing(cause: unknown): boolean {
  return (cause as { code?: unknown }).code === "ENOENT";
}

/** The file's bytes, or null when there is none (its folder missing, or a file: spec/'s own check refuses that). */
async function readIfPresent(path: string): Promise<Buffer | null> {
  return readFile(path).catch((cause: unknown) => {
    if (isMissing(cause) || (cause as { code?: unknown }).code === "ENOTDIR") return null;
    throw cause;
  });
}

/**
 * Replaces `path` through a hidden sibling temp file and a rename, so readers
 * never see half a file and a symbolic link in its place is replaced, never
 * written through. A file being replaced keeps its permissions.
 */
async function writeAtomically(path: string, text: string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const existingMode = await stat(path).then(
    (stats) => stats.mode & 0o777,
    () => null,
  );
  try {
    await writeFile(temp, text, { encoding: "utf8", flag: "wx" });
    if (existingMode !== null) await chmod(temp, existingMode);
    await rename(temp, path);
  } catch (cause) {
    await rm(temp, { force: true });
    throw cause;
  }
}

/** ITERATION, then the older ITERATION files removed so they never disagree; only inside a real folder. */
async function writeIteration(at: ProgressLocation, state: IterationState): Promise<void> {
  const [file, ...older] = at.iterationFiles;
  if (file === undefined) throw new Error("This course keeps no ITERATION file, so Tutor has nowhere to write it.");
  await writeAtomically(join(at.dir, file), formatIteration(state));
  for (const old of older) {
    const folder = dirname(old);
    if (folder !== "." && (await lstat(join(at.dir, folder)).catch(() => null))?.isDirectory() !== true) continue;
    await unlink(join(at.dir, old)).catch((cause: unknown) => {
      if (!isMissing(cause)) throw cause;
    });
  }
}

function copyOptions(layout: Layout, input: AdoptLessonInput, hooks: SpecCopyHooks | undefined): SpecCopyOptions {
  return {
    spec: input.spec,
    standIns: input.standIns,
    seeds: { dir: layout.seedsDir, codebase: layout.codebase, shown: layout.seedsShown },
    ...(layout.mode === "repo" ? { factoryShown: layout.factoryShown } : {}),
    ...(hooks === undefined ? {} : { hooks }),
  };
}

/** The whole adoption, under the host lock: checks, the move at 004, spec/seed/stand-ins, then PROGRESS.yaml and ITERATION last. */
export async function adoptIntoWorkspace(input: AdoptLessonInput, probe: LayoutProbe, options: AdoptOptions = {}): Promise<AdoptLessonOutput> {
  const layout = await resolveLayout(input.root, probe);
  if (layout.blocked !== null) throw new Error(layout.blocked);

  // The progress file where the factory keeps it now, before any move: still what the server read?
  const before = capstoneProgress(layout);
  const previous = await readIfPresent(join(before.dir, before.progressFile));
  const previousSha = previous === null ? null : createHash("sha256").update(previous).digest("hex");
  if (previousSha !== input.progressSha256) {
    throw new ProgressConflictError(`${before.progressFile} changed since Tutor read it; nothing was written.`);
  }

  let at = layout;
  let moved = false;
  let note: string | null = null;
  if (needsFactoryMove(layout, input.lesson)) {
    // Every check before any write: the spec can be adopted where the factory is, and the move can be made.
    await checkLessonSpec(layout.factoryDir, input.lesson, copyOptions(layout, input, undefined));
    const move = await checkFactoryMove(layout);
    await moveFactory(layout, move);
    at = await resolveLayout(layout.projectRoot, probe);
    moved = true;
    note = move.note;
  }
  const result = await copyLessonSpec(at.factoryDir, input.lesson, copyOptions(at, input, options.hooks));

  // Last, once the lesson's files are there: PROGRESS.yaml, keeping what this version doesn't read, then ITERATION.
  const progressAt = capstoneProgress(at);
  await writeAtomically(join(progressAt.dir, progressAt.progressFile), formatProgress(input.progress, previous?.toString("utf8") ?? null));
  await writeIteration(progressAt, input.iteration);
  return { factoryShown: at.factoryShown, moved, note, written: result.written };
}
