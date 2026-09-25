// What the two cards that carry the lesson into the coach thread draw: the
// lesson card (`::tutor-lesson`, the coach's first reply) and the Rule card
// (a `focus` progress card, where a Rule's section of the thread starts, with
// the Rule's Examples as annotated Gherkin, mockup 6B). Both are drawn from
// the live lesson, so their statuses stay current however old the message.
import { countExamples, homeworkExamples, ruleStatus } from "../../shared/derive.ts";
import type { Novelty } from "../../shared/model.ts";
import type { Lesson } from "../../shared/rpc.ts";
import { homeworkEyebrow, percent, plural } from "./format.ts";
import { featureView } from "./lesson.ts";
import type { RuleView } from "./lesson.ts";
import type { RuleGlyph } from "./rail.ts";

export interface LessonCardRule {
  key: string;
  name: string;
  glyph: RuleGlyph;
  novelty: Novelty;
  /** It has a section in the coach thread to jump to. */
  reached: boolean;
}

export interface LessonCardFeature {
  slug: string;
  name: string;
  novelty: Novelty;
  count: string;
  rules: LessonCardRule[];
}

export interface LessonCardView {
  homeworkId: string;
  eyebrow: string;
  title: string;
  dek: string;
  /** "3 of 9 examples hold". */
  tally: string;
  percent: number;
  features: LessonCardFeature[];
  coachThreadId: string | null;
}

export function lessonCardView(lesson: Lesson): LessonCardView {
  const { homework, progress } = lesson;
  const counts = countExamples(homeworkExamples(homework), progress);
  const focus = lesson.status === "current" ? lesson.focus : null;
  const reached = new Set(lesson.reachedRules);
  return {
    homeworkId: homework.id,
    eyebrow: homeworkEyebrow(homework.id, homework.set),
    title: homework.title,
    dek: homework.dek,
    tally: `${counts.passing} of ${plural(counts.total, "example")} hold`,
    percent: percent(counts.passing, counts.total),
    features: homework.features.map((feature) => {
      const featureCounts = countExamples(
        feature.rules.flatMap((rule) => rule.examples),
        progress,
      );
      return {
        slug: feature.slug,
        name: feature.name,
        novelty: feature.novelty,
        count: `${featureCounts.passing}/${featureCounts.total}`,
        rules: feature.rules.map((rule) => {
          const status = ruleStatus(rule, progress);
          return {
            key: rule.key,
            name: rule.name,
            glyph: status === "passing" ? "passing" : rule.key === focus ? "focus" : status,
            novelty: rule.novelty,
            reached: lesson.coachThreadId !== null && reached.has(rule.key),
          };
        }),
      };
    }),
    coachThreadId: lesson.coachThreadId,
  };
}

export interface RuleCardView {
  homeworkId: string;
  featureName: string;
  featureNovelty: Novelty;
  rule: RuleView;
  passing: number;
  total: number;
  /** The lesson is the one under way, so side questions can go to its coach thread. */
  current: boolean;
  coachThreadId: string | null;
}

/** Null when the lesson has no such Rule (a card from a stale message). */
export function ruleCardView(lesson: Lesson, ruleKey: string, now: number): RuleCardView | null {
  for (const feature of lesson.homework.features) {
    if (!feature.rules.some((rule) => rule.key === ruleKey)) continue;
    const focus = lesson.status === "current" ? lesson.focus : null;
    const view = featureView(feature, lesson.progress, focus, null, now);
    const rule = view.rules.find((candidate) => candidate.key === ruleKey);
    if (rule === undefined) return null;
    const counts = countExamples(
      feature.rules.find((candidate) => candidate.key === ruleKey)?.examples ?? [],
      lesson.progress,
    );
    return {
      homeworkId: lesson.homework.id,
      featureName: feature.name,
      featureNovelty: feature.novelty,
      rule,
      passing: counts.passing,
      total: counts.total,
      current: lesson.status === "current",
      coachThreadId: lesson.coachThreadId,
    };
  }
  return null;
}
