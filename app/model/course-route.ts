// The course page's sub-path, extended for the frontend: a lesson link may
// name a Rule to open ("start/<course>/002/<feature-slug>/<rule-slug>"), so
// Rule links survive a new tab or a reload. shared/routes.ts stays the
// contract for every other sub-path; its parseRoute treats the longer form as
// home. Links from before courses ("start/002[/<rule>]") still parse, with no
// course: routeCourse resolves them.
import { BUILTIN_COURSE_ID, BUILTIN_LESSON_ID } from "../../shared/constants.ts";
import { RULE_KEY_PATTERN } from "../../shared/keys.ts";
import { formatRoute, parseRoute } from "../../shared/routes.ts";
import type { TutorRoute } from "../../shared/routes.ts";

export interface CourseLocation {
  route: TutorRoute;
  /** The Rule a lesson link asks to open, or null. */
  ruleKey: string | null;
}

const START_WITH_RULE = /^start\/([^/]+)\/(\d{3})\/(.+)$/;
const LEGACY_START_WITH_RULE = /^start\/(\d{3})\/(.+)$/;

function decoded(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

function withRule(courseId: string | null, lessonId: string, rule: string): CourseLocation | null {
  const ruleKey = decoded(rule);
  return ruleKey !== null && RULE_KEY_PATTERN.test(ruleKey) ? { route: { kind: "start", courseId, lessonId }, ruleKey } : null;
}

export function parseCoursePath(subPath: string): CourseLocation {
  const trimmed = subPath.replace(/^\/+|\/+$/g, "");
  const match = START_WITH_RULE.exec(trimmed);
  const courseId = match === null ? null : decoded(match[1] ?? "");
  const current = match === null || courseId === null || courseId === "" ? null : withRule(courseId, match[2] ?? "", match[3] ?? "");
  if (current !== null) return current;
  const legacy = LEGACY_START_WITH_RULE.exec(trimmed);
  const older = legacy === null ? null : withRule(null, legacy[1] ?? "", legacy[2] ?? "");
  return older ?? { route: parseRoute(trimmed), ruleKey: null };
}

/** A rule key's slugs are URL-safe, so its slash stays a readable path separator. */
export function coursePath(route: TutorRoute, ruleKey: string | null = null): string {
  const base = formatRoute(route);
  return route.kind === "start" && ruleKey !== null ? `${base}/${ruleKey}` : base;
}

/** A course as the overview lists it, enough to place a lesson in it. */
export interface CourseRef {
  course: { id: string };
  builtin: boolean;
  lessons: readonly { id: string }[];
}

/**
 * The course a lesson link means. A link that names its course means that
 * one. One from before courses means the built-in course for Lesson 0, else
 * the other course that has the lesson (the only other course, as there was
 * one). Null when nothing matches.
 */
export function routeCourse(courseId: string | null, lessonId: string, courses: readonly CourseRef[]): string | null {
  if (courseId !== null) return courseId;
  if (lessonId === BUILTIN_LESSON_ID) return BUILTIN_COURSE_ID;
  return courses.find((entry) => !entry.builtin && entry.lessons.some((lesson) => lesson.id === lessonId))?.course.id ?? null;
}
