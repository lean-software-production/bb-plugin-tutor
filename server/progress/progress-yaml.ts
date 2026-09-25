// spec/PROGRESS.yaml, read leniently and written canonically.
//
// Reading never throws: a bad field or Example entry is dropped and reported
// as a problem, so one hand edit cannot hide the student's whole history.
// Writing keeps ids quoted (YAML would otherwise read `003` as the number 3),
// a stable key order, Examples sorted by key, and any keys this version does
// not know about, so a newer coach-me (or a human) can add fields safely.
import YAML, { isScalar } from "yaml";
import {
  exampleKeySchema,
  exampleProgressSchema,
  homeworkIdSchema,
  isoTimestampSchema,
  pastHomeworkSchema,
  ruleKeySchema,
  type ExampleProgress,
  type PastHomework,
  type ProgressFile,
} from "../../shared/model.ts";

const FILE = "spec/PROGRESS.yaml";
const MAX_PROBLEMS = 20;
const TOP_KEYS = ["iteration", "focus", "adopted", "summary", "examples", "history"] as const;
const PAST_KEYS = ["adopted", "summary", "examples"] as const;
const ENTRY_KEYS = ["status", "hash", "note", "evidence", "at", "carriedFrom"] as const;

type RawMap = Record<string, unknown>;

export interface ParsedProgress {
  progress: ProgressFile | null;
  problems: string[];
}

function isMap(value: unknown): value is RawMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** YAML reads an unquoted `003` as 3 (and a mapping key as "3"); put the zero padding back. */
function homeworkIdLike(value: unknown): unknown {
  if (typeof value === "string" && /^\d{1,2}$/.test(value)) return value.padStart(3, "0");
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1000
    ? String(value).padStart(3, "0")
    : value;
}

function loadYaml(text: string): { raw: unknown } | { problem: string } {
  try {
    return { raw: YAML.parse(text) };
  } catch (cause) {
    const message = cause instanceof Error ? (cause.message.split("\n")[0] ?? "") : String(cause);
    return { problem: `${FILE} is not valid YAML (${message}).` };
  }
}

export function parseProgress(text: string): ParsedProgress {
  const problems: string[] = [];
  const report = (problem: string) => {
    if (problems.length < MAX_PROBLEMS) problems.push(problem);
  };
  const loaded = loadYaml(text);
  if ("problem" in loaded) return { progress: null, problems: [loaded.problem] };
  if (!isMap(loaded.raw)) return { progress: null, problems: [`${FILE} should be a YAML mapping.`] };
  const raw = loaded.raw;

  const iteration = homeworkIdSchema.safeParse(homeworkIdLike(raw.iteration));
  if (!iteration.success) {
    return { progress: null, problems: [`${FILE} has no valid iteration (expected a quoted id like "003").`] };
  }
  const progress: ProgressFile = { iteration: iteration.data, examples: {} };

  if (raw.focus !== undefined) {
    const focus = ruleKeySchema.nullable().safeParse(raw.focus);
    if (focus.success) progress.focus = focus.data;
    else report(`${FILE}: focus "${String(raw.focus)}" is not a Rule key and was ignored.`);
  }
  if (raw.adopted !== undefined) {
    const adopted = isoTimestampSchema.safeParse(raw.adopted);
    if (adopted.success) progress.adopted = adopted.data;
    else report(`${FILE}: adopted is not an ISO timestamp and was ignored.`);
  }
  if (raw.summary !== undefined) {
    if (typeof raw.summary === "string") progress.summary = raw.summary;
    else report(`${FILE}: summary is not text and was ignored.`);
  }

  const examples = raw.examples ?? {};
  if (isMap(examples)) progress.examples = parseExamples(examples, report);
  else report(`${FILE}: examples should be a mapping; none were read.`);
  if (raw.history !== undefined) {
    if (isMap(raw.history)) progress.history = parseHistory(raw.history, report);
    else report(`${FILE}: history should be a mapping and was ignored.`);
  }
  return { progress, problems };
}

function parseExamples(examples: RawMap, report: (problem: string) => void): Record<string, ExampleProgress> {
  const parsed: Record<string, ExampleProgress> = {};
  for (const [key, value] of Object.entries(examples)) {
    if (!exampleKeySchema.safeParse(key).success) {
      report(`${FILE}: "${key}" is not an Example key and was ignored.`);
      continue;
    }
    const candidate =
      isMap(value) && value.carriedFrom !== undefined ? { ...value, carriedFrom: homeworkIdLike(value.carriedFrom) } : value;
    const entry = exampleProgressSchema.safeParse(candidate);
    if (entry.success) parsed[key] = entry.data;
    else report(`${FILE}: the entry for ${key} is malformed and was ignored.`);
  }
  return parsed;
}

