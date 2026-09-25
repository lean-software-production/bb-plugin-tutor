// View model of the course outline in BB's sidebar: one tree. Each lesson
// is a top-level row; under it sit its BB threads, the coach thread
// and then its side chats; under the coach thread sit the lesson's Rules,
// grouped by Feature, each leading to its section of the coach thread. Other
// threads follow the tree. Pure, so every state is testable.
import { withoutLeadingDirectives } from "../../shared/directives.ts";
import { formatRoute } from "../../shared/routes.ts";
import type { TutorRoute } from "../../shared/routes.ts";
import type { LessonStatus, Novelty, RuleStatus } from "../../shared/model.ts";
import type { FeatureOutline, LessonSummary, Overview, TutorThread } from "../../shared/rpc.ts";
import { percent } from "./format.ts";
import { indicatorView, isListed } from "./threads.ts";
import type { IndicatorView, SidebarThreadLike } from "./threads.ts";

export interface OutlineInput {
  overview: Overview | null;
  /** Why the overview could not be fetched (the outline still lists threads). */
  overviewError: string | null;
  threads: readonly SidebarThreadLike[];
  projects: readonly { id: string; name: string }[];
  activeThreadId: string | null;
  /** The Tutor page on screen, or null anywhere else in BB. */
  route: TutorRoute | null;
}

export type RuleGlyph = RuleStatus | "focus";

export interface OutlineRule {
  key: string;
  name: string;
  glyph: RuleGlyph;
  isFocus: boolean;
  novelty: Novelty;
  /** The coach has started it in the coach thread, so it has a section to jump to. */
  reached: boolean;
}

export interface OutlineFeature {
  slug: string;
  name: string;
  novelty: Novelty;
  rules: OutlineRule[];
}

export type ThreadRowKind = "coach" | "side" | "plain";

export interface ThreadRow {
  id: string;
  href: string;
  title: string;
  kind: ThreadRowKind;
  nested: boolean;
  isActive: boolean;
  indicator: IndicatorView;
}

/**
 * A side chat (a hidden fork of the coach thread, shown in its right panel)
 * or a side thread from before side chats (a thread of its own).
 */
export interface SideRow {
  id: string;
  kind: "side-chat" | "side-thread";
  title: string;
  /** "from: <Rule>" when it was started about a Rule. */
  caption: string | null;
  /** A side chat opens in the coach thread; a side thread is a thread of its own. */
  href: string;
  isActive: boolean;
  indicator: IndicatorView;
}

export interface LessonNode {
  id: string;
  title: string;
  status: LessonStatus;
  /** "3/9" Examples hold. */
  count: string;
  percent: number;
  expandedByDefault: boolean;
  /** The lesson on screen: its start page, its coach thread or one of its side threads. */
  isViewed: boolean;
  coach: ThreadRow | null;
  /** No coach thread yet, and this is the lesson the student is on. */
  canStartCoach: boolean;
  sideRows: SideRow[];
  /** Under the coach thread: empty until it exists. */
  features: OutlineFeature[];
  /** The start page, for a lesson without a coach thread. */
  startPath: string;
}

export interface OtherThreadGroup {
  projectId: string;
  name: string;
  rows: ThreadRow[];
}

export type OutlineStatus =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unbound"; missing: boolean }
  | { kind: "ready" };

export interface OutlineView {
  brand: string;
  status: OutlineStatus;
  lessons: LessonNode[];
  others: OtherThreadGroup[];
}

/** BB's own thread URL, for a coach thread the sidebar has not listed yet. */
export function threadHref(threadId: string): string {
  return `/threads/${threadId}`;
}

function statusOf(input: OutlineInput): OutlineStatus {
  const { overview } = input;
  if (overview === null) {
    return input.overviewError === null ? { kind: "loading" } : { kind: "error", message: input.overviewError };
  }
  if (overview.course === null) {
    return { kind: "error", message: overview.courseError ?? "The course could not be loaded." };
  }
  if (overview.binding.status !== "bound") {
    return { kind: "unbound", missing: overview.binding.status === "missing" };
  }
  return { kind: "ready" };
}

