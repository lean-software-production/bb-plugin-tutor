// The course page's sub-path, extended for the frontend: a lesson link may
// name a Rule to open ("start/002/<feature-slug>/<rule-slug>"), so Rule links
// survive a new tab or a reload. shared/routes.ts stays the contract for
// every other sub-path; its parseRoute treats the longer form as home.
import { RULE_KEY_PATTERN } from "../../shared/keys.ts";
import { formatRoute, parseRoute } from "../../shared/routes.ts";
import type { TutorRoute } from "../../shared/routes.ts";

export interface CourseLocation {
  route: TutorRoute;
  /** The Rule a lesson link asks to open, or null. */
  ruleKey: string | null;
}

const START_WITH_RULE = /^start\/(\d{3})\/(.+)$/;

function decoded(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

export function parseCoursePath(subPath: string): CourseLocation {
  const trimmed = subPath.replace(/^\/+|\/+$/g, "");
  const match = START_WITH_RULE.exec(trimmed);
  if (match !== null) {
    const ruleKey = decoded(match[2] ?? "");
    if (ruleKey !== null && RULE_KEY_PATTERN.test(ruleKey)) {
      return { route: { kind: "start", lessonId: match[1] ?? "" }, ruleKey };
    }
  }
  return { route: parseRoute(trimmed), ruleKey: null };
}

/** A rule key's slugs are URL-safe, so its slash stays a readable path separator. */
export function coursePath(route: TutorRoute, ruleKey: string | null = null): string {
  const base = formatRoute(route);
  return route.kind === "start" && ruleKey !== null ? `${base}/${ruleKey}` : base;
}