function parseHistory(history: RawMap, report: (problem: string) => void): Record<string, PastHomework> {
  const parsed: Record<string, PastHomework> = {};
  for (const [rawId, value] of Object.entries(history)) {
    const id = homeworkIdSchema.safeParse(homeworkIdLike(rawId));
    if (isMap(value) && value.examples !== undefined && !isMap(value.examples)) {
      report(`${FILE}: history.${id.success ? id.data : rawId}.examples should be a mapping; none were read.`);
    }
    const past = isMap(value)
      ? pastHomeworkSchema.safeParse({
          ...(value.adopted === undefined ? {} : { adopted: value.adopted }),
          ...(value.summary === undefined ? {} : { summary: value.summary }),
          examples: isMap(value.examples) ? parseExamples(value.examples, report) : {},
        })
      : null;
    if (id.success && past?.success === true) parsed[id.data] = past.data;
    else report(`${FILE}: the history entry for ${rawId} is malformed and was ignored.`);
  }
  return parsed;
}

/** What the file being replaced holds that this version does not read, to carry it over. */
interface Preserved {
  top: RawMap;
  /** Unknown fields of each current Example entry, by key. */
  entries: Record<string, RawMap>;
  /** Unknown keys of each history entry, by homework id. */
  past: Record<string, RawMap>;
  /** Unknown fields of each history Example entry, by homework id and key. */
  pastEntries: Record<string, Record<string, RawMap>>;
  /** A history entry's `examples` that is not a mapping, verbatim, by homework id. */
  pastExamples: Record<string, unknown>;
}

function extraFields(map: RawMap, known: readonly string[]): RawMap {
  return Object.fromEntries(Object.entries(map).filter(([field]) => !known.includes(field)));
}

function entryExtras(examples: unknown): Record<string, RawMap> {
  const result: Record<string, RawMap> = {};
  if (!isMap(examples)) return result;
  for (const [key, entry] of Object.entries(examples)) {
    const extra = isMap(entry) ? extraFields(entry, ENTRY_KEYS) : {};
    if (Object.keys(extra).length > 0) result[key] = extra;
  }
  return result;
}

function preserved(previousText: string | null): Preserved {
  const result: Preserved = { top: {}, entries: {}, past: {}, pastEntries: {}, pastExamples: {} };
  if (previousText === null) return result;
  const loaded = loadYaml(previousText);
  if ("problem" in loaded || !isMap(loaded.raw)) return result;
  result.top = extraFields(loaded.raw, TOP_KEYS);
  result.entries = entryExtras(loaded.raw.examples);
  const history = loaded.raw.history;
  if (!isMap(history)) return result;
  for (const [rawId, value] of Object.entries(history)) {
    if (!isMap(value)) continue;
    const id = String(homeworkIdLike(rawId));
    result.past[id] = extraFields(value, PAST_KEYS);
    result.pastEntries[id] = entryExtras(value.examples);
    if (value.examples !== undefined && !isMap(value.examples)) result.pastExamples[id] = value.examples;
  }
  return result;
}

function orderedEntry(entry: ExampleProgress, extra: RawMap | undefined): RawMap {
  const ordered: RawMap = {};
  for (const field of ENTRY_KEYS) {
    if (entry[field] !== undefined) ordered[field] = entry[field];
  }
  return { ...ordered, ...extra };
}

/**
 * Canonical YAML for `progress`. `previousText` is the file being replaced:
 * keys it holds that this version does not know, at the top, in history
 * entries and in Example entries, are carried into the output, and so is a
 * history entry's unreadable `examples`.
 */
export function formatProgress(progress: ProgressFile, previousText: string | null): string {
  const extras = preserved(previousText);
  const ordered: RawMap = { iteration: progress.iteration };
  if (progress.focus !== undefined) ordered.focus = progress.focus;
  if (progress.adopted !== undefined) ordered.adopted = progress.adopted;
  if (progress.summary !== undefined) ordered.summary = progress.summary;
  ordered.examples = Object.fromEntries(
    Object.keys(progress.examples)
      .sort()
      .map((key) => [key, orderedEntry(progress.examples[key] as ExampleProgress, extras.entries[key])]),
  );
  const history = progress.history ?? {};
  if (Object.keys(history).length > 0) {
    ordered.history = Object.fromEntries(
      Object.keys(history)
        .sort()
        .map((id) => [id, orderedPast(history[id] as PastHomework, id, extras)]),
    );
  }
  const doc = new YAML.Document({ ...ordered, ...extras.top });
  quote(doc.get("iteration", true));
  for (const key of Object.keys(progress.examples)) quote(doc.getIn(["examples", key, "carriedFrom"], true));
  for (const [id, past] of Object.entries(history)) {
    for (const key of Object.keys(past.examples)) quote(doc.getIn(["history", id, "examples", key, "carriedFrom"], true));
  }
  return doc.toString({ lineWidth: 0 });
}

function orderedPast(past: PastHomework, id: string, extras: Preserved): RawMap {
  const ordered: RawMap = {};
  for (const field of PAST_KEYS) {
    if (field === "examples") {
      const unread = extras.pastExamples[id];
      ordered.examples =
        unread !== undefined && Object.keys(past.examples).length === 0
          ? unread
          : Object.fromEntries(
              Object.keys(past.examples)
                .sort()
                .map((key) => [key, orderedEntry(past.examples[key] as ExampleProgress, extras.pastEntries[id]?.[key])]),
            );
    } else if (past[field] !== undefined) {
      ordered[field] = past[field];
    }
  }
  return { ...ordered, ...extras.past[id] };
}

function quote(node: unknown): void {
  if (isScalar(node)) node.type = "QUOTE_DOUBLE";
}