function features(outline: readonly FeatureOutline[]): OutlineFeature[] {
  return outline.map((feature) => ({
    slug: feature.slug,
    name: feature.name,
    novelty: feature.novelty,
    rules: feature.rules.map((rule) => ({
      key: rule.key,
      name: rule.name,
      glyph: rule.status === "passing" ? "passing" : rule.isFocus ? "focus" : rule.status,
      isFocus: rule.isFocus,
      novelty: rule.novelty,
      reached: rule.reached,
    })),
  }));
}

function byRecent(a: SidebarThreadLike, b: SidebarThreadLike): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  return b.updatedAt - a.updatedAt;
}

/**
 * The side chats and side threads of a coach thread, oldest first: as the
 * backend lists them (Tutor's, and BB's own side chats), with live status from
 * BB's sidebar list when it has the thread, plus any side chat the sidebar
 * shows before the backend does.
 */
function sideRowsOf(
  coachId: string,
  lesson: LessonSummary,
  tutorThreads: readonly TutorThread[],
  liveById: ReadonlyMap<string, SidebarThreadLike>,
  activeThreadId: string | null,
): SideRow[] {
  const ruleNames = new Map(lesson.outline.flatMap((feature) => feature.rules.map((rule) => [rule.key, rule.name] as const)));
  const listed = tutorThreads.filter((thread) => thread.role === "side" && thread.mainThreadId === coachId);
  const listedIds = new Set(listed.map((thread) => thread.id));
  const liveOnly = [...liveById.values()].filter(
    (thread) => !listedIds.has(thread.id) && thread.sourceThreadId === coachId && thread.isHidden && !thread.isArchived,
  );
  const rows = [
    ...listed.map((tutor) => ({ id: tutor.id, sideChat: tutor.sideChat, tutor, live: liveById.get(tutor.id) })),
    ...liveOnly.map((live) => ({ id: live.id, sideChat: true, tutor: undefined, live })),
  ].filter((row) => row.live?.isArchived !== true);
  return rows
    .sort((a, b) => (a.live?.createdAt ?? 0) - (b.live?.createdAt ?? 0))
    .map(({ id, sideChat, tutor, live }) => {
      const ruleKey = tutor?.ruleKey ?? null;
      const ruleName = ruleKey === null ? undefined : ruleNames.get(ruleKey);
      return {
        id,
        kind: sideChat ? "side-chat" : "side-thread",
        title: withoutLeadingDirectives(tutor?.title ?? live?.displayTitle ?? "") || "Side chat",
        caption: ruleName === undefined ? null : `from: ${ruleName}`,
        href: sideChat ? threadHref(coachId) : (live?.href ?? threadHref(id)),
        isActive: id === activeThreadId,
        indicator: live === undefined ? { tone: "none", label: null } : indicatorView(live),
      };
    });
}

/** Which lesson is on screen: the start page's, or that of the open coach thread or side thread. */
export function viewedLesson(
  route: TutorRoute | null,
  activeThreadId: string | null,
  lessons: readonly { id: string; coachThreadId: string | null }[],
  threads: readonly Pick<SidebarThreadLike, "id" | "parentThreadId" | "sourceThreadId">[],
): string | null {
  if (route !== null && (route.kind === "start" || route.kind === "complete")) return route.lessonId;
  if (activeThreadId === null) return null;
  const active = threads.find((thread) => thread.id === activeThreadId);
  const coachId = active?.sourceThreadId ?? active?.parentThreadId ?? activeThreadId;
  return lessons.find((lesson) => lesson.coachThreadId === coachId || lesson.coachThreadId === activeThreadId)?.id ?? null;
}

