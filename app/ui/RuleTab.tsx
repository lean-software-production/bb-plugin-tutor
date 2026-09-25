// The "Rule" tab in a thread's right panel (mockups 2C and 4), an optional
// reference: the Rule a side chat was started about, or the one in focus,
// with its Examples, a way to its section of the coach thread and "Work on
// this Rule next".
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useAction, useLiveRefresh, useOpenRule, useQuery, useTutorRpc } from "../hooks.ts";
import { parseRuleTabParams, ruleTabTarget, ruleTabView } from "../model/rule-tab.ts";
import { QUERY_KEYS } from "../state/app-state.ts";
import { Bar, ErrorNotice, InlineText, Loading } from "./common.tsx";

const GLYPHS = { passing: "✓", "not-yet": "!", pending: "○", skipped: "–" } as const;

export function RuleTab({ threadId, params }: PluginThreadPanelProps) {
  useLiveRefresh();
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  const openRule = useOpenRule();
  const redirect = useAction(async (lessonId: string, ruleKey: string) => {
    await rpc.call("redirectFocus", { lessonId, ruleKey });
    toast.success("Asked your coach to move to this Rule.");
  });
  const context = useQuery(QUERY_KEYS.threadContext(threadId), () => rpc.call("getThreadContext", { threadId }));
  const thread = context.data?.thread ?? null;
  const target = context.data === null ? null : ruleTabTarget(parseRuleTabParams(params), thread);
  const lessonId = target?.lessonId ?? null;
  // The fetcher only runs for a non-null key, so lessonId is set whenever it is called.
  const detail = useQuery(lessonId === null ? null : QUERY_KEYS.lessonDetail(lessonId), () =>
    rpc.call("getLessonDetail", { lessonId: lessonId ?? "" }),
  );

  const body = () => {
    if (context.data === null) {
      return context.status === "error" ? <ErrorNotice message={context.error} /> : <Loading label="Loading…" />;
    }
    if (target === null) {
      return (
        <p className="tp-yah-note">
          This tab shows a Rule from your course. Open it from a coach thread, a side chat, or a progress card.
        </p>
      );
    }
    if (detail.data === null) {
      return detail.status === "error" ? <ErrorNotice message={detail.error} /> : <Loading label="Loading the Rule…" />;
    }
    const view = ruleTabView(detail.data, target, thread?.role === "side");
    const coachThreadId = detail.data.coachThreadId;
    if (view.kind === "no-rule") {
      return <p className="tp-yah-note">No Rule is in focus yet. Your coach picks one when you start.</p>;
    }
    const ruleKey = target.ruleKey ?? detail.data.focus;
    const reached = ruleKey !== null && detail.data.reachedRules.includes(ruleKey);
    const canRedirect = detail.data.status === "current" && ruleKey !== null && ruleKey !== detail.data.focus;
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
          {reached && coachThreadId !== null && ruleKey !== null ? (
            <button type="button" className="tp-pri" onClick={() => openRule({ coachThreadId, lessonId: target.lessonId, ruleKey })}>
              Show in the conversation
            </button>
          ) : null}
          {canRedirect ? (
            <button type="button" disabled={redirect.pending} onClick={() => void redirect.run(target.lessonId, ruleKey)}>
              Work on this Rule next
            </button>
          ) : null}
        </div>
        {redirect.error === null ? null : <ErrorNotice message={redirect.error} />}
      </>
    );
  };

  return <div className="tutor-grid tutor-paper tp-yah">{body()}</div>;
}
