// BB home's "Continue" section (mockup 5) and the Course nav row's accessory.
// The lesson lives in the coach thread, so "Continue with your coach" is the
// way back; a lesson without a coach thread also offers its start page.
// BB passes homepageSection a projectId that is usually null, so both read
// the student's place (and the coach thread) from getOverview instead.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginHomepageSectionProps } from "@get-bb/plugin-sdk/app";
import { refreshAll, useAction, useAddCourse, useCourseNavigate, useLiveRefresh, useOverview, useTutorRpc } from "../hooks.ts";
import { activeCourse, continueView } from "../model/home.ts";
import { ErrorNotice, InlineText } from "./common.tsx";
import { Button, Character, Highlight, Meter, Panel } from "./sketch/index.ts";

export function ContinueSection(_props: PluginHomepageSectionProps) {
  useLiveRefresh();
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  const goCourse = useCourseNavigate();
  const overview = useOverview();
  const view = overview.data === null ? null : continueView(overview.data);
  const lesson = view?.kind === "continue" ? { courseId: view.courseId, lessonId: view.lessonId } : null;
  const coachThreadId = view?.kind === "continue" ? view.coachThreadId : null;
  const toCoach = useAction(async () => {
    if (coachThreadId !== null) {
      navigate.toThread(coachThreadId);
      return;
    }
    if (lesson === null) return;
    const { threadId } = await rpc.call("openCoach", lesson);
    refreshAll();
    navigate.toThread(threadId);
  });
  const addCourse = useAddCourse(view?.kind === "add-course" ? view.courseId : null);

  if (view === null) {
    return overview.status === "error" ? (
      <div className="tutor-sk">
        <ErrorNotice message={overview.error} />
      </div>
    ) : null;
  }
  if (view.kind === "error") {
    return (
      <div className="tutor-sk">
        <ErrorNotice message={view.message} />
      </div>
    );
  }
  if (view.kind === "add-course") {
    return (
      <div className="tutor-sk tp-hs-wrap">
        <Panel tone="teal" className="tp-hs tp-hs--setup">
          <div className="tp-hs-l">
            <p className="tp-eyebrow">Your next course</p>
            <h2 className="sk-title tp-hs-title">
              <Highlight>{view.title}</Highlight>
            </h2>
            <p>{view.description}</p>
            <Button disabled={addCourse.pending} onClick={() => void addCourse.run()}>
              {addCourse.pending ? "Adding the course…" : view.action}
            </Button>
            {addCourse.error === null ? null : <ErrorNotice message={addCourse.error} />}
          </div>
        </Panel>
      </div>
    );
  }
  if (view.kind === "setup") {
    return (
      <div className="tutor-sk tp-hs-wrap">
        <Panel tone="teal" className="tp-hs tp-hs--setup">
          <div className="tp-hs-l">
            <p className="tp-eyebrow">Your course</p>
            <h2 className="sk-title tp-hs-title">
              <Highlight>{view.courseTitle}</Highlight>
            </h2>
            <p>
              {view.missing
                ? "The workspace you chose has gone. Pick it again to carry on."
                : "Pick the project you work in, your workspace. Then your coach can start."}
            </p>
            <Button onClick={() => goCourse({ kind: "welcome" })}>Set up the course →</Button>
          </div>
        </Panel>
      </div>
    );
  }
  return (
    <div className="tutor-sk tp-hs-wrap">
      <Panel tone="teal" className="tp-hs">
        <div className="tp-hs-l">
          <p className="tp-eyebrow">{view.eyebrow}</p>
          <h2 className="sk-title tp-hs-title">
            <Highlight>{view.title}</Highlight>
          </h2>
          <p>
            {view.complete ? (
              "You finished this lesson. The next one is ready when you are."
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
          <div className="tp-hs-acts">
            {view.complete ? (
              <Button onClick={() => goCourse({ kind: "complete", courseId: view.courseId, lessonId: view.lessonId })}>See what's next →</Button>
            ) : (
              <Button disabled={toCoach.pending} onClick={() => void toCoach.run()}>
                Continue with your coach →
              </Button>
            )}
            {view.coachThreadId === null ? (
              <Button secondary onClick={() => goCourse({ kind: "start", courseId: view.courseId, lessonId: view.lessonId })}>
                Open the start page
              </Button>
            ) : null}
          </div>
          {toCoach.error === null ? null : <ErrorNotice message={toCoach.error} />}
        </div>
        <div className="tp-hs-r">
          <div className="tp-hs-big">
            {view.passing}
            <span> / {view.total}</span>
          </div>
          <span className="tp-hs-unit">Examples hold</span>
          {/* The count is in words just above, so the meter's own count is hidden (pages.css). */}
          <Meter className="tp-hs-meter" value={view.passing} max={view.total} label="Examples that hold" unit="Examples hold" />
          {view.freshRules === 0 ? null : (
            <div className="tp-hs-now">
              <b>New in this lesson</b>
              {view.freshRules} {view.freshRules === 1 ? "Rule" : "Rules"} · {view.freshRulesPassing} done
            </div>
          )}
          {view.doneLabel === null ? null : <div className="tp-hs-done">{view.doneLabel}</div>}
        </div>
      </Panel>
      <Character name="explainer" className="tp-edge tp-edge--explainer" />
    </div>
  );
}

/** "003 · 30/41" at the end of the Course nav row. */
export function CourseAccessory() {
  useLiveRefresh();
  const overview = useOverview();
  const current = overview.data === null ? null : (activeCourse(overview.data)?.current ?? null);
  if (current === null) return null;
  return (
    <span className="tutor-sk tp-accessory">
      <i>{current.lessonId}</i> · {current.counts.passing}/{current.counts.total}
    </span>
  );
}
