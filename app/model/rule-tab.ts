// The "Rule" tab in a thread's right panel (mockups 2C and 4). Its params are
// untrusted (they round-trip through BB's persistence and can come from a
// directive the model wrote), so they are parsed here before any use.
import { countExamples, exampleStatus, findRule } from "../../shared/derive.ts";
import { RULE_KEY_PATTERN } from "../../shared/keys.ts";
import { formatRoute } from "../../shared/routes.ts";
import type { ExampleStatus } from "../../shared/model.ts";
import type { Lesson, TutorThread } from "../../shared/rpc.ts";
import { percent } from "./format.ts";

const HOMEWORK_ID = /^\d{3}$/;

export interface RuleTabParams {
  homeworkId: string | null;
  ruleKey: string | null;
}

export function parseRuleTabParams(params: unknown): RuleTabParams {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return { homeworkId: null, ruleKey: null };
  const record = params as Record<string, unknown>;
  const homeworkId = typeof record.homeworkId === "string" && HOMEWORK_ID.test(record.homeworkId) ? record.homeworkId : null;
  const ruleKey = typeof record.ruleKey === "string" && RULE_KEY_PATTERN.test(record.ruleKey) ? record.ruleKey : null;
  return { homeworkId, ruleKey };
}

export interface RuleTabTarget {
  homeworkId: string;
  /** Null means "whatever the lesson has in focus". */
  ruleKey: string | null;
}

/** Explicit params win; otherwise the thread's own homework and (for a side thread) its Rule. */
export function ruleTabTarget(params: RuleTabParams, thread: TutorThread | null): RuleTabTarget | null {
  const homeworkId = params.homeworkId ?? thread?.homeworkId ?? null;
  if (homeworkId === null) return null;
  const ownRule = thread !== null && thread.homeworkId === homeworkId ? thread.ruleKey : null;
  return { homeworkId, ruleKey: params.ruleKey ?? ownRule };
}

export interface RuleTabExample {
  key: string;
  name: string;
  status: ExampleStatus;
  detail: string;
}

export type RuleTabView =
  | { kind: "no-rule"; lessonSubPath: string }
  | {
      kind: "rule";
      eyebrow: string;
      title: string;
      passing: number;
      total: number;
      percent: number;
      examples: RuleTabExample[];
      lessonSubPath: string;
    };

function detail(status: ExampleStatus, note: string | undefined, carried: boolean): string {
  switch (status) {
    case "passing":
      return carried ? "Passing · carried over" : "Passing";
    case "not-yet":
      return note === undefined ? "Not yet" : `Not yet — ${note}`;
    case "skipped":
      return "Skipped";
    case "pending":
      return "Pending";
  }
}

export function ruleTabView(lesson: Lesson, target: RuleTabTarget, fromSideThread: boolean): RuleTabView {
  const lessonSubPath = formatRoute({ kind: "lesson", homeworkId: lesson.homework.id });
  const key = target.ruleKey ?? lesson.focus;
  const rule = key === null ? undefined : findRule(lesson.homework, key);
  if (rule === undefined) return { kind: "no-rule", lessonSubPath };
  const feature = lesson.homework.features.find((candidate) => candidate.rules.includes(rule));
  const where = feature?.name ?? lesson.homework.title;
  const counts = countExamples(rule.examples, lesson.progress);
  const eyebrow = fromSideThread
    ? `Spun off from · ${where}`
    : rule.key === lesson.focus
      ? `Rule in focus · ${where}`
      : `Rule · ${where}`;
  return {
    kind: "rule",
    eyebrow,
    title: rule.name,
    passing: counts.passing,
    total: counts.total,
    percent: percent(counts.passing, counts.total),
    examples: rule.examples.map((example) => {
      const entry = lesson.progress[example.key];
      const status = exampleStatus(example, lesson.progress);
      return {
        key: example.key,
        name: example.name,
        status,
        detail: detail(status, entry?.note, entry?.carriedFrom !== undefined),
      };
    }),
    lessonSubPath,
  };
}
