// View model of the paper lesson that leads the coach thread (mockups 2A and
// 6B): header, "New since" compass, the other features collapsed, then the
// feature holding the Rule in focus, ending at that Rule. The Rules after it
// fold away ahead of it ("Later in this feature"), so the conversation always
// follows the Rule in focus.
import { countExamples, exampleStatus, findRule, lessonExamples, ruleStatus } from "../../shared/derive.ts";
import type { ProgressMap } from "../../shared/derive.ts";
import type {
  Example,
  ExampleCounts,
  ExampleStatus,
  FeatureFile,
  Lesson,
  LessonStatus,
  Change,
  Rule,
  RuleStatus,
} from "../../shared/model.ts";
import type { FactoryProject, LessonSummary, LessonDetail } from "../../shared/rpc.ts";
import { backgroundLines, exampleLines } from "./gherkin.ts";
import type { GherkinLine } from "./gherkin.ts";
import { firstSentence, lessonEyebrow, lessonLabel, percent, plural, relativeTime } from "./format.ts";

export type NoteTone = "green" | "amber" | "blue" | "purple" | "muted";

export interface MarginNote {
  tone: NoteTone;
  label: string;
  text: string | null;
  /** The coach's evidence for a passing Example, verbatim. */
  evidence: string | null;
}

export interface ExampleView {
  key: string;
  name: string;
  status: ExampleStatus;
  lines: GherkinLine[];
  headerIndex: number;
  note: MarginNote | null;
}

export interface RuleView {
  key: string;
  name: string;
  description: string;
  change: Change;
  status: RuleStatus;
  isFocus: boolean;
  isUpNext: boolean;
  /** Right-hand text of the collapsed row: "2/2 · 6m ago", "up next". */
  summary: string;
  examples: ExampleView[];
}

export interface FeatureView {
  slug: string;
  name: string;
  file: string;
  description: string;
  change: Change;
  count: string;
  background: GherkinLine[];
  rules: RuleView[];
}

export interface Chip {
  text: string;
  tone: "plain" | "green" | "amber";
}

export interface CompassItem {
  file: string;
  text: string;
}

export interface LessonView {
  lessonId: string;
  title: string;
  eyebrow: string;
  /** "Lesson 3 · The assembly line", for the page's top bar. */
  barTitle: string;
  dek: string;
  status: LessonStatus;
  counts: ExampleCounts;
  percent: number;
  chips: Chip[];
  compass: { title: string; items: CompassItem[] } | null;
  /** "Assembly line › The factory refuses …", or null without a focus. */
  crumb: string | null;
  focus: { ruleKey: string; label: "in focus" | "up next" } | null;
  /** The feature holding the focus, its `rules` ending at the focus; null when nothing is in focus. */
  focusFeature: FeatureView | null;
  /** The focus feature's Rules after the focus, folded ahead of it. */
  laterRules: RuleView[];
  /** Every other feature, collapsed when there is a focus feature. */
  otherFeatures: FeatureView[];
  coachThreadId: string | null;
  /** The student's current lesson and done with it: the completion page is next. */
  readyToComplete: boolean;
}

const MAX_COMPASS_ITEMS = 6;

export type CoachStart = "read-ahead" | "loading" | "set-up" | "start" | "revisit";

/**
 * What a lesson offers before its coach thread exists. A coach needs a factory
 * project, so a student without one is sent to set one up rather than shown a
 * start that must fail. `factoryProject` is null until the overview loads, and
 * nothing is offered until then.
 */
export function coachStart(status: LessonStatus, factoryProject: FactoryProject["status"] | null): CoachStart {
  if (status === "ahead") return "read-ahead";
  if (factoryProject === null) return "loading";
  if (factoryProject === "unset" || factoryProject === "missing") return "set-up";
  return status === "current" ? "start" : "revisit";
}

/** Fold id of a focus feature's "Later in this feature" group; feature slugs never hold ":". */
export function laterFoldId(featureSlug: string): string {
  return `later:${featureSlug}`;
}

