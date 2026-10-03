// The "Rule" tab in a thread's right panel (mockups 2C and 4), an optional
// reference: the Rule a side chat was started about, or the one in focus,
// with its Examples, a way to its section of the coach thread and "Work on
// this Rule next".
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useAction, useLiveRefresh, useOpenRule, useOverview, useQuery, useTutorRpc } from "../hooks.ts";
import { routeCourse } from "../model/course-route.ts";
import { parseRuleTabParams, ruleTabTarget, ruleTabView } from "../model/rule-tab.ts";
import { QUERY_KEYS } from "../state/app-state.ts";
import { stepTone } from "../sketch/step-colour.ts";
import { ErrorNotice, InlineText, Loading } from "./common.tsx";
import { Button, Meter, Panel, StepBadge, Tick } from "./sketch/index.ts";

const GLYPHS = { "not-yet": "!", pending: "○", skipped: "–" } as const;

export function RuleTab({ threadId, params }: PluginThreadPanelProps) {
  useLiveRefresh();
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  const openRule = useOpenRule();
  const redirect = useAction(async (courseId: string, lessonId: string, ruleKey: string) => {
    await rpc.call("redirectFocus", { courseId, lessonId, ruleKey });
    toast.success("We've asked your coach to work on this Rule next.");
  });
  const context = useQuery(QUERY_KEYS.threadContext(threadId), () => rpc.call("getThreadContext", { threadId }));
  const thread = context.data?.thread ?? null;
  const overview = useOverview();
  const found = context.data === null ? null : ruleTabTarget(parseRuleTabParams(params), thread);
  // A tab from before courses names no course: the one a link from then would mean (routeCourse).
  const courseId = found === null ? null : (found.courseId ?? routeCourse(null, found.lessonId, overview.data?.courses ?? []));
  const target = found === null || courseId === null ? null : { ...found, courseId };
  const lessonId = target?.lessonId ?? null;
  // The fetcher only runs for a non-null key, so courseId and lessonId are set whenever it is called.
  const detail = useQuery(lessonId === null || courseId === null ? null : QUERY_KEYS.lessonDetail(courseId, lessonId), () =>
    rpc.call("getLessonDetail", { courseId: courseId ?? "", lessonId: lessonId ?? "" }),
  );

  const body = () => {
    if (context.data === null) {
      return context.status === "error" ? <ErrorNotice message={context.error} /> : <Loading label="Loading…" />;
    }
    if (target === null && found !== null && overview.data === null) {
      return overview.status === "error" ? <ErrorNotice message={overview.error} /> : <Loading label="Loading…" />;
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
    const view = ruleTabView(detail.data, target, thread?.role === "sideChat");
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
        <h3 className="sk-step tp-yah-step">
          <StepBadge position={view.number - 1} label={view.number} />
          <span className="sk-label tp-tt">{view.title}</span>
        </h3>
        <Meter
          className="tp-yah-meter"
          value={view.passing}
          max={view.total}
          label="Examples that hold"
          unit={view.total === 1 ? "Example holds" : "Examples hold"}
        />
        <Panel tone={stepTone(view.number - 1)} className="tp-now">
          <p className="tp-eyebrow">{view.examples.length === 1 ? "Example" : "Examples"}</p>
          {view.examples.map((example) => (
            <div key={example.key} className="tp-now-ex">
              <div className="tp-t">{example.name}</div>
              <div className={`tp-ex tp-ex--${example.status}`}>
                {example.status === "passing" ? (
                  <Tick className="tp-g" />
                ) : (
                  <span className="tp-g" aria-hidden>
                    {GLYPHS[example.status]}
                  </span>
                )}
                <span>
                  <InlineText text={example.detail} />
                </span>
              </div>
            </div>
          ))}
        </Panel>
        <div className="tp-acts">
          {thread?.role === "sideChat" && coachThreadId !== null ? (
            <Button secondary onClick={() => navigate.toThread(coachThreadId)}>
              Back to coach
            </Button>
          ) : null}
          {reached && coachThreadId !== null && ruleKey !== null ? (
            <Button className="tp-pri" onClick={() => openRule({ coachThreadId, lessonId: target.lessonId, ruleKey })}>
              Show in the conversation
            </Button>
          ) : null}
          {canRedirect ? (
            <Button secondary disabled={redirect.pending} onClick={() => void redirect.run(target.courseId, target.lessonId, ruleKey)}>
              Work on this Rule next
            </Button>
          ) : null}
        </div>
        {redirect.error === null ? null : <ErrorNotice message={redirect.error} />}
      </>
    );
  };

  return <div className="tutor-sk tp-yah">{body()}</div>;
}
