// The route `start/<course>/<id>[/<rule>]`. The coach lives in BB's own thread view,
// with the lesson carried into it by the lesson card and Rule cards, so a
// lesson that has a coach thread opens it (at the Rule's section when the
// route names one). A lesson without one shows its start page: the lesson
// (Sketchbook mockup "outline") and "Start with your coach".
import { useCallback, useEffect, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { WORKSPACE_UNREACHABLE_TEXT } from "../../shared/constants.ts";
import { formatRoute } from "../../shared/routes.ts";
import { refreshAll, useAction, useCourseNavigate, useOpenRule, useOverview, useQuery, useTutorRpc } from "../hooks.ts";
import { lessonLabel } from "../model/format.ts";
import { buildLesson, coachStart, foldsHiding } from "../model/lesson.ts";
import type { CoachStart, LessonView } from "../model/lesson.ts";
import { QUERY_KEYS } from "../state/app-state.ts";
import { ErrorNotice, Loading, coursePageHref, isPlainClick } from "./common.tsx";
import { Lesson } from "./Lesson.tsx";
import { Button, Meter, Tick } from "./sketch/index.ts";

/** Marks the history entry that already sent the student on to the coach thread, so Back lands here instead of bouncing. */
const REDIRECTED = "tutorOpenedCoach";

function toggled(set: ReadonlySet<string>, key: string, open?: boolean): Set<string> {
  const next = new Set(set);
  if (open ?? !next.has(key)) next.add(key);
  else next.delete(key);
  return next;
}

function redirectedHere(): boolean {
  const state: unknown = window.history.state;
  return typeof state === "object" && state !== null && (state as Record<string, unknown>)[REDIRECTED] === true;
}

function markRedirected(): void {
  const state: unknown = window.history.state;
  window.history.replaceState({ ...(typeof state === "object" && state !== null ? state : {}), [REDIRECTED]: true }, "");
}

/** `ruleKey` is the Rule named in the URL. */
export function StartPage({ courseId, lessonId, ruleKey }: { courseId: string; lessonId: string; ruleKey: string | null }) {
  const rpc = useTutorRpc();
  const overview = useOverview();
  const detail = useQuery(QUERY_KEYS.lessonDetail(courseId, lessonId), () => rpc.call("getLessonDetail", { courseId, lessonId }));
  if (detail.data === null) {
    return (
      <div className="tutor-sk tp-lt">
        <div className="tutor-sk tp-lt-message">
          {detail.status === "error" ? <ErrorNotice message={detail.error} /> : <Loading label="Loading the lesson…" />}
        </div>
      </div>
    );
  }
  if (detail.data.coachThreadId !== null) {
    return <ToCoach lessonId={lessonId} coachThreadId={detail.data.coachThreadId} ruleKey={ruleKey} reached={detail.data.reachedRules} />;
  }
  const lessons = overview.data?.courses.find((entry) => entry.course.id === courseId)?.lessons ?? [];
  const view = buildLesson(detail.data, lessons, Date.now());
  const canStart = lessons.find((lesson) => lesson.id === lessonId)?.canStart ?? false;
  const start = coachStart(view.status, overview.data?.workspace.status ?? null, canStart);
  return (
    <StartPageBody
      key={lessonId}
      courseId={courseId}
      view={view}
      start={start}
      urlRuleKey={ruleKey}
      staleError={detail.status === "error" ? detail.error : null}
    />
  );
}

/** Opens the coach thread once per visit of this page; Back to it shows a link instead of bouncing again. */
function ToCoach({
  lessonId,
  coachThreadId,
  ruleKey,
  reached,
}: {
  lessonId: string;
  coachThreadId: string;
  ruleKey: string | null;
  reached: readonly string[];
}) {
  const navigate = useBbNavigate();
  const openRule = useOpenRule();
  const open = useCallback(() => {
    if (ruleKey !== null && reached.includes(ruleKey)) openRule({ coachThreadId, lessonId, ruleKey });
    else navigate.toThread(coachThreadId);
  }, [coachThreadId, lessonId, navigate, openRule, reached, ruleKey]);
  useEffect(() => {
    if (redirectedHere()) return;
    markRedirected();
    open();
    // Once per page visit, not once per render.
  }, [coachThreadId, ruleKey]);
  return (
    <div className="tutor-sk tp-lt">
      <div className="tutor-sk tp-lt-message">
        <p className="tp-eyebrow">{lessonLabel(lessonId)}</p>
        <p className="tp-prose">Your coach for {lessonLabel(lessonId).toLowerCase()} is in its thread.</p>
        <Button onClick={open}>Open the coach thread →</Button>
      </div>
    </div>
  );
}

function StartPageBody({
  courseId,
  view,
  start,
  urlRuleKey,
  staleError,
}: {
  courseId: string;
  view: LessonView;
  start: CoachStart;
  urlRuleKey: string | null;
  staleError: string | null;
}) {
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  const goCourse = useCourseNavigate();
  const lessonId = view.lessonId;
  const [openRules, setOpenRules] = useState<ReadonlySet<string>>(new Set());
  const [openFeatures, setOpenFeatures] = useState<ReadonlySet<string>>(new Set());

  // A Rule named in the URL: open it and whatever folds hide it, then scroll there.
  useEffect(() => {
    if (urlRuleKey === null) return;
    for (const fold of foldsHiding(view, urlRuleKey)) setOpenFeatures((set) => toggled(set, fold, true));
    setOpenRules((set) => toggled(set, urlRuleKey, true));
    requestAnimationFrame(() =>
      document.querySelector(`[data-rule-key="${CSS.escape(urlRuleKey)}"]`)?.scrollIntoView({ block: "start" }),
    );
    // Once per Rule in the URL.
  }, [urlRuleKey]);

  const openCoach = useAction(async () => {
    // A lesson ahead that is its course's next (start-next) is adopted, as the completion page's Start does.
    const { threadId } =
      start === "start-next" ? await rpc.call("startNextLesson", { courseId, lessonId }) : await rpc.call("openCoach", { courseId, lessonId });
    refreshAll();
    navigate.toThread(threadId);
  });

  const completeHref = coursePageHref(formatRoute({ kind: "complete", courseId, lessonId }));
  return (
    <div className="tutor-sk tp-lt">
      <header className="tutor-sk tp-lthd">
        <b>{view.barTitle}</b>
        {view.crumb === null ? null : <span className="tp-crumb">{view.crumb}</span>}
        <span className="tp-sp" />
        <Meter
          className="tp-lthd-meter"
          value={view.counts.passing}
          max={view.counts.total}
          label="Examples that hold"
          unit={view.counts.total === 1 ? "Example holds" : "Examples hold"}
        />
      </header>
      <div className="tp-lt-body">
        <div className="tutor-sk tp-lead">
          <Lesson
            view={view}
            openRules={openRules}
            openFeatures={openFeatures}
            onToggleRule={(key) => setOpenRules((set) => toggled(set, key))}
            onToggleFeature={(slug) => setOpenFeatures((set) => toggled(set, slug))}
            banner={
              <>
                {staleError === null ? null : <ErrorNotice message={staleError} />}
                {view.readyToComplete ? (
                  <a
                    className="tp-banner"
                    href={completeHref}
                    onClick={(event) => {
                      if (!isPlainClick(event)) return;
                      event.preventDefault();
                      goCourse({ kind: "complete", courseId, lessonId });
                    }}
                  >
                    <Tick /> You finished {lessonLabel(lessonId).toLowerCase()}. See what's next →
                  </a>
                ) : null}
              </>
            }
          />
          <StartCoach
            start={start}
            pending={openCoach.pending}
            error={openCoach.error}
            onStart={() => void openCoach.run()}
            onSetUp={() => goCourse({ kind: "welcome" })}
          />
        </div>
      </div>
    </div>
  );
}

function StartCoach({
  start,
  pending,
  error,
  onStart,
  onSetUp,
}: {
  start: CoachStart;
  pending: boolean;
  error: string | null;
  onStart: () => void;
  onSetUp: () => void;
}) {
  switch (start) {
    case "loading":
      return null;
    case "read-ahead":
      return (
        <div className="tp-start">
          <p className="tp-prose">
            This lesson comes after the one you're on. Read ahead as much as you like; your coach picks it up when you get
            here.
          </p>
        </div>
      );
    case "set-up":
      return (
        <div className="tp-start">
          <p className="tp-prose">
            Your coach works in your workspace. Pick that project first, then come back to start with your coach.
          </p>
          <Button onClick={onSetUp}>Pick your workspace →</Button>
        </div>
      );
    case "unreachable":
      return (
        <div className="tp-start">
          <ErrorNotice message={WORKSPACE_UNREACHABLE_TEXT} />
        </div>
      );
    case "start":
    case "start-next":
    case "revisit":
      return (
        <div className="tp-start">
          <p className="tp-prose">
            {start === "revisit"
              ? "You finished this lesson. Open a coach thread to look back at how it went."
              : "Your coach works through this lesson with you, one Rule at a time, in your workspace. The conversation opens in its own thread, with this lesson at the top."}
          </p>
          <Button disabled={pending} onClick={onStart}>
            {pending ? "Starting…" : start === "revisit" ? "Open a coach thread →" : "Start with your coach →"}
          </Button>
          {error === null ? null : <ErrorNotice message={error} />}
        </div>
      );
  }
}