export function buildOutline(input: OutlineInput): OutlineView {
  const { overview, activeThreadId } = input;
  const status = statusOf(input);
  const summaries = overview?.course === null ? [] : (overview?.lessons ?? []);
  const tutorById = new Map((overview?.threads ?? []).map((thread) => [thread.id, thread]));
  const liveById = new Map(input.threads.map((thread) => [thread.id, thread]));
  const ready = status.kind === "ready";
  const viewed = viewedLesson(input.route, activeThreadId, summaries, input.threads);

  const row = (live: SidebarThreadLike, kind: ThreadRowKind, nested: boolean): ThreadRow => ({
    id: live.id,
    href: live.href,
    title: live.displayTitle || tutorById.get(live.id)?.title || "Untitled thread",
    kind,
    nested,
    isActive: live.id === activeThreadId,
    indicator: indicatorView(live),
  });

  const lessons = summaries.map((lesson): LessonNode => {
    const coachId = ready ? lesson.coachThreadId : null;
    const live = coachId === null ? undefined : liveById.get(coachId);
    const coach: ThreadRow | null =
      coachId === null
        ? null
        : live === undefined
          ? {
              id: coachId,
              href: threadHref(coachId),
              title: tutorById.get(coachId)?.title ?? "Coach",
              kind: "coach",
              nested: false,
              isActive: coachId === activeThreadId,
              indicator: { tone: "none", label: null },
            }
          : row(live, "coach", false);
    return {
      id: lesson.id,
      title: lesson.title,
      status: lesson.status,
      count: `${lesson.counts.passing}/${lesson.counts.total}`,
      percent: percent(lesson.counts.passing, lesson.counts.total),
      expandedByDefault: ready && (lesson.status === "current" || lesson.id === viewed),
      isViewed: lesson.id === viewed,
      coach,
      canStartCoach: ready && coachId === null && lesson.status === "current",
      sideRows: coachId === null ? [] : sideRowsOf(coachId, lesson, overview?.threads ?? [], liveById, activeThreadId),
      features: coachId === null ? [] : features(lesson.outline),
      startPath: formatRoute({ kind: "start", lessonId: lesson.id }),
    };
  });

  const others = otherGroups(
    input.threads.filter(isListed).filter((thread) => !tutorById.has(thread.id)),
    input.projects,
    (live, nested) => row(live, "plain", nested),
  );

  return { brand: overview?.course?.title ?? "Tutor", status, lessons, others };
}

/** Non-course threads, grouped by project, children nested under their parent. */
function otherGroups(
  threads: readonly SidebarThreadLike[],
  projects: readonly { id: string; name: string }[],
  toRow: (thread: SidebarThreadLike, nested: boolean) => ThreadRow,
): OtherThreadGroup[] {
  const byProject = new Map<string, SidebarThreadLike[]>();
  for (const thread of threads) {
    const group = byProject.get(thread.projectId) ?? [];
    group.push(thread);
    byProject.set(thread.projectId, group);
  }
  const groups = [...byProject.entries()].map(([projectId, members]) => {
    const ids = new Set(members.map((thread) => thread.id));
    const children = new Map<string, SidebarThreadLike[]>();
    const roots: SidebarThreadLike[] = [];
    for (const thread of members) {
      const parent = thread.parentThreadId;
      if (parent !== null && ids.has(parent)) children.set(parent, [...(children.get(parent) ?? []), thread]);
      else roots.push(thread);
    }
    const rows: ThreadRow[] = [];
    const visit = (thread: SidebarThreadLike, nested: boolean) => {
      rows.push(toRow(thread, nested));
      for (const child of (children.get(thread.id) ?? []).sort(byRecent)) visit(child, true);
    };
    for (const root of roots.sort(byRecent)) visit(root, false);
    return {
      projectId,
      name: projects.find((project) => project.id === projectId)?.name ?? "Threads",
      rows,
      latest: Math.max(...members.map((thread) => thread.updatedAt)),
    };
  });
  return groups
    .sort((a, b) => b.latest - a.latest)
    .map(({ projectId, name, rows }) => ({ projectId, name, rows }));
}
