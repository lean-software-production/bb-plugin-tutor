// The course rail (mockup 1B), BB's sidebar thread list replaced. BB still
// draws New thread, Search, the plugin nav rows and the footer around it.
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { formatRoute } from "../../shared/routes.ts";
import type { TutorRoute } from "../../shared/routes.ts";
import { refreshAll, useAction, useCourseNavigate, useLiveRefresh, useOverview, useStore, useTutorRpc } from "../hooks.ts";
import { homeworkLabel } from "../model/format.ts";
import { buildRail } from "../model/rail.ts";
import type { RailFeature, RailView, ThreadRow } from "../model/rail.ts";
import { railMountedStore, requestRule, routeStore } from "../state/app-state.ts";
import { Bar, NewDot, coursePageHref, isPlainClick } from "./common.tsx";

const RULE_GLYPHS = { passing: "✓", "not-yet": "!", pending: "○", focus: "●" } as const;
const OTHER_THREADS_SHOWN = 40;

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
    <nav className="tutor-paper tp-rail" aria-label="Course">
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
        </div>
      );
    case "unbound":
      return (
        <>
          {rail.days.map((day) => (
            <a
              key={day.id}
              className="tp-lesson-row tp-lesson-row--ahead"
              href={coursePageHref(day.subPath)}
              onClick={(event) => go(event, { kind: "lesson", homeworkId: day.id })}
            >
              <span className="tp-gl-mark" aria-hidden>
                ○
              </span>
              <span className="tp-n">{day.id}</span>
              {day.title}
            </a>
          ))}
          <a className="tp-setup-card" href={coursePageHref("welcome")} onClick={(event) => go(event, { kind: "welcome" })}>
            {rail.status.missing ? "Your factory project is gone. Pick it again →" : "Set up your factory project →"}
          </a>
        </>
      );
    case "ready":
      return <ReadyRail rail={rail} go={go} onNavigate={onNavigate} />;
  }
}

function ReadyRail({ rail, go, onNavigate }: { rail: RailView; go: Go; onNavigate: () => void }) {
  const progress = rail.progress;
  const currentId = rail.currentHomeworkId;
  return (
    <>
      <div className="tp-days" aria-label="Homeworks">
        {rail.days.map((day) => (
          <a
            key={day.id}
            className={`tp-day tp-day--${day.status}${day.isViewed ? " tp-day--viewed" : ""}`}
            href={coursePageHref(day.subPath)}
            title={`${homeworkLabel(day.id)} · ${day.title}`}
            aria-label={`${homeworkLabel(day.id)}, ${day.title}, ${day.status}`}
            aria-current={day.isViewed ? "page" : undefined}
            onClick={(event) => go(event, { kind: "lesson", homeworkId: day.id })}
          >
            {day.id}
          </a>
        ))}
      </div>
      {progress === null ? null : (
        <a
          className="tp-progress-card"
          href={coursePageHref(formatRoute(progress.route))}
          onClick={(event) => go(event, progress.route)}
        >
          <span className="tp-ey">{progress.eyebrow}</span>
          <span className="tp-tt">{progress.title}</span>
          <Bar percent={progress.percent} label={`${progress.passing} of ${progress.total} examples hold`} />
          <span className="tp-lb">
            <span>
              {progress.passing} of {progress.total}
            </span>
            <span>{progress.complete ? "Complete ✓" : `${progress.fresh} new`}</span>
          </span>
        </a>
      )}
      {currentId === null ? null : (
        <div className="tp-outline">
          {rail.features.map((feature) => (
            <RailFeatureGroup key={feature.slug} feature={feature} homeworkId={currentId} go={go} />
          ))}
        </div>
      )}
      <Conversations rail={rail} onNavigate={onNavigate} />
      {rail.earlier.length === 0 ? null : (
        <>
          <div className="tp-sep">
            <span>Earlier homeworks</span>
          </div>
          {rail.earlier.map((row) => (
            <ThreadLink key={row.id} row={row} onNavigate={onNavigate} />
          ))}
        </>
      )}
    </>
  );
}

