// View model of the course rail (mockup 1B): brand, days strip, progress
// card, the current homework's features and Rules, then Conversations,
// Earlier homeworks and Other threads. Pure, so every state is testable.
import { formatRoute } from "../../shared/routes.ts";
import type { TutorRoute } from "../../shared/routes.ts";
import type { HomeworkStatus, Novelty, RuleStatus } from "../../shared/model.ts";
import type { Overview, TutorThread } from "../../shared/rpc.ts";
import { homeworkLabel, percent } from "./format.ts";
import { indicatorView, isListed } from "./threads.ts";
import type { IndicatorView, SidebarThreadLike } from "./threads.ts";

export interface RailInput {
  overview: Overview | null;
  /** Why the overview could not be fetched (the rail still lists threads). */
  overviewError: string | null;
  threads: readonly SidebarThreadLike[];
  projects: readonly { id: string; name: string }[];
  activeThreadId: string | null;
  /** The Tutor page on screen, or null anywhere else in BB. */
  route: TutorRoute | null;
}

export interface DayChip {
  id: string;
  title: string;
  status: HomeworkStatus;
  /** The homework the student is looking at right now. */
  isViewed: boolean;
  subPath: string;
}

export interface ProgressCardView {
  eyebrow: string;
  title: string;
  passing: number;
  total: number;
  fresh: number;
  percent: number;
  complete: boolean;
  route: TutorRoute;
}

export type RuleGlyph = RuleStatus | "focus";

export interface RailRule {
  key: string;
  name: string;
  glyph: RuleGlyph;
  isFocus: boolean;
  novelty: Novelty;
}

export interface RailFeature {
  slug: string;
  name: string;
  novelty: Novelty;
  count: string;
  /** Every Rule passes: drawn quieter. */
  dim: boolean;
  expandedByDefault: boolean;
  rules: RailRule[];
}

export type ThreadRowKind = "coach" | "side" | "plain";

export interface ThreadRow {
  id: string;
  href: string;
  title: string;
  kind: ThreadRowKind;
  nested: boolean;
  muted: boolean;
  isActive: boolean;
  indicator: IndicatorView;
}

export interface OtherThreadGroup {
  projectId: string;
  name: string;
  rows: ThreadRow[];
}

export type RailStatus =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "unbound"; missing: boolean }
  | { kind: "ready" };

export interface RailView {
  brand: string;
  status: RailStatus;
  days: DayChip[];
  progress: ProgressCardView | null;
  features: RailFeature[];
  /** Homework whose conversations the tray lists; null before the course loads. */
  currentHomeworkId: string | null;
  conversations: ThreadRow[];
  /** No coach thread exists yet for the current homework. */
  canStartCoach: boolean;
  earlier: ThreadRow[];
  others: OtherThreadGroup[];
}

function lessonPath(homeworkId: string): string {
  return formatRoute({ kind: "lesson", homeworkId });
}

/** Which homework is on screen: the route's, or the open coach thread's. */
export function viewedHomework(
  route: TutorRoute | null,
  activeThreadId: string | null,
  tutorThreads: readonly TutorThread[],
): string | null {
  if (route !== null && (route.kind === "lesson" || route.kind === "complete")) return route.homeworkId;
  if (activeThreadId === null) return null;
  return tutorThreads.find((thread) => thread.id === activeThreadId)?.homeworkId ?? null;
}

function statusOf(input: RailInput): RailStatus {
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

function progressCard(overview: Overview): ProgressCardView | null {
  const current = overview.current;
  if (current === null) return null;
  const summary = overview.homeworks.find((homework) => homework.id === current.homeworkId);
  const complete = current.iterationStatus === "Done";
  const set = summary?.set ?? null;
  return {
    eyebrow: set === null ? homeworkLabel(current.homeworkId) : `${homeworkLabel(current.homeworkId)} · ${set}`,
    title: summary?.title ?? homeworkLabel(current.homeworkId),
    passing: current.counts.passing,
    total: current.counts.total,
    fresh: current.counts.fresh,
    percent: percent(current.counts.passing, current.counts.total),
    complete,
    route: { kind: complete ? "complete" : "lesson", homeworkId: current.homeworkId },
  };
}

function features(overview: Overview): RailFeature[] {
  const outline = overview.current?.outline ?? [];
  const holdsFocus = outline.findIndex((feature) => feature.rules.some((rule) => rule.isFocus));
  const firstOpen = outline.findIndex((feature) => feature.rules.some((rule) => rule.status !== "passing"));
  const expanded = holdsFocus >= 0 ? holdsFocus : firstOpen;
  return outline.map((feature, index) => ({
    slug: feature.slug,
    name: feature.name,
    novelty: feature.novelty,
    count: `${feature.counts.passing}/${feature.counts.total}`,
    dim: feature.rules.length > 0 && feature.rules.every((rule) => rule.status === "passing"),
    expandedByDefault: index === expanded,
    rules: feature.rules.map((rule) => ({
      key: rule.key,
      name: rule.name,
      glyph: rule.status === "passing" ? "passing" : rule.isFocus ? "focus" : rule.status,
      isFocus: rule.isFocus,
      novelty: rule.novelty,
    })),
  }));
}

function byRecent(a: SidebarThreadLike, b: SidebarThreadLike): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  return b.updatedAt - a.updatedAt;
}

