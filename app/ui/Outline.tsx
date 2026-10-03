// The course outline, BB's sidebar thread list replaced: a tree of lessons
// per course (Tutor's built-in course first), each lesson with its coach
// thread, the coach thread's Rules and its side chats, then the project's
// other threads. BB still draws New thread, Search, the
// plugin nav rows and the footer around it.
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { coachThreadTitle } from "../../shared/constants.ts";
import type { TutorRoute } from "../../shared/routes.ts";
import {
  refreshAll,
  useAction,
  useAskSideQuestion,
  useCourseNavigate,
  useLiveRefresh,
  useOpenRule,
  useOpenSideChat,
  useOverview,
  useStore,
  useTutorRpc,
} from "../hooks.ts";
import { lessonLabel } from "../model/format.ts";
import { buildOutline } from "../model/outline.ts";
import type { AddCourseRow, LessonNode, OutlineRule, OutlineView, SideRow, ThreadRow } from "../model/outline.ts";
import { outlineMountedStore, routeStore } from "../state/app-state.ts";
import { ChangeBadge, ReloadButton, coursePageHref, isPlainClick } from "./common.tsx";
import { Highlight, KitIcon, StepBadge, Tick } from "./sketch/index.ts";

const RULE_GLYPHS = { "not-yet": "!", pending: "○", focus: "●" } as const;
const OTHER_THREADS_SHOWN = 40;
export const NOT_REACHED_HINT = "Your coach hasn't reached this Rule yet";

export function CourseOutline({ activeThreadId, activeProjectId, onNavigate }: PluginThreadListProps) {
  useLiveRefresh();
  const overview = useOverview();
  const sidebar = experimental_useSidebarThreads();
  const route = useStore(routeStore);
  useEffect(() => {
    outlineMountedStore.set(true);
    return () => outlineMountedStore.set(false);
  }, []);

  const outline = buildOutline({
    overview: overview.data,
    overviewError: overview.status === "error" ? overview.error : null,
    threads: sidebar.threads,
    projects: sidebar.projects,
    activeThreadId,
    route,
  });

  const goCourse = useCourseNavigate();
  const go = (event: MouseEvent, target: TutorRoute) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    goCourse(target);
    onNavigate();
  };
  const workspaceProjectId = overview.data?.workspace.status === "found" ? overview.data.workspace.projectId : null;

  return (
    <nav className="tutor-sk tp-outline" aria-label="Course outline">
      <a className="tp-outline-brand" href={coursePageHref("")} onClick={(event) => go(event, { kind: "home" })}>
        <KitIcon name="books" className="tp-brand-mark" />
        {outline.brand}
      </a>
      <OutlineBody outline={outline} go={go} onNavigate={onNavigate} />
      <OtherThreads
        outline={outline}
        status={sidebar.status}
        onNavigate={onNavigate}
        projectId={activeProjectId ?? workspaceProjectId}
      />
    </nav>
  );
}

type Go = (event: MouseEvent, target: TutorRoute) => void;

function OutlineBody({ outline, go, onNavigate }: { outline: OutlineView; go: Go; onNavigate: () => void }) {
  switch (outline.status.kind) {
    case "loading":
      return <p className="tp-outline-note">Loading the course…</p>;
    case "error":
      return (
        <div className="tp-outline-note tp-outline-note--error" role="alert">
          {outline.status.message}
          <ReloadButton message={outline.status.message} />
        </div>
      );
    case "unset":
      return (
        <>
          <LessonsAhead outline={outline} go={go} />
          <CourseErrors errors={outline.errors} />
          <a className="tp-setup-card" href={coursePageHref("welcome")} onClick={(event) => go(event, { kind: "welcome" })}>
            {outline.status.missing ? "Your workspace is gone. Pick it again →" : "Pick your workspace →"}
          </a>
        </>
      );
    case "unreachable":
      return (
        <>
          <LessonsAhead outline={outline} go={go} />
          <CourseErrors errors={outline.errors} />
          <div className="tp-outline-note tp-outline-note--error" role="alert">
            {outline.status.message}
          </div>
        </>
      );
    case "ready":
      return (
        <>
          {outline.groups.map((group, position) => (
            <div key={group.courseId}>
              <GroupLabel outline={outline} title={group.title} />
              <ul className="tp-tree" aria-label={`Lessons of ${group.title}`}>
                {group.lessons.map((lesson, lessonPosition) => (
                  <LessonBranch key={lesson.id} lesson={lesson} position={lessonPosition} go={go} onNavigate={onNavigate} />
                ))}
              </ul>
              {position === 0 ? <AddCourseList addCourses={outline.addCourses} /> : null}
            </div>
          ))}
          <CourseErrors errors={outline.errors} />
        </>
      );
  }
}