/** The folds (feature slugs or laterFoldId) that must open for `ruleKey` to show. */
export function foldsHiding(view: LessonView, ruleKey: string): string[] {
  if (view.focusFeature !== null && view.laterRules.some((rule) => rule.key === ruleKey)) {
    return [laterFoldId(view.focusFeature.slug)];
  }
  if (view.focusFeature === null) return [];
  const feature = view.otherFeatures.find((candidate) => candidate.rules.some((rule) => rule.key === ruleKey));
  return feature === undefined ? [] : [feature.slug];
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function marginNote(example: Example, progress: ProgressMap, now: number): MarginNote | null {
  const entry = progress[example.key];
  if (entry !== undefined && entry.hash !== example.hash) {
    return {
      tone: "muted",
      label: "Reworded",
      text: "The wording changed after your coach marked it, so it is pending again.",
      evidence: null,
    };
  }
  const when = relativeTime(entry?.at, now);
  switch (exampleStatus(example, progress)) {
    case "passing":
      if (entry?.carriedFrom !== undefined) {
        return {
          tone: "green",
          label: "Carried over",
          text: `Passing since ${lessonLabel(entry.carriedFrom).toLowerCase()}.`,
          evidence: entry.evidence ?? null,
        };
      }
      return { tone: "green", label: when === null ? "Coach · passing" : `Coach · ${when}`, text: null, evidence: entry?.evidence ?? null };
    case "not-yet":
      return {
        tone: "amber",
        label: when === null ? "Coach · not yet" : `Coach · not yet · ${when}`,
        text: entry?.note ?? null,
        evidence: null,
      };
    case "skipped":
      return { tone: "muted", label: "Skipped", text: entry?.note ?? null, evidence: null };
    case "pending":
      if (example.tags.includes("real-agent")) {
        return { tone: "purple", label: "@real-agent", text: "Needs a real agent — slow and costs tokens.", evidence: null };
      }
      if (example.change === "new") return { tone: "blue", label: "New", text: "New in this lesson.", evidence: null };
      if (example.change === "reworded") {
        return { tone: "blue", label: "Reworded", text: "Reworded since the last lesson.", evidence: null };
      }
      return null;
  }
}

function exampleView(example: Example, progress: ProgressMap, now: number): ExampleView {
  const { lines, headerIndex } = exampleLines(example);
  return {
    key: example.key,
    name: example.name,
    status: exampleStatus(example, progress),
    lines,
    headerIndex,
    note: marginNote(example, progress, now),
  };
}

function ruleSummary(rule: Rule, status: RuleStatus, isUpNext: boolean, progress: ProgressMap, now: number): string {
  const counts = countExamples(rule.examples, progress);
  const tally = `${counts.passing}/${counts.total}`;
  if (status === "not-yet") return `${tally} · not yet`;
  if (status === "passing") {
    const latest = rule.examples
      .map((example) => progress[example.key]?.at)
      .filter((at): at is string => at !== undefined)
      .sort()
      .at(-1);
    const when = relativeTime(latest, now);
    return when === null ? tally : `${tally} · ${when}`;
  }
  return isUpNext ? "up next" : tally;
}

/** The Rule the lesson ends at: the coach's focus, else the first open Rule in suggested order. */
function resolveFocus(detail: LessonDetail, progress: ProgressMap): LessonView["focus"] {
  if (detail.status !== "current") return null;
  if (detail.focus !== null && findRule(detail.lesson, detail.focus) !== undefined) {
    return { ruleKey: detail.focus, label: "in focus" };
  }
  const open = detail.lesson.suggestedRuleOrder.find((key) => {
    const rule = findRule(detail.lesson, key);
    return rule !== undefined && ruleStatus(rule, progress) !== "passing";
  });
  return open === undefined ? null : { ruleKey: open, label: "up next" };
}

function upNextKey(detail: LessonDetail, progress: ProgressMap, focusKey: string | null): string | null {
  if (detail.status !== "current") return null;
  return (
    detail.lesson.suggestedRuleOrder.find((key) => {
      if (key === focusKey) return false;
      const rule = findRule(detail.lesson, key);
      return rule !== undefined && ruleStatus(rule, progress) !== "passing";
    }) ?? null
  );
}

function compass(lesson: Lesson, previous: LessonSummary | null): LessonView["compass"] {
  const examples = lessonExamples(lesson);
  if (lesson.builtin || examples.every((example) => example.change === "new")) return null;
  const items: CompassItem[] = [];
  for (const feature of lesson.features) {
    if (feature.change === "unchanged") continue;
    const file = fileName(feature.path);
    if (feature.change === "new") {
      items.push({ file, text: firstSentence(feature.description) || `New: ${feature.name}.` });
      continue;
    }
    const fresh = feature.rules.filter((rule) => rule.change !== "unchanged");
    const added = fresh.filter((rule) => rule.change === "new").length;
    const reworded = fresh.length - added;
    const parts = [added > 0 ? plural(added, "new rule") : null, reworded > 0 ? `${reworded} reworded` : null].filter(
      (part): part is string => part !== null,
    );
    const only = fresh.length === 1 ? fresh[0] : undefined;
    items.push({ file, text: only === undefined ? `${parts.join(", ")}.` : `${parts.join(", ")}: “${only.name}”.` });
  }
  if (items.length === 0) return null;
  return {
    title: previous === null ? "New in this lesson" : `New since ${lessonLabel(previous.id).toLowerCase()}`,
    items: items.slice(0, MAX_COMPASS_ITEMS),
  };
}

function chips(status: LessonStatus, counts: ExampleCounts, lesson: Lesson): Chip[] {
  if (status === "ahead") {
    const rules = lesson.features.reduce((sum, feature) => sum + feature.rules.length, 0);
    return [
      { text: `${plural(rules, "rule")} · ${plural(counts.total, "example")}`, tone: "plain" },
      { text: "Preview", tone: "plain" },
    ];
  }
  const holding = { text: `${counts.passing} of ${plural(counts.total, "example")} hold`, tone: "plain" } as Chip;
  if (status === "done") return [{ ...holding, tone: "green" }, { text: "Complete ✓", tone: "green" }];
  const result: Chip[] = [{ ...holding, tone: counts.total > 0 && counts.passing === counts.total ? "green" : "plain" }];
  if (counts.fresh > 0) result.push({ text: `${counts.fresh} new or reworded`, tone: "amber" });
  return result;
}

export function featureView(
  feature: FeatureFile,
  progress: ProgressMap,
  focusKey: string | null,
  upNext: string | null,
  now: number,
): FeatureView {
  const counts = countExamples(
    feature.rules.flatMap((rule) => rule.examples),
    progress,
  );
  return {
    slug: feature.slug,
    name: feature.name,
    file: fileName(feature.path),
    description: feature.description,
    change: feature.change,
    count: `${counts.passing} / ${counts.total}`,
    background: backgroundLines(feature.background),
    rules: feature.rules.map((rule) => {
      const status = ruleStatus(rule, progress);
      const isUpNext = rule.key === upNext;
      return {
        key: rule.key,
        name: rule.name,
        description: rule.description,
        change: rule.change,
        status,
        isFocus: rule.key === focusKey,
        isUpNext,
        summary: ruleSummary(rule, status, isUpNext, progress, now),
        examples: rule.examples.map((example) => exampleView(example, progress, now)),
      };
    }),
  };
}

/** `lessons` is the course order from getOverview, used to name the previous lesson. */
export function buildLesson(detail: LessonDetail, lessons: readonly LessonSummary[], now: number): LessonView {
  const { lesson, progress } = detail;
  const counts = countExamples(lessonExamples(lesson), progress);
  const focus = resolveFocus(detail, progress);
  const upNext = upNextKey(detail, progress, focus?.ruleKey ?? null);
  const features = lesson.features.map((feature) =>
    featureView(feature, progress, focus?.ruleKey ?? null, upNext, now),
  );
  const holder = features.find((feature) => feature.rules.some((rule) => rule.key === focus?.ruleKey)) ?? null;
  const focusIndex = holder?.rules.findIndex((rule) => rule.isFocus) ?? -1;
  const focusFeature = holder === null ? null : { ...holder, rules: holder.rules.slice(0, focusIndex + 1) };
  const focusRule = holder?.rules[focusIndex];
  const index = lessons.findIndex((summary) => summary.id === lesson.id);
  const previous = lessons.slice(0, Math.max(0, index)).filter((summary) => !summary.builtin).at(-1) ?? null;
  return {
    lessonId: lesson.id,
    title: lesson.title,
    eyebrow: lessonEyebrow(lesson.id, lesson.set),
    barTitle: `${lessonLabel(lesson.id)} · ${lesson.title}`,
    dek: lesson.dek,
    status: detail.status,
    counts,
    percent: percent(counts.passing, counts.total),
    chips: chips(detail.status, counts, lesson),
    compass: compass(lesson, previous),
    crumb: focusFeature === null || focusRule === undefined ? null : `${focusFeature.name} › ${focusRule.name}`,
    focus,
    focusFeature,
    laterRules: holder === null ? [] : holder.rules.slice(focusIndex + 1),
    otherFeatures: features.filter((feature) => feature !== holder),
    coachThreadId: detail.coachThreadId,
    readyToComplete: detail.status === "done" && detail.iterationStatus === "Done",
  };
}