function RailFeatureGroup({ feature, homeworkId, go }: { feature: RailFeature; homeworkId: string; go: Go }) {
  const [open, setOpen] = useState(feature.expandedByDefault);
  useEffect(() => setOpen(feature.expandedByDefault), [feature.expandedByDefault]);
  return (
    <>
      <button
        type="button"
        className={`tp-feat${feature.dim ? " tp-feat--dim" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>
          {feature.name}
          <NewDot novelty={feature.novelty === "new" ? "new" : "unchanged"} />
        </span>
        <span className="tp-c">
          {feature.count}
          {open ? "" : " ›"}
        </span>
      </button>
      {open
        ? feature.rules.map((rule) => (
            <a
              key={rule.key}
              className={`tp-rrow tp-rrow--${rule.glyph}${rule.isFocus ? " tp-rrow--focus" : ""}`}
              href={coursePageHref(formatRoute({ kind: "lesson", homeworkId }))}
              aria-current={rule.isFocus ? "step" : undefined}
              onClick={(event) => {
                if (isPlainClick(event)) requestRule(homeworkId, rule.key);
                go(event, { kind: "lesson", homeworkId });
              }}
            >
              <span className="tp-g" aria-hidden>
                {RULE_GLYPHS[rule.glyph]}
              </span>
              <span className="tp-rname">
                {rule.name}
                <NewDot novelty={rule.novelty} />
              </span>
            </a>
          ))
        : null}
    </>
  );
}

function Conversations({ rail, onNavigate }: { rail: RailView; onNavigate: () => void }) {
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  const homeworkId = rail.currentHomeworkId;
  const focus = rail.features.flatMap((feature) => feature.rules).find((rule) => rule.isFocus)?.key ?? null;
  const startSide = useAction(async () => {
    if (homeworkId === null) return;
    const { threadId } = await rpc.call("startSideThread", { homeworkId, ruleKey: focus });
    refreshAll();
    navigate.toThread(threadId);
    onNavigate();
  });
  const startCoach = useAction(async () => {
    if (homeworkId === null) return;
    await rpc.call("openCoach", { homeworkId });
    refreshAll();
  });
  if (homeworkId === null) return null;
  return (
    <>
      <div className="tp-sep">
        <span>Conversations</span>
        {rail.canStartCoach ? null : (
          <button
            type="button"
            className="tp-sep-action"
            aria-label="Start a side thread about the Rule in focus"
            title="Start a side thread about the Rule in focus"
            disabled={startSide.pending}
            onClick={() => void startSide.run()}
          >
            +
          </button>
        )}
      </div>
      {rail.canStartCoach ? (
        <button type="button" className="tp-th tp-th--coach tp-th--start" disabled={startCoach.pending} onClick={() => void startCoach.run()}>
          <span className="tp-ic" aria-hidden>
            ✦
          </span>
          <span className="tp-t">{startCoach.pending ? "Starting your coach…" : "Start with your coach"}</span>
        </button>
      ) : null}
      {rail.conversations.map((row) => (
        <ThreadLink key={row.id} row={row} onNavigate={onNavigate} />
      ))}
      {[startSide.error, startCoach.error].map((error) =>
        error === null ? null : (
          <p key={error} className="tp-rail-note tp-rail-note--error" role="alert">
            {error}
          </p>
        ),
      )}
    </>
  );
}

function ThreadLink({ row, onNavigate }: { row: ThreadRow; onNavigate: () => void }) {
  const classes = ["tp-th", `tp-th--${row.kind}`];
  if (row.nested) classes.push("tp-th--nest");
  if (row.muted) classes.push("tp-th--muted");
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
      // BB routes a plain click on `href` itself; the rail only closes the mobile drawer.
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