/** Each course's lessons, to read ahead, before there is a workspace to coach in. */
function LessonsAhead({ outline, go }: { outline: OutlineView; go: Go }) {
  return (
    <>
      {outline.groups.map((group, position) => (
        <div key={group.courseId} role="group" aria-label={group.title}>
          <GroupLabel outline={outline} title={group.title} />
          {group.lessons.map((lesson, lessonPosition) => (
            <a
              key={lesson.id}
              className="tp-lesson-row tp-lesson-row--ahead"
              href={coursePageHref(lesson.startPath)}
              aria-label={`${lessonLabel(lesson.id)}, ${lesson.title}`}
              data-lesson-id={lesson.id}
              onClick={(event) => go(event, { kind: "start", courseId: lesson.courseId, lessonId: lesson.id })}
            >
              <StepBadge position={lessonPosition} label={Number(lesson.id)} className="tp-n" />
              <span className="tp-ltitle">{lesson.title}</span>
            </a>
          ))}
          {position === 0 ? <AddCourseList addCourses={outline.addCourses} /> : null}
        </div>
      ))}
    </>
  );
}

/** A course's name above its lessons, once there is more than one course to tell apart. */
function GroupLabel({ outline, title }: { outline: OutlineView; title: string }) {
  return outline.groups.length > 1 ? <div className="tp-other-project">{title}</div> : null;
}

/** Catalog courses the student can add (Decision 16), right after the built-in course's group. */
function AddCourseList({ addCourses }: { addCourses: readonly AddCourseRow[] }) {
  return (
    <>
      {addCourses.map((course) => (
        <AddCourseItem key={course.courseId} course={course} />
      ))}
    </>
  );
}

function AddCourseItem({ course }: { course: AddCourseRow }) {
  const rpc = useTutorRpc();
  const goCourse = useCourseNavigate();
  const add = useAction(async () => {
    const { firstLessonId } = await rpc.call("fetchCourse", { courseId: course.courseId });
    refreshAll();
    goCourse({ kind: "start", courseId: course.courseId, lessonId: firstLessonId });
  });
  return (
    <div className="tp-add-course" data-course-id={course.courseId}>
      <div className="tp-add-course-text">
        <span className="tp-add-course-title">{course.title}</span>
        <span className="tp-add-course-desc">{course.description}</span>
      </div>
      <button type="button" className="tp-th tp-th--add" disabled={add.pending} onClick={() => void add.run()}>
        <span className="tp-t">{add.pending ? "Adding the course…" : "Add the course"}</span>
      </button>
      {add.error === null ? null : (
        <div className="tp-outline-note tp-outline-note--error" role="alert">
          {add.error}
          <ReloadButton message={add.error} />
        </div>
      )}
    </div>
  );
}

/** Courses that could not be loaded while others could. */
function CourseErrors({ errors }: { errors: readonly string[] }) {
  return (
    <>
      {errors.map((error) => (
        <div key={error} className="tp-outline-note tp-outline-note--error" role="alert">
          {error}
          <ReloadButton message={error} />
        </div>
      ))}
    </>
  );
}

function LessonBranch({ lesson, position, go, onNavigate }: { lesson: LessonNode; position: number; go: Go; onNavigate: () => void }) {
  const [open, setOpen] = useState(lesson.expandedByDefault);
  useEffect(() => {
    if (lesson.expandedByDefault) setOpen(true);
  }, [lesson.expandedByDefault]);
  const childrenId = `tp-lesson-${lesson.courseId.replace(/[^\w-]/g, "_")}-${lesson.id}`;
  return (
    <li className={`tp-lesson tp-lesson--${lesson.status}${lesson.isViewed ? " tp-lesson--viewed" : ""}`} data-lesson-id={lesson.id} data-course-id={lesson.courseId}>
      <button
        type="button"
        className="tp-lesson-head"
        aria-expanded={open}
        aria-controls={childrenId}
        aria-label={`${lessonLabel(lesson.id)}, ${lesson.title}, ${lesson.status}, ${lesson.count} Examples hold`}
        onClick={() => setOpen(!open)}
      >
        <StepBadge position={position} label={Number(lesson.id)} className="tp-n" />
        <span className="tp-lesson-title tp-ltitle">
          {lesson.status === "current" ? <Highlight>{lesson.title}</Highlight> : lesson.title}
          {lesson.status === "done" ? <Tick className="tp-ltick" /> : null}
        </span>
        <span className="tp-lesson-count tp-lcount">{lesson.count}</span>
      </button>
      {open ? (
        <div id={childrenId} className="tp-lesson-body">
          <LessonThreads lesson={lesson} go={go} onNavigate={onNavigate} />
        </div>
      ) : null}
    </li>
  );
}

