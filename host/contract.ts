// The contract between the plugin's server half and its host entry (host.ts),
// which BB's host daemon runs on the student's machine. Shared by both halves.
import { z } from "zod";
import { bundleSchema } from "../shared/bundle.ts";
import { iterationStateSchema, lessonIdSchema, progressFileSchema } from "../shared/model.ts";

export const courseIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export const pathKindSchema = z.enum(["folder", "link", "file", "none"]);

export const hostContract = {
  /** lstat kinds and real paths of absolute paths on the machine: what sdk.files can't tell. */
  inspect: {
    input: z.object({
      paths: z.array(z.string().startsWith("/")).max(256),
      realPaths: z.array(z.string().startsWith("/")).max(16),
    }),
    output: z.object({
      kinds: z.record(z.string(), pathKindSchema),
      realPaths: z.record(z.string(), z.string()),
    }),
  },
  /**
   * One page load's reads in one call (host/snapshot.ts): inspect's kinds and
   * real paths, and the files under `root` with their text and the sha256 of
   * their bytes (as sdk.files.read reports it); null: the file is not there.
   * A file outside `root`, or whose real path leaves it, is left out.
   */
  snapshot: {
    input: z.object({
      root: z.string().startsWith("/"),
      kinds: z.array(z.string().startsWith("/")).max(256),
      realPaths: z.array(z.string().startsWith("/")).max(16),
      files: z.array(z.string().startsWith("/")).max(64),
    }),
    output: z.object({
      kinds: z.record(z.string(), pathKindSchema),
      realPaths: z.record(z.string(), z.string()),
      files: z.record(z.string(), z.object({ text: z.string(), sha256: z.string() }).nullable()),
    }),
  },
  /**
   * Adopts a capstone lesson into the workspace at `root` as one operation
   * (layouts/capstone-factory/adopt.ts): the move to factory/ at 004, spec/,
   * the seed and stand-ins/, then PROGRESS.yaml and ITERATION. A refusal
   * throws and writes nothing. `progressSha256` is the progress file's sha256
   * as the server read it (null: there was none); when the file changed since,
   * nothing is written and the answer is `{ conflict: true }`.
   */
  adoptLesson: {
    input: z.object({
      root: z.string().startsWith("/"),
      lesson: z.object({ id: lessonIdSchema, seedSpec: z.string().nullable() }),
      spec: bundleSchema, // README.md, FACTORY.md?, features/**
      standIns: bundleSchema.nullable(),
      progress: progressFileSchema, // already carried over by the server
      iteration: iterationStateSchema,
      progressSha256: z.string().nullable(),
    }),
    output: z.union([
      z.object({ factoryShown: z.string(), moved: z.boolean(), note: z.string().nullable(), written: z.array(z.string()) }),
      z.object({ conflict: z.literal(true) }),
    ]),
  },
  /**
   * Seeds the workspace at `root` from a course's starter bundle, resumably
   * (host/seed.ts): writes only what is absent, keeping and reporting any
   * file the student already changed, never overwriting it. A marker at
   * `.tutor/seeds/<courseId>.json` records that the seed for `ref` finished;
   * a later call for the same `ref` returns at once with `written: []`. A
   * marker for a different `ref` means the course moved on, and the call
   * seeds again with `onlyIfAbsent`, so a newer starter never overwrites the
   * student's work.
   */
  seedWorkspace: {
    input: z.object({ root: z.string().startsWith("/"), courseId: courseIdSchema, ref: z.string(), bundle: bundleSchema }),
    output: z.object({ written: z.array(z.string()), same: z.array(z.string()), kept: z.array(z.string()), complete: z.literal(true) }),
  },
} as const;

export type HostContract = typeof hostContract;
export type InspectInput = z.infer<HostContract["inspect"]["input"]>;
export type InspectOutput = z.infer<HostContract["inspect"]["output"]>;
export type SnapshotInput = z.infer<HostContract["snapshot"]["input"]>;
export type SnapshotOutput = z.infer<HostContract["snapshot"]["output"]>;
export type AdoptLessonInput = z.infer<HostContract["adoptLesson"]["input"]>;
/** What an adoption that went ahead returns. */
export type AdoptLessonOutput = Exclude<z.infer<HostContract["adoptLesson"]["output"]>, { conflict: true }>;
export type SeedWorkspaceInput = z.infer<HostContract["seedWorkspace"]["input"]>;
export type SeedWorkspaceOutput = z.infer<HostContract["seedWorkspace"]["output"]>;
