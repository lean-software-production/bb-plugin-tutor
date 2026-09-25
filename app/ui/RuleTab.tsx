// The "Rule" tab in a thread's right panel (mockups 2C and 4): the Rule a side
// thread was spun off from, or the one in focus, with its Examples.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { useCourseNavigate, useLiveRefresh, useQuery, useTutorRpc } from "../hooks.ts";
import { parseRuleTabParams, ruleTabTarget, ruleTabView } from "../model/rule-tab.ts";
import { QUERY_KEYS } from "../state/app-state.ts";
import { Bar, ErrorNotice, InlineText, Loading } from "./common.tsx";

const GLYPHS = { passing: "✓", "not-yet": "!", pending: "○", skipped: "–" } as const;

export function RuleTab({ threadId, params }: PluginThreadPanelProps) {
  useLiveRefresh();
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  const goCourse = useCourseNavigate();
  const context = useQuery(QUERY_KEYS.threadContext(threadId), () => rpc.call("getThreadContext", { threadId }));
  const thread = context.data?.thread ?? null;
  const target = context.data === null ? null : ruleTabTarget(parseRuleTabParams(params), thread);
  const homeworkId = target?.homeworkId ?? null;
  // The fetcher only runs for a non-null key, so homeworkId is set whenever it is called.
  const lesson = useQuery(homeworkId === null ? null : QUERY_KEYS.lesson(homeworkId), () =>
    rpc.call("getLesson", { homeworkId: homeworkId ?? "" }),
  );

  const body = () => {
    if (context.data === null) {
      return context.status === "error" ? <ErrorNotice message={context.error} /> : <Loading label="Loading…" />;
    }
    if (target === null) {
      return (
        <p className="tp-yah-note">
          This tab shows a Rule from your course. Open it from a coach thread, a side thread, or a progress card.
        </p>
      );
    }
    if (lesson.data === null) {
      return lesson.status === "error" ? <ErrorNotice message={lesson.error} /> : <Loading label="Loading the Rule…" />;
    }
    const view = ruleTabView(lesson.data, target, thread?.role === "side");
    const coachThreadId = lesson.data.coachThreadId;
    const openLesson = (ruleKey: string | null) => goCourse({ kind: "lesson", homeworkId: target.homeworkId }, { ruleKey });
    if (view.kind === "no-rule") {
      return (
        <>
          <p className="tp-yah-note">No Rule is in focus yet. Your coach picks one when you start.</p>
          <div className="tp-acts">
            <button type="button" className="tp-pri" onClick={() => openLesson(null)}>
              Open lesson
            </button>
          </div>
        </>
      );
    }
    const ruleKey = target.ruleKey ?? lesson.data.focus;
    return (
      <>
        <p className="tp-eyebrow">{view.eyebrow}</p>
        <h3 className="tp-h3">{view.title}</h3>
        <Bar percent={view.percent} label={`${view.passing} of ${view.total} examples hold`} />
        <div className="tp-lbl">
          <span>
            {view.passing} of {view.total} examples hold
          </span>
        </div>
        <div className="tp-now">
          <p className="tp-section-label">{view.examples.length === 1 ? "Example" : "Examples"}</p>
          {view.examples.map((example) => (
            <div key={example.key} className="tp-now-ex">
              <div className="tp-t">{example.name}</div>
              <div className={`tp-ex tp-ex--${example.status}`}>
                <span className="tp-g" aria-hidden>
                  {GLYPHS[example.status]}
                </span>
                <span>
                  <InlineText text={example.detail} />
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="tp-acts">
          {thread?.role === "side" && coachThreadId !== null ? (
            <button type="button" onClick={() => navigate.toThread(coachThreadId)}>
              Back to coach
            </button>
          ) : null}
          <button type="button" className="tp-pri" onClick={() => openLesson(ruleKey)}>
            Open lesson
          </button>
        </div>
      </>
    );
  };

  return <div className="tutor-grid tutor-paper tp-yah">{body()}</div>;
}
