// The "Rule" tab in a thread's right panel (mockups 2C and 4). Its params are
// untrusted (they round-trip through BB's persistence and can come from a
// directive the model wrote), so they are parsed here before any use.
import { countExamples, exampleStatus, findRule } from "../../shared/derive.ts";
import { RULE_KEY_PATTERN } from "../../shared/keys.ts";
import { formatRoute } from "../../shared/routes.ts";
import type { ExampleStatus } from "../../shared/model.ts";
import type { LessonDetail, TutorThread } from "../../shared/rpc.ts";
import { percent } from "./format.ts";

const LESSON_ID = /^\d{3}$/;

export interface RuleTabParams {
  lessonId: string | null;
  ruleKey: string | null;
}

export function parseRuleTabParams(params: unknown): RuleTabParams {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return { lessonId: null, ruleKey: null };
  const record = params as Record<string, unknown>;
  const lessonId = typeof record.lessonId === "string" && LESSON_ID.test(record.lessonId) ? record.lessonId : null;
  const ruleKey = typeof record.ruleKey === "string" && RULE_KEY_PATTERN.test(record.ruleKey) ? record.ruleKey : null;
  return { lessonId, ruleKey };
}

export interface RuleTabTarget {
  lessonId: string;
  /** Null means "whatever the lesson has in focus". */
  ruleKey: string | null;
}

/** Explicit params win; otherwise the thread's own lesson and (for a side thread) its Rule. */
export function ruleTabTarget(params: RuleTabParams, thread: TutorThread | null): RuleTabTarget | null {
  const lessonId = params.lessonId ?? thread?.lessonId ?? null;
  if (lessonId === null) return null;
  const ownRule = thread !== null && thread.lessonId === lessonId ? thread.ruleKey : null;
  return { lessonId, ruleKey: params.ruleKey ?? ownRule };
}

export interface RuleTabExample {
  key: string;
  name: string;
  status: ExampleStatus;
  detail: string;
}

export type RuleTabView =
  | { kind: "no-rule"; startPath: string }
  | {
      kind: "rule";
      eyebrow: string;
      title: string;
      passing: number;
      total: number;
      percent: number;
      examples: RuleTabExample[];
      startPath: string;
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

export function ruleTabView(lessonDetail: LessonDetail, target: RuleTabTarget, fromSideThread: boolean): RuleTabView {
  const startPath = formatRoute({ kind: "start", lessonId: lessonDetail.lesson.id });
  const key = target.ruleKey ?? lessonDetail.focus;
  const rule = key === null ? undefined : findRule(lessonDetail.lesson, key);
  if (rule === undefined) return { kind: "no-rule", startPath };
  const feature = lessonDetail.lesson.features.find((candidate) => candidate.rules.includes(rule));
  const where = feature?.name ?? lessonDetail.lesson.title;
  const counts = countExamples(rule.examples, lessonDetail.progress);
  const eyebrow = fromSideThread
    ? `Spun off from · ${where}`
    : rule.key === lessonDetail.focus
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
      const entry = lessonDetail.progress[example.key];
      const status = exampleStatus(example, lessonDetail.progress);
      return {
        key: example.key,
        name: example.name,
        status,
        detail: detail(status, entry?.note, entry?.carriedFrom !== undefined),
      };
    }),
    startPath,
  };
}
