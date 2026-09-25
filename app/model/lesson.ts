// View model of the paper lesson that leads the coach thread (mockups 2A and
// 6B): header, "New since" compass, the other features collapsed, then the
// feature holding the Rule in focus, ending at that Rule.
import { countExamples, exampleStatus, findRule, homeworkExamples, ruleStatus } from "../../shared/derive.ts";
import type { ProgressMap } from "../../shared/derive.ts";
import type {
  Example,
  ExampleCounts,
  ExampleStatus,
  FeatureFile,
  Homework,
  HomeworkStatus,
  Novelty,
  Rule,
  RuleStatus,
} from "../../shared/model.ts";
import type { HomeworkSummary, Lesson } from "../../shared/rpc.ts";
import { backgroundLines, exampleLines } from "./gherkin.ts";
import type { GherkinLine } from "./gherkin.ts";
import { firstSentence, homeworkEyebrow, homeworkLabel, percent, plural, relativeTime } from "./format.ts";

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
  novelty: Novelty;
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
  novelty: Novelty;
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
  homeworkId: string;
  title: string;
  eyebrow: string;
  /** "Homework 3 · The assembly line", for the page's top bar. */
  barTitle: string;
  dek: string;
  status: HomeworkStatus;
  counts: ExampleCounts;
  percent: number;
  chips: Chip[];
  compass: { title: string; items: CompassItem[] } | null;
  /** "Assembly line › The factory refuses …", or null without a focus. */
  crumb: string | null;
  focus: { ruleKey: string; label: "in focus" | "up next" } | null;
  /** The feature holding the focus, drawn open; null when nothing is in focus. */
  focusFeature: FeatureView | null;
  /** Every other feature, collapsed when there is a focus feature. */
  otherFeatures: FeatureView[];
  coachThreadId: string | null;
  /** The student's current homework and done with it: the completion page is next. */
  readyToComplete: boolean;
}

const MAX_COMPASS_ITEMS = 6;

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
          text: `Passing since ${homeworkLabel(entry.carriedFrom).toLowerCase()}.`,
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
      if (example.novelty === "new") return { tone: "blue", label: "New", text: "New in this homework.", evidence: null };
      if (example.novelty === "reworded") {
        return { tone: "blue", label: "Reworded", text: "Reworded since the last homework.", evidence: null };
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
function resolveFocus(lesson: Lesson, progress: ProgressMap): LessonView["focus"] {
  if (lesson.status !== "current") return null;
  if (lesson.focus !== null && findRule(lesson.homework, lesson.focus) !== undefined) {
    return { ruleKey: lesson.focus, label: "in focus" };
  }
  const open = lesson.homework.suggestedRuleOrder.find((key) => {
    const rule = findRule(lesson.homework, key);
    return rule !== undefined && ruleStatus(rule, progress) !== "passing";
  });
  return open === undefined ? null : { ruleKey: open, label: "up next" };
}

function upNextKey(lesson: Lesson, progress: ProgressMap, focusKey: string | null): string | null {
  if (lesson.status !== "current") return null;
  return (
    lesson.homework.suggestedRuleOrder.find((key) => {
      if (key === focusKey) return false;
      const rule = findRule(lesson.homework, key);
      return rule !== undefined && ruleStatus(rule, progress) !== "passing";
    }) ?? null
  );
}

function compass(homework: Homework, previous: HomeworkSummary | null): LessonView["compass"] {
  const examples = homeworkExamples(homework);
  if (homework.builtin || examples.every((example) => example.novelty === "new")) return null;
  const items: CompassItem[] = [];
  for (const feature of homework.features) {
    if (feature.novelty === "unchanged") continue;
    const file = fileName(feature.path);
    if (feature.novelty === "new") {
      items.push({ file, text: firstSentence(feature.description) || `New: ${feature.name}.` });
      continue;
    }
    const fresh = feature.rules.filter((rule) => rule.novelty !== "unchanged");
    const added = fresh.filter((rule) => rule.novelty === "new").length;
    const reworded = fresh.length - added;
    const parts = [added > 0 ? plural(added, "new rule") : null, reworded > 0 ? `${reworded} reworded` : null].filter(
      (part): part is string => part !== null,
    );
    const only = fresh.length === 1 ? fresh[0] : undefined;
    items.push({ file, text: only === undefined ? `${parts.join(", ")}.` : `${parts.join(", ")}: “${only.name}”.` });
  }
  if (items.length === 0) return null;
  return {
    title: previous === null ? "New in this homework" : `New since ${homeworkLabel(previous.id).toLowerCase()}`,
    items: items.slice(0, MAX_COMPASS_ITEMS),
  };
}

function chips(status: HomeworkStatus, counts: ExampleCounts, homework: Homework): Chip[] {
  if (status === "ahead") {
    const rules = homework.features.reduce((sum, feature) => sum + feature.rules.length, 0);
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

function featureView(
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
    novelty: feature.novelty,
    count: `${counts.passing} / ${counts.total}`,
    background: backgroundLines(feature.background),
    rules: feature.rules.map((rule) => {
      const status = ruleStatus(rule, progress);
      const isUpNext = rule.key === upNext;
      return {
        key: rule.key,
        name: rule.name,
        description: rule.description,
        novelty: rule.novelty,
        status,
        isFocus: rule.key === focusKey,
        isUpNext,
        summary: ruleSummary(rule, status, isUpNext, progress, now),
        examples: rule.examples.map((example) => exampleView(example, progress, now)),
      };
    }),
  };
}

/** `homeworks` is the course order from getOverview, used to name the previous homework. */
export function buildLesson(lesson: Lesson, homeworks: readonly HomeworkSummary[], now: number): LessonView {
  const { homework, progress } = lesson;
  const counts = countExamples(homeworkExamples(homework), progress);
  const focus = resolveFocus(lesson, progress);
  const upNext = upNextKey(lesson, progress, focus?.ruleKey ?? null);
  const features = homework.features.map((feature) =>
    featureView(feature, progress, focus?.ruleKey ?? null, upNext, now),
  );
  const focusFeature = features.find((feature) => feature.rules.some((rule) => rule.key === focus?.ruleKey)) ?? null;
  const focusRule = focusFeature?.rules.find((rule) => rule.key === focus?.ruleKey);
  const index = homeworks.findIndex((summary) => summary.id === homework.id);
  const previous = homeworks.slice(0, Math.max(0, index)).filter((summary) => !summary.builtin).at(-1) ?? null;
  return {
    homeworkId: homework.id,
    title: homework.title,
    eyebrow: homeworkEyebrow(homework.id, homework.set),
    barTitle: `${homeworkLabel(homework.id)} · ${homework.title}`,
    dek: homework.dek,
    status: lesson.status,
    counts,
    percent: percent(counts.passing, counts.total),
    chips: chips(lesson.status, counts, homework),
    compass: compass(homework, previous),
    crumb: focusFeature === null || focusRule === undefined ? null : `${focusFeature.name} › ${focusRule.name}`,
    focus,
    focusFeature,
    otherFeatures: features.filter((feature) => feature !== focusFeature),
    coachThreadId: lesson.coachThreadId,
    readyToComplete: lesson.status === "done" && lesson.iterationStatus === "Done",
  };
}