export function buildRail(input: RailInput): RailView {
  const { overview, activeThreadId } = input;
  const status = statusOf(input);
  const tutorThreads = overview?.threads ?? [];
  const tutorById = new Map(tutorThreads.map((thread) => [thread.id, thread]));
  const listed = input.threads.filter(isListed);
  const liveById = new Map(listed.map((thread) => [thread.id, thread]));

  const viewed = viewedHomework(input.route, activeThreadId, tutorThreads);
  const currentHomeworkId =
    overview?.current?.homeworkId ?? overview?.homeworks.find((homework) => homework.status === "current")?.id ?? null;
  const coachThreadId = overview?.current?.coachThreadId ?? null;
  const onLessonOf = input.route?.kind === "lesson" ? input.route.homeworkId : null;

  const row = (live: SidebarThreadLike, kind: ThreadRowKind, nested: boolean, muted: boolean): ThreadRow => {
    const tutor = tutorById.get(live.id);
    // The lesson page hosts its homework's coach thread, so it counts as open there.
    const hostedByLesson =
      activeThreadId === null && tutor?.role === "main" && onLessonOf !== null && tutor.homeworkId === onLessonOf;
    return {
      id: live.id,
      href: live.href,
      title: live.displayTitle || tutor?.title || "Untitled thread",
      kind,
      nested,
      muted,
      isActive: live.id === activeThreadId || hostedByLesson,
      indicator: indicatorView(live),
    };
  };

  const tutorRows = (homeworkId: string, muted: boolean): ThreadRow[] => {
    const mine = tutorThreads.filter((thread) => thread.homeworkId === homeworkId && liveById.has(thread.id));
    const created = (thread: TutorThread) => liveById.get(thread.id)?.createdAt ?? 0;
    const mains = mine
      .filter((thread) => thread.role === "main")
      .sort((a, b) => Number(b.id === coachThreadId) - Number(a.id === coachThreadId) || created(b) - created(a));
    const sides = mine.filter((thread) => thread.role === "side").sort((a, b) => created(a) - created(b));
    const live = (thread: TutorThread) => liveById.get(thread.id) as SidebarThreadLike;
    return [
      ...mains.map((thread) => row(live(thread), "coach", false, muted)),
      ...sides.map((thread) => row(live(thread), "side", muted, muted)),
    ];
  };

  const conversations = currentHomeworkId === null ? [] : tutorRows(currentHomeworkId, false);
  const earlierIds = [...new Set(tutorThreads.map((thread) => thread.homeworkId))]
    .filter((id) => id !== currentHomeworkId)
    .sort((a, b) => b.localeCompare(a));
  const earlier = earlierIds.flatMap((id) => tutorRows(id, true));

  const others = otherGroups(
    listed.filter((thread) => !tutorById.has(thread.id)),
    input.projects,
    (live, nested) => row(live, "plain", nested, false),
  );

  const ready = status.kind === "ready" && overview !== null;
  return {
    brand: overview?.course?.title ?? "Tutor",
    status,
    days: (overview?.course === null ? [] : (overview?.homeworks ?? [])).map((homework) => ({
      id: homework.id,
      title: homework.title,
      status: homework.status,
      isViewed: homework.id === viewed,
      subPath: lessonPath(homework.id),
    })),
    progress: ready ? progressCard(overview) : null,
    features: ready ? features(overview) : [],
    currentHomeworkId: ready ? currentHomeworkId : null,
    conversations: ready ? conversations : [],
    canStartCoach: ready && currentHomeworkId !== null && !conversations.some((thread) => thread.kind === "coach"),
    earlier: ready ? earlier : [],
    others,
  };
}

/** Non-Tutor threads, grouped by project, children nested under their parent. */
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
