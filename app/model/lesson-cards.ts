// What the two cards that carry the lesson into the coach thread draw: the
// lesson card (`::tutor-lesson`, the coach's first reply) and the Rule card
// (a `focus` progress card, where a Rule's section of the thread starts, with
// the Rule's Examples as annotated Gherkin, mockup 6B). Both are drawn from
// the live lesson, so their statuses stay current however old the message.
import { countExamples, lessonExamples, ruleStatus } from "../../shared/derive.ts";
import type { Change } from "../../shared/model.ts";
import type { LessonDetail } from "../../shared/rpc.ts";
import { lessonEyebrow, percent, plural } from "./format.ts";
import { featureView } from "./lesson.ts";
import type { RuleView } from "./lesson.ts";
import type { RuleGlyph } from "./outline.ts";

export interface LessonCardRule {
  key: string;
  name: string;
  glyph: RuleGlyph;
  change: Change;
  /** It has a section in the coach thread to jump to. */
  reached: boolean;
}

export interface LessonCardFeature {
  slug: string;
  name: string;
  change: Change;
  count: string;
  rules: LessonCardRule[];
}

export interface LessonCardView {
  lessonId: string;
  eyebrow: string;
  title: string;
  dek: string;
  /** "3 of 9 examples hold". */
  tally: string;
  percent: number;
  features: LessonCardFeature[];
  coachThreadId: string | null;
}

export function lessonCardView(detail: LessonDetail): LessonCardView {
  const { lesson, progress } = detail;
  const counts = countExamples(lessonExamples(lesson), progress);
  const focus = detail.status === "current" ? detail.focus : null;
  const reached = new Set(detail.reachedRules);
  return {
    lessonId: lesson.id,
    eyebrow: lessonEyebrow(lesson.id, lesson.set),
    title: lesson.title,
    dek: lesson.dek,
    tally: `${counts.passing} of ${plural(counts.total, "example")} hold`,
    percent: percent(counts.passing, counts.total),
    features: lesson.features.map((feature) => {
      const featureCounts = countExamples(
        feature.rules.flatMap((rule) => rule.examples),
        progress,
      );
      return {
        slug: feature.slug,
        name: feature.name,
        change: feature.change,
        count: `${featureCounts.passing}/${featureCounts.total}`,
        rules: feature.rules.map((rule) => {
          const status = ruleStatus(rule, progress);
          return {
            key: rule.key,
            name: rule.name,
            glyph: status === "passing" ? "passing" : rule.key === focus ? "focus" : status,
            change: rule.change,
            reached: detail.coachThreadId !== null && reached.has(rule.key),
          };
        }),
      };
    }),
    coachThreadId: detail.coachThreadId,
  };
}

export interface RuleCardView {
  lessonId: string;
  featureName: string;
  featureChange: Change;
  rule: RuleView;
  passing: number;
  total: number;
  /** The lesson is the one under way, so side questions can go to its coach thread. */
  current: boolean;
  coachThreadId: string | null;
}

/** Null when the lesson has no such Rule (a card from a stale message). */
export function ruleCardView(detail: LessonDetail, ruleKey: string, now: number): RuleCardView | null {
  for (const feature of detail.lesson.features) {
    if (!feature.rules.some((rule) => rule.key === ruleKey)) continue;
    const focus = detail.status === "current" ? detail.focus : null;
    const view = featureView(feature, detail.progress, focus, null, now);
    const rule = view.rules.find((candidate) => candidate.key === ruleKey);
    if (rule === undefined) return null;
    const counts = countExamples(
      feature.rules.find((candidate) => candidate.key === ruleKey)?.examples ?? [],
      detail.progress,
    );
    return {
      lessonId: detail.lesson.id,
      featureName: feature.name,
      featureChange: feature.change,
      rule,
      passing: counts.passing,
      total: counts.total,
      current: detail.status === "current",
      coachThreadId: detail.coachThreadId,
    };
  }
  return null;
}
