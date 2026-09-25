// The route `start/<id>[/<rule>]`. The coach lives in BB's own thread view,
// with the lesson carried into it by the lesson card and Rule cards, so a
// lesson that has a coach thread opens it (at the Rule's section when the
// route names one). A lesson without one shows its start page: the paper
// lesson (mockups 2A and 6B) and "Start with your coach".
import { useCallback, useEffect, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { formatRoute } from "../../shared/routes.ts";
import { refreshAll, useAction, useCourseNavigate, useOpenRule, useOverview, useQuery, useTutorRpc } from "../hooks.ts";
import { lessonLabel } from "../model/format.ts";
import { buildLesson, coachStart, foldsHiding } from "../model/lesson.ts";
import type { CoachStart, LessonView } from "../model/lesson.ts";
import { QUERY_KEYS } from "../state/app-state.ts";
import { Bar, ErrorNotice, Loading, coursePageHref, isPlainClick } from "./common.tsx";
import { Lesson } from "./Lesson.tsx";

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
export function StartPage({ lessonId, ruleKey }: { lessonId: string; ruleKey: string | null }) {
  const rpc = useTutorRpc();
  const overview = useOverview();
  const detail = useQuery(QUERY_KEYS.lessonDetail(lessonId), () => rpc.call("getLessonDetail", { lessonId }));
  if (detail.data === null) {
    return (
      <div className="tutor-grid tp-lt">
        <div className="tutor-paper tp-lt-message">
          {detail.status === "error" ? <ErrorNotice message={detail.error} /> : <Loading label="Loading the lesson…" />}
        </div>
      </div>
    );
  }
  if (detail.data.coachThreadId !== null) {
    return <ToCoach lessonId={lessonId} coachThreadId={detail.data.coachThreadId} ruleKey={ruleKey} reached={detail.data.reachedRules} />;
  }
  const view = buildLesson(detail.data, overview.data?.lessons ?? [], Date.now());
  const start = coachStart(view.status, overview.data?.factoryProject.status ?? null);
  return (
    <StartPageBody key={lessonId} view={view} start={start} urlRuleKey={ruleKey} staleError={detail.status === "error" ? detail.error : null} />
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
    <div className="tutor-grid tp-lt">
      <div className="tutor-paper tp-lt-message">
        <p className="tp-eyebrow">{lessonLabel(lessonId)}</p>
        <p className="tp-prose">Your coach for {lessonLabel(lessonId).toLowerCase()} is in its thread.</p>
        <button type="button" className="tp-btn tp-btn--big" onClick={open}>
          Open the coach thread →
        </button>
      </div>
    </div>
  );
}

function StartPageBody({
  view,
  start,
  urlRuleKey,
  staleError,
}: {
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
    const { threadId } = await rpc.call("openCoach", { lessonId });
    refreshAll();
    navigate.toThread(threadId);
  });

  const completeHref = coursePageHref(formatRoute({ kind: "complete", lessonId }));
  return (
    <div className="tutor-grid tp-lt">
      <header className="tutor-paper tp-lthd">
        <b>{view.barTitle}</b>
        {view.crumb === null ? null : <span className="tp-crumb">{view.crumb}</span>}
        <span className="tp-sp" />
        <Bar percent={view.percent} label={`${view.counts.passing} of ${view.counts.total} examples hold`} />
        <span>
          {view.counts.passing}/{view.counts.total}
        </span>
      </header>
      <div className="tp-lt-body">
        <div className="tutor-paper tp-lead tp-margin">
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
                      goCourse({ kind: "complete", lessonId });
                    }}
                  >
                    ✓ You finished {lessonLabel(lessonId).toLowerCase()}. See what's next →
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
            Your coach works in your factory project. Pick that project first, then come back to start with your coach.
          </p>
          <button type="button" className="tp-btn tp-btn--big" onClick={onSetUp}>
            Set up your factory project →
          </button>
        </div>
      );
    case "start":
    case "revisit":
      return (
        <div className="tp-start">
          <p className="tp-prose">
            {start === "start"
              ? "Your coach works through this lesson with you, one Rule at a time, in your factory repo. The conversation opens in its own thread, led by this lesson."
              : "You finished this lesson. Open a coach thread to look back at how it went."}
          </p>
          <button type="button" className="tp-btn tp-btn--big" disabled={pending} onClick={onStart}>
            {pending ? "Starting…" : start === "start" ? "Start with your coach →" : "Open a coach thread →"}
          </button>
          {error === null ? null : <ErrorNotice message={error} />}
        </div>
      );
  }
}
