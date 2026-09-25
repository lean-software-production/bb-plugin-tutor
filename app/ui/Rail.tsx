// The course outline, BB's sidebar thread list replaced: one tree of lessons,
// each with its coach thread, the coach thread's Rules and its side chats,
// then the project's other threads. BB still draws New thread, Search, the
// plugin nav rows and the footer around it.
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
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
import { homeworkLabel } from "../model/format.ts";
import { buildRail } from "../model/rail.ts";
import type { LessonNode, OutlineRule, RailView, SideRow, ThreadRow } from "../model/rail.ts";
import { railMountedStore, routeStore } from "../state/app-state.ts";
import { NewDot, ReloadButton, coursePageHref, isPlainClick } from "./common.tsx";

const RULE_GLYPHS = { passing: "✓", "not-yet": "!", pending: "○", focus: "●" } as const;
const LESSON_GLYPHS = { done: "✓", current: "●", ahead: "○" } as const;
const OTHER_THREADS_SHOWN = 40;
export const NOT_REACHED_HINT = "Your coach hasn't reached this Rule yet";

export function CourseRail({ activeThreadId, activeProjectId, onNavigate }: PluginThreadListProps) {
  useLiveRefresh();
  const overview = useOverview();
  const sidebar = experimental_useSidebarThreads();
  const route = useStore(routeStore);
  useEffect(() => {
    railMountedStore.set(true);
    return () => railMountedStore.set(false);
  }, []);

  const rail = buildRail({
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
  const factoryProjectId = overview.data?.binding.status === "bound" ? overview.data.binding.projectId : null;

  return (
    <nav className="tutor-paper tp-rail" aria-label="Course outline">
      <a className="tp-rail-brand" href={coursePageHref("")} onClick={(event) => go(event, { kind: "home" })}>
        <span className="tp-brand-mark" aria-hidden>
          ⚙
        </span>
        {rail.brand}
      </a>
      <RailBody rail={rail} go={go} onNavigate={onNavigate} />
      <OtherThreads
        rail={rail}
        status={sidebar.status}
        onNavigate={onNavigate}
        projectId={activeProjectId ?? factoryProjectId}
      />
    </nav>
  );
}

type Go = (event: MouseEvent, target: TutorRoute) => void;

function RailBody({ rail, go, onNavigate }: { rail: RailView; go: Go; onNavigate: () => void }) {
  switch (rail.status.kind) {
    case "loading":
      return <p className="tp-rail-note">Loading the course…</p>;
    case "error":
      return (
        <div className="tp-rail-note tp-rail-note--error" role="alert">
          {rail.status.message}
          <ReloadButton message={rail.status.message} />
        </div>
      );
    case "unbound":
      return (
        <>
          {rail.lessons.map((lesson) => (
            <a
              key={lesson.id}
              className="tp-lesson-row tp-lesson-row--ahead"
              href={coursePageHref(lesson.startPath)}
              onClick={(event) => go(event, { kind: "lesson", homeworkId: lesson.id })}
            >
              <span className="tp-gl-mark" aria-hidden>
                ○
              </span>
              <span className="tp-n">{lesson.id}</span>
              {lesson.title}
            </a>
          ))}
          <a className="tp-setup-card" href={coursePageHref("welcome")} onClick={(event) => go(event, { kind: "welcome" })}>
            {rail.status.missing ? "Your factory project is gone. Pick it again →" : "Set up your factory project →"}
          </a>
        </>
      );
    case "ready":
      return (
        <ul className="tp-tree" aria-label="Lessons">
          {rail.lessons.map((lesson) => (
            <LessonBranch key={lesson.id} lesson={lesson} go={go} onNavigate={onNavigate} />
          ))}
        </ul>
      );
  }
}

function LessonBranch({ lesson, go, onNavigate }: { lesson: LessonNode; go: Go; onNavigate: () => void }) {
  const [open, setOpen] = useState(lesson.expandedByDefault);
  useEffect(() => {
    if (lesson.expandedByDefault) setOpen(true);
  }, [lesson.expandedByDefault]);
  const childrenId = `tp-lesson-${lesson.id}`;
  return (
    <li className={`tp-lesson tp-lesson--${lesson.status}${lesson.isViewed ? " tp-lesson--viewed" : ""}`}>
      <button
        type="button"
        className="tp-lesson-head"
        aria-expanded={open}
        aria-controls={childrenId}
        aria-label={`${homeworkLabel(lesson.id)}, ${lesson.title}, ${lesson.status}, ${lesson.count} examples hold`}
        onClick={() => setOpen(!open)}
      >
        <span className="tp-caret" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="tp-lesson-mark" aria-hidden>
          {LESSON_GLYPHS[lesson.status]}
        </span>
        <span className="tp-lesson-text">
          <span className="tp-lesson-title">
            <span className="tp-n">{lesson.id}</span> {lesson.title}
          </span>
          <span className="tp-lesson-meter" aria-hidden>
            <span className="tp-lesson-bar">
              <i style={{ width: `${lesson.percent}%` }} />
            </span>
            <span className="tp-lesson-count">{lesson.count}</span>
          </span>
        </span>
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
    const { threadId } = await rpc.call("openCoach", { homeworkId: lesson.id });
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
            <span className="tp-ic" aria-hidden>
              ✦
            </span>
            <span className="tp-t">{startCoach.pending ? "Starting your coach…" : "Start with your coach"}</span>
          </button>
        ) : (
          <a
            className="tp-th tp-th--page"
            href={coursePageHref(lesson.startPath)}
            onClick={(event) => go(event, { kind: "lesson", homeworkId: lesson.id })}
          >
            <span className="tp-ic" aria-hidden>
              ¶
            </span>
            <span className="tp-t">{lesson.status === "ahead" ? "Read ahead" : "Open the start page"}</span>
          </a>
        )
      ) : (
        <>
          <ThreadLink row={{ ...coach, title: `Coach · ${homeworkLabel(lesson.id)}` }} onNavigate={onNavigate} />
          <div className="tp-rules" role="group" aria-label={`Rules of ${homeworkLabel(lesson.id)}`}>
            {lesson.features.map((feature) => (
              <div key={feature.slug} className="tp-rule-group">
                <div className="tp-feat">
                  {feature.name}
                  <NewDot novelty={feature.novelty === "new" ? "new" : "unchanged"} />
                </div>
                {feature.rules.map((rule) => (
                  <RuleRow
                    key={rule.key}
                    rule={rule}
                    href={coach.href}
                    onOpen={() => {
                      openRule({ coachThreadId: coach.id, homeworkId: lesson.id, ruleKey: rule.key });
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
            onClick={() => void askSide.run(lesson.id, lesson.status === "current" ? focus : null)}
          >
            <span className="tp-ic" aria-hidden>
              +
            </span>
            <span className="tp-t">{askSide.pending ? "Opening a side chat…" : "Ask a side question"}</span>
          </button>
        </>
      )}
      {errors.map((error) => (
        <div key={error} className="tp-rail-note tp-rail-note--error" role="alert">
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
        {RULE_GLYPHS[rule.glyph]}
      </span>
      <span className="tp-rname">
        {rule.name}
        <NewDot novelty={rule.novelty} />
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
  const icon = row.kind === "coach" ? "✦" : row.kind === "side" ? "↳" : "·";
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
      <span className="tp-ic" aria-hidden>
        {icon}
      </span>
      <span className="tp-t">{row.title}</span>
      {row.indicator.tone === "none" ? null : <span className={`tp-ind tp-ind--${row.indicator.tone}`} aria-hidden />}
    </a>
  );
}

function OtherThreads({
  rail,
  status,
  onNavigate,
  projectId,
}: {
  rail: RailView;
  status: "error" | "loading" | "ready";
  onNavigate: () => void;
  projectId: string | null;
}) {
  const actions = experimental_useSidebarThreadActions();
  const [showAll, setShowAll] = useState(false);
  const total = rail.others.reduce((sum, group) => sum + group.rows.length, 0);
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
        <p className="tp-rail-note">
          {status === "loading" ? "Loading threads…" : status === "error" ? "Threads could not be loaded." : "No other threads."}
        </p>
      ) : null}
      {rail.others.map((group) => {
        if (budget <= 0) return null;
        const rows = group.rows.slice(0, budget);
        budget -= rows.length;
        return (
          <div key={group.projectId} className="tp-other-group">
            {rail.others.length > 1 ? <div className="tp-other-project">{group.name}</div> : null}
            {rows.map((row) => (
              <ThreadLink key={row.id} row={row} onNavigate={onNavigate} />
            ))}
          </div>
        );
      })}
      {total > OTHER_THREADS_SHOWN ? (
        <button type="button" className="tp-rail-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${total}`}
        </button>
      ) : null}
    </>
  );
}
