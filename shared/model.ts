// The Tutor domain model: course content (read-only, from the course repo)
// and student state (spec/PROGRESS.yaml + ITERATION in the factory).
//
// Every type is inferred from a zod schema so the same definition validates
// RPC payloads, tool input and the YAML read back from the student's repo.
// Frontend code must import from this module with `import type` only, so zod
// stays out of the app bundle.
import { z } from "zod";
import { EXAMPLE_KEY_PATTERN, RULE_KEY_PATTERN, SLUG_PATTERN } from "./keys.ts";

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/** Three digits, as in the course ledger: "001". Lesson 0 is "000". */
export const lessonIdSchema = z.string().regex(/^\d{3}$/, "expected a three-digit lesson id");
export type LessonId = z.infer<typeof lessonIdSchema>;

export const slugSchema = z.string().regex(SLUG_PATTERN, "expected a slug");
export const ruleKeySchema = z.string().regex(RULE_KEY_PATTERN, "expected <feature>/<rule>");
export type RuleKey = z.infer<typeof ruleKeySchema>;
export const exampleKeySchema = z
  .string()
  .regex(EXAMPLE_KEY_PATTERN, "expected <feature>/<rule>/<example>");
export type ExampleKey = z.infer<typeof exampleKeySchema>;

/**
 * "sha256:<64 hex>" over the Example's normalised text; see
 * docs/tutor/IMPLEMENTATION.md "Example text hash" for the exact input.
 */
export const textHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, "expected sha256:<hex>");
export type TextHash = z.infer<typeof textHashSchema>;

/** ISO-8601 UTC timestamp, e.g. "2026-09-25T10:12:00Z". */
export const isoTimestampSchema = z.iso.datetime();

export const threadIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "expected a thread id");

export const EXAMPLE_STATUSES = ["pending", "not-yet", "passing", "skipped"] as const;
export const exampleStatusSchema = z.enum(EXAMPLE_STATUSES);
export type ExampleStatus = z.infer<typeof exampleStatusSchema>;

/**
 * Compared with the previous lesson in course order:
 * - Example: same key and hash → unchanged; same key, new hash → reworded;
 *   key absent but hash present anywhere in the previous lesson → unchanged;
 *   otherwise → new. Every Example of the first lesson (and of Lesson 0) is new.
 * - Rule / FeatureFile: new when all its Examples are new, unchanged when all
 *   are unchanged, reworded otherwise.
 */
export const changeSchema = z.enum(["new", "reworded", "unchanged"]);
export type Change = z.infer<typeof changeSchema>;

// ---------------------------------------------------------------------------
// Course content
// ---------------------------------------------------------------------------

export const stepSchema = z.object({
  /** Trimmed Gherkin keyword: "Given", "When", "Then", "And", "But", "*". */
  keyword: z.string(),
  text: z.string(),
  docString: z.object({ mediaType: z.string().nullable(), content: z.string() }).nullable(),
  dataTable: z.array(z.array(z.string())).nullable(),
  line: z.number().int().nonnegative(),
});
export type Step = z.infer<typeof stepSchema>;

/** A Gherkin Example / Scenario. Scenario Outlines are one Example (not expanded). */
export const exampleSchema = z.object({
  key: exampleKeySchema,
  slug: slugSchema,
  name: z.string(),
  description: z.string(),
  /** Without the "@": ["real-agent"]. */
  tags: z.array(z.string()),
  steps: z.array(stepSchema),
  hash: textHashSchema,
  line: z.number().int().nonnegative(),
  change: changeSchema,
});
export type Example = z.infer<typeof exampleSchema>;

export const ruleSchema = z.object({
  key: ruleKeySchema,
  slug: slugSchema,
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  /** The Rule's own Background steps (the Feature's are on FeatureFile). */
  background: z.array(stepSchema),
  examples: z.array(exampleSchema),
  line: z.number().int().nonnegative(),
  change: changeSchema,
});
export type Rule = z.infer<typeof ruleSchema>;

export const featureFileSchema = z.object({
  slug: slugSchema,
  /** Relative to the lesson dir, POSIX separators: "features/assembly-line.feature". */
  path: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  background: z.array(stepSchema),
  rules: z.array(ruleSchema),
  change: changeSchema,
});
export type FeatureFile = z.infer<typeof featureFileSchema>;

export const diffLineSchema = z.object({
  kind: z.enum(["add", "del", "ctx"]),
  text: z.string(),
});
export type DiffLine = z.infer<typeof diffLineSchema>;

export const lessonSchema = z.object({
  id: lessonIdSchema,
  title: z.string(),
  /** Ledger "Set after" / course.yaml `set`, e.g. "Day 3". Groups the outline's days strip. */
  set: z.string().nullable(),
  /** Absolute path of the lesson directory (for Lesson 0: inside the plugin). */
  dir: z.string(),
  builtin: z.boolean(),
  /** README.md, verbatim markdown. */
  readme: z.string(),
  /** First prose paragraph of README.md after the title and any italic "set after" line. */
  dek: z.string(),
  /** FACTORY.md, verbatim markdown ("" when absent). */
  factoryMd: z.string(),
  /** spec.md (the sample seed), or null. */
  seedSpec: z.string().nullable(),
  /** Sorted by path. */
  features: z.array(featureFileSchema),
  /** Every Rule key once: new/reworded Rules first, then the rest, each group in file order. */
  suggestedRuleOrder: z.array(ruleKeySchema),
  /** FACTORY.md compared with the previous non-builtin lesson; null for the first one and Lesson 0. */
  factoryDiff: z.array(diffLineSchema).nullable(),
});
export type Lesson = z.infer<typeof lessonSchema>;

