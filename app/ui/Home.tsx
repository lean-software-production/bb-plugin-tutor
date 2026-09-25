// BB home's "Continue" section (mockup 5) and the Course nav row's accessory.
// BB passes homepageSection a projectId that is usually null, so both read
// the student's place (and the coach thread) from getOverview instead.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginHomepageSectionProps } from "@get-bb/plugin-sdk/app";
import { refreshAll, useAction, useCourseNavigate, useLiveRefresh, useOverview, useTutorRpc } from "../hooks.ts";
import { continueView } from "../model/home.ts";
import { Bar, InlineText, Notice } from "./common.tsx";

export function ContinueSection(_props: PluginHomepageSectionProps) {
  useLiveRefresh();
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  const goCourse = useCourseNavigate();
  const overview = useOverview();
  const view = overview.data === null ? null : continueView(overview.data);
  const homeworkId = view?.kind === "continue" ? view.homeworkId : null;
  const coachThreadId = view?.kind === "continue" ? view.coachThreadId : null;
  const toCoach = useAction(async () => {
    if (coachThreadId !== null) {
      navigate.toThread(coachThreadId);
      return;
    }
    if (homeworkId === null) return;
    const { threadId } = await rpc.call("openCoach", { homeworkId });
    refreshAll();
    navigate.toThread(threadId);
  });

  if (view === null) {
    return overview.status === "error" ? (
      <div className="tutor-paper">
        <Notice tone="error">{overview.error}</Notice>
      </div>
    ) : null;
  }
  if (view.kind === "error") {
    return (
      <div className="tutor-paper">
        <Notice tone="error">{view.message}</Notice>
      </div>
    );
  }
  if (view.kind === "setup") {
    return (
      <div className="tutor-paper tutor-grid tp-hs tp-hs--setup">
        <div className="tp-hs-l">
          <div className="tp-ey">Your course</div>
          <h2>{view.courseTitle}</h2>
          <p>
            {view.missing
              ? "The factory project you chose has gone. Pick it again to carry on."
              : "Pick the project your factory lives in, and your coach can start."}
          </p>
          <button type="button" className="tp-hs-btn" onClick={() => goCourse({ kind: "welcome" })}>
            Set up the course →
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="tutor-paper tutor-grid tp-hs">
      <div className="tp-hs-l">
        <div className="tp-ey">{view.eyebrow}</div>
        <h2>{view.title}</h2>
        <p>
          {view.complete ? (
            "You finished this homework. The next one is ready when you are."
          ) : (
            <>
              {view.focusRuleName === null ? null : (
                <>
                  You're on <b>{view.focusRuleName}</b>.{" "}
                </>
              )}
              {view.lastNote === null ? null : (
                <>
                  Last time, <i>{view.lastNote.exampleName}</i>: <InlineText text={view.lastNote.note} />
                </>
              )}
            </>
          )}
        </p>
        {view.complete ? (
          <button type="button" className="tp-hs-btn" onClick={() => goCourse({ kind: "complete", homeworkId: view.homeworkId })}>
            See what's next →
          </button>
        ) : (
          <button type="button" className="tp-hs-btn" disabled={toCoach.pending} onClick={() => void toCoach.run()}>
            Continue with your coach →
          </button>
        )}
        <button type="button" className="tp-hs-btn tp-hs-btn--ghost" onClick={() => goCourse({ kind: "lesson", homeworkId: view.homeworkId })}>
          Open the lesson
        </button>
        {toCoach.error === null ? null : <Notice tone="error">{toCoach.error}</Notice>}
      </div>
      <div className="tp-hs-r">
        <div className="tp-hs-big">
          {view.passing}
          <span> / {view.total}</span>
        </div>
        examples hold
        <Bar percent={view.percent} label={`${view.passing} of ${view.total} examples hold`} />
        {view.freshRules === 0 ? null : (
          <div className="tp-hs-now">
            <b>New in this homework</b>
            {view.freshRules} {view.freshRules === 1 ? "rule" : "rules"} · {view.freshRulesPassing} done
          </div>
        )}
        {view.doneLabel === null ? null : <div className="tp-hs-done">{view.doneLabel}</div>}
      </div>
    </div>
  );
}

/** "003 · 30/41" at the end of the Course nav row. */
export function CourseAccessory() {
  useLiveRefresh();
  const overview = useOverview();
  const current = overview.data?.current ?? null;
  if (current === null) return null;
  return (
    <span className="tutor-paper tp-accessory">
      <i>{current.homeworkId}</i> · {current.counts.passing}/{current.counts.total}
    </span>
  );
}