function LessonThreads({ lesson, go, onNavigate }: { lesson: LessonNode; go: Go; onNavigate: () => void }) {
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  const openRule = useOpenRule();
  const openSideChat = useOpenSideChat();
  const askSide = useAskSideQuestion(onNavigate);
  const startCoach = useAction(async () => {
    const { threadId } = await rpc.call("openCoach", { courseId: lesson.courseId, lessonId: lesson.id });
    refreshAll();
    navigate.toThread(threadId);
    onNavigate();
  });
  const coach = lesson.coach;
  const focus = lesson.features.flatMap((feature) => feature.rules).find((rule) => rule.isFocus)?.key ?? null;
  const errors = [startCoach.error, askSide.error, openSideChat.error].filter((error): error is string => error !== null);

  return (
    <>
      {coach === null ? (
        lesson.canStartCoach ? (
          <button type="button" className="tp-th tp-th--coach tp-th--start" disabled={startCoach.pending} onClick={() => void startCoach.run()}>
            <KitIcon name="chat" className="tp-ic" />
            <span className="tp-t">{startCoach.pending ? "Starting your coach…" : "Start with your coach"}</span>
          </button>
        ) : (
          <a
            className="tp-th tp-th--page"
            href={coursePageHref(lesson.startPath)}
            onClick={(event) => go(event, { kind: "start", courseId: lesson.courseId, lessonId: lesson.id })}
          >
            <span className="tp-ic" aria-hidden>
              ¶
            </span>
            <span className="tp-t">{lesson.status === "ahead" ? "Read ahead" : "Open the start page"}</span>
          </a>
        )
      ) : (
        <>
          <ThreadLink row={{ ...coach, title: coachThreadTitle(lesson.id) }} onNavigate={onNavigate} />
          <div className="tp-rules" role="group" aria-label={`Rules of ${lessonLabel(lesson.id)}`}>
            {lesson.features.map((feature) => (
              <div key={feature.slug} className="tp-rule-group">
                <div className="tp-feat">
                  {feature.name}
                  <ChangeBadge change={feature.change === "new" ? "new" : "unchanged"} />
                </div>
                {feature.rules.map((rule) => (
                  <RuleRow
                    key={rule.key}
                    rule={rule}
                    href={coach.href}
                    onOpen={() => {
                      openRule({ coachThreadId: coach.id, lessonId: lesson.id, ruleKey: rule.key });
                      onNavigate();
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          {lesson.sideRows.map((row) => (
            <SideLink
              key={row.id}
              row={row}
              onOpen={() => {
                void openSideChat.run(row.id);
                onNavigate();
              }}
              onNavigate={onNavigate}
            />
          ))}
          <button
            type="button"
            className="tp-th tp-th--ask"
            disabled={askSide.pending}
            onClick={() => void askSide.run(lesson.courseId, lesson.id, lesson.status === "current" ? focus : null)}
          >
            <span className="tp-ic" aria-hidden>
              +
            </span>
            <span className="tp-t">{askSide.pending ? "Opening a side chat…" : "Ask a side question"}</span>
          </button>
        </>
      )}
      {errors.map((error) => (
        <div key={error} className="tp-outline-note tp-outline-note--error" role="alert">
          {error}
          <ReloadButton message={error} />
        </div>
      ))}
    </>
  );
}

function RuleRow({ rule, href, onOpen }: { rule: OutlineRule; href: string; onOpen: () => void }) {
  const classes = `tp-rrow tp-rrow--${rule.glyph}${rule.isFocus ? " tp-rrow--focus" : ""}${rule.reached ? "" : " tp-rrow--unreached"}`;
  const body = (
    <>
      <span className="tp-g" aria-hidden>
        {rule.glyph === "passing" ? <Tick /> : RULE_GLYPHS[rule.glyph]}
      </span>
      <span className="tp-rname">
        {rule.isFocus ? <Highlight>{rule.name}</Highlight> : rule.name}
        <ChangeBadge change={rule.change} />
      </span>
    </>
  );
  if (!rule.reached) {
    return (
      <span className={classes} aria-disabled="true" title={NOT_REACHED_HINT} data-rule-key={rule.key}>
        {body}
        <span className="tp-sr-only">, {NOT_REACHED_HINT.toLowerCase()}</span>
      </span>
    );
  }
  return (
    <a
      className={classes}
      href={href}
      aria-current={rule.isFocus ? "step" : undefined}
      title="Show where your coach started this Rule"
      data-rule-key={rule.key}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        onOpen();
      }}
    >
      {body}
    </a>
  );
}

function SideLink({ row, onOpen, onNavigate }: { row: SideRow; onOpen: () => void; onNavigate: () => void }) {
  const classes = ["tp-th", "tp-th--side"];
  if (row.isActive) classes.push("tp-th--on");
  const label = row.indicator.label === null ? row.title : `${row.title} — ${row.indicator.label}`;
  return (
    <a
      className={classes.join(" ")}
      href={row.href}
      aria-current={row.isActive ? "page" : undefined}
      aria-label={row.caption === null ? label : `${label}, ${row.caption}`}
      data-side-kind={row.kind}
      onClick={(event) => {
        if (row.kind === "side-thread") {
          // BB routes a plain click on `href` itself.
          onNavigate();
          return;
        }
        if (!isPlainClick(event)) return;
        event.preventDefault();
        onOpen();
      }}
    >
      <span className="tp-ic" aria-hidden>
        ↳
      </span>
      <span className="tp-side-text">
        <span className="tp-t">{row.title}</span>
        {row.caption === null ? null : <span className="tp-cap">{row.caption}</span>}
      </span>
      {row.indicator.tone === "none" ? null : <span className={`tp-ind tp-ind--${row.indicator.tone}`} aria-hidden />}
    </a>
  );
}

function ThreadLink({ row, onNavigate }: { row: ThreadRow; onNavigate: () => void }) {
  const classes = ["tp-th", `tp-th--${row.kind}`];
  if (row.nested) classes.push("tp-th--nest");
  if (row.isActive) classes.push("tp-th--on");
  const icon = row.kind === "coach" ? <KitIcon name="chat" className="tp-ic" /> : (
    <span className="tp-ic" aria-hidden>
      {row.kind === "sideChat" ? "↳" : "·"}
    </span>
  );
  return (
    <a
      className={classes.join(" ")}
      href={row.href}
      aria-current={row.isActive ? "page" : undefined}
      aria-label={row.indicator.label === null ? row.title : `${row.title} — ${row.indicator.label}`}
      data-sidebar-thread-shortcut-target=""
      data-sidebar-thread-id={row.id}
      // BB routes a plain click on `href` itself; the outline only closes the mobile drawer.
      onClick={() => onNavigate()}
    >
      {icon}
      <span className="tp-t">{row.title}</span>
      {row.indicator.tone === "none" ? null : <span className={`tp-ind tp-ind--${row.indicator.tone}`} aria-hidden />}
    </a>
  );
}

function OtherThreads({
  outline,
  status,
  onNavigate,
  projectId,
}: {
  outline: OutlineView;
  status: "error" | "loading" | "ready";
  onNavigate: () => void;
  projectId: string | null;
}) {
  const actions = experimental_useSidebarThreadActions();
  const [showAll, setShowAll] = useState(false);
  const total = outline.others.reduce((sum, group) => sum + group.rows.length, 0);
  let budget = showAll ? Number.POSITIVE_INFINITY : OTHER_THREADS_SHOWN;
  return (
    <>
      <div className="tp-sep">
        <span>Other threads</span>
        <button
          type="button"
          className="tp-sep-action"
          aria-label="New thread"
          title="New thread"
          onClick={() => {
            actions.openNewThread({ projectId: projectId ?? undefined, focusPrompt: true });
            onNavigate();
          }}
        >
          +
        </button>
      </div>
      {total === 0 ? (
        <p className="tp-outline-note">
          {status === "loading" ? "Loading threads…" : status === "error" ? "We couldn't load your threads." : "No other threads."}
        </p>
      ) : null}
      {outline.others.map((group) => {
        if (budget <= 0) return null;
        const rows = group.rows.slice(0, budget);
        budget -= rows.length;
        return (
          <div key={group.projectId} className="tp-other-group">
            {outline.others.length > 1 ? <div className="tp-other-project">{group.name}</div> : null}
            {rows.map((row) => (
              <ThreadLink key={row.id} row={row} onNavigate={onNavigate} />
            ))}
          </div>
        );
      })}
      {total > OTHER_THREADS_SHOWN ? (
        <button type="button" className="tp-outline-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${total}`}
        </button>
      ) : null}
    </>
  );
}