export const lexiconEntrySchema = z.object({
  /** The YAML key: "assembly-line". */
  id: slugSchema,
  term: z.string(),
  /** Markdown, verbatim from lexicon.yaml. */
  definition: z.string(),
});
export type LexiconEntry = z.infer<typeof lexiconEntrySchema>;

export const courseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  /** Absolute path of the course checkout. */
  root: z.string(),
  /** Absolute path of the course's coaching guidance (coach-me.md), or null. */
  coachPath: z.string().nullable(),
  /** Lesson 0 first, then the course's lessons in ledger order. */
  lessons: z.array(lessonSchema),
  lexicon: z.array(lexiconEntrySchema),
  source: z.enum(["course.yaml", "ledger"]),
});
export type Course = z.infer<typeof courseSchema>;

// ---------------------------------------------------------------------------
// Student state (factory repo)
// ---------------------------------------------------------------------------

/** ITERATION (or an older factory's spec/ITERATION): one line, "<NNN> <WIP|Done>". Never written for Lesson 0. */
export const iterationStateSchema = z.object({
  iteration: lessonIdSchema,
  status: z.enum(["WIP", "Done"]),
});
export type IterationState = z.infer<typeof iterationStateSchema>;

export const exampleProgressSchema = z.object({
  status: exampleStatusSchema,
  hash: textHashSchema,
  /** Required when status is not-yet: what went wrong. */
  note: z.string().optional(),
  /** Required when status is passing: the command and its output, or a test name. */
  evidence: z.string().optional(),
  at: isoTimestampSchema,
  /** Set when the status was carried over by hash from an earlier lesson. */
  carriedFrom: lessonIdSchema.optional(),
});
export type ExampleProgress = z.infer<typeof exampleProgressSchema>;

/**
 * A finished lesson, kept in PROGRESS.yaml when the next one is adopted so
 * its lesson and completion pages stay truthful. Evidence is left out to keep
 * the file small; it stays in the file's git history.
 */
export const pastLessonSchema = z.object({
  adopted: isoTimestampSchema.optional(),
  summary: z.string().optional(),
  examples: z.record(exampleKeySchema, exampleProgressSchema.omit({ evidence: true })),
});
export type PastLesson = z.infer<typeof pastLessonSchema>;

/** spec/PROGRESS.yaml. Written only by the coach tools. */
export const progressFileSchema = z.object({
  iteration: lessonIdSchema,
  focus: ruleKeySchema.nullable().optional(),
  /** When tutor_adopt_iteration adopted `iteration`. */
  adopted: isoTimestampSchema.optional(),
  /** The coach's summary, set by tutor_complete_iteration. */
  summary: z.string().optional(),
  examples: z.record(exampleKeySchema, exampleProgressSchema),
  /** Earlier lessons, by id. */
  history: z.record(lessonIdSchema, pastLessonSchema).optional(),
});
export type ProgressFile = z.infer<typeof progressFileSchema>;

export interface StudentState {
  iteration: IterationState | null;
  progress: ProgressFile | null;
  /** Human-readable problems found while reading (malformed YAML, unknown id, …). */
  problems: string[];
}

// ---------------------------------------------------------------------------
// Thread metadata (untrusted: never use it for authorisation)
// ---------------------------------------------------------------------------

export const coachThreadMetadataSchema = z.object({
  course: z.string(),
  lesson: lessonIdSchema,
  /** "sideChat" for a side chat (a fork Tutor made). */
  role: z.enum(["coach", "sideChat"]),
  ruleKey: ruleKeySchema.optional(),
});

/**
 * Also under Tutor's metadata on a coach thread: the Rules the coach has
 * focused there (tutor_focus_rule), in order. The coach opens each Rule's
 * section in the conversation when it focuses it, so these are the Rules the
 * course outline can jump to. Read leniently: it is untrusted like the rest.
 */
export const REACHED_RULES_METADATA_KEY = "reachedRules";
export const MAX_REACHED_RULES = 500;
export type CoachThreadMetadata = z.infer<typeof coachThreadMetadataSchema>;

// ---------------------------------------------------------------------------
// Derived view values
// ---------------------------------------------------------------------------

export const lessonStatusSchema = z.enum(["done", "current", "ahead"]);
export type LessonStatus = z.infer<typeof lessonStatusSchema>;

/** "not-started" only when nothing has been adopted yet (current is Lesson 0). */
export const iterationProgressSchema = z.enum(["not-started", "WIP", "Done"]);
export type IterationProgress = z.infer<typeof iterationProgressSchema>;

/** Outline glyph: passing ✓ (all passing or skipped), not-yet ! (any not-yet), pending ○. */
export const ruleStatusSchema = z.enum(["passing", "not-yet", "pending"]);
export type RuleStatus = z.infer<typeof ruleStatusSchema>;

export const exampleCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  passing: z.number().int().nonnegative(),
  notYet: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  /** Examples that are new or reworded. */
  fresh: z.number().int().nonnegative(),
});
export type ExampleCounts = z.infer<typeof exampleCountsSchema>;
