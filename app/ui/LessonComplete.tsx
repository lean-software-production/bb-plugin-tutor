// The lesson-complete card (mockup "lesson-complete"): a ribbon, "What's
// next" in the title hand, the lesson's stats, the loop from the stats back
// round to "What's next", and the coach's summary beside the group. The coach
// thread shows it for a `lesson-complete` progress card; the completion page
// reuses the same panel. The stats come from getCompletion; until they load
// (or if they fail) the card is the ribbon and the link, with no loop (D5).
import { useRef } from "react";
import { useCourseNavigate, useQuery, useTutorRpc } from "../hooks.ts";
import { completionView, doneRibbon, whatsNext } from "../model/completion.ts";
import type { CompletionView } from "../model/completion.ts";
import type { Completion } from "../../shared/rpc.ts";
import { QUERY_KEYS } from "../state/app-state.ts";
import { InlineText } from "./common.tsx";
import { Character, LoopArrow, Panel, Ribbon } from "./sketch/index.ts";

type LessonDoneProps = {
  lessonId: string;
  /** Null while the stats load, or when they could not be read. */
  completion: Completion | null;
  view: CompletionView | null;
  onNext: () => void;
};

/** The lesson-complete panel. Rendered inside a .tutor-sk root. */
export function LessonDone({ lessonId, completion, view, onNext }: LessonDoneProps) {
  const statsRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const ribbon = doneRibbon(lessonId, completion?.counts ?? null);
  const next = whatsNext(view);
  return (
    <Panel as="article" tone="forest" className="tp-done" aria-label={`${ribbon.kicker}${ribbon.line === null ? "" : ` ${ribbon.line}`}`}>
      <Ribbon icon="checklist" kicker={ribbon.kicker}>
        {ribbon.line === null ? null : <span className="tp-ribbon-line">{ribbon.line}</span>}
      </Ribbon>
      <div className="tp-done-row">
        <button ref={nextRef} type="button" className="tp-next" onClick={onNext}>
          {next.label}
          {next.detail === null ? null : <small>{next.detail}</small>}
        </button>
        {view === null ? null : (
          <div ref={statsRef} className="tp-stats">
            {view.stats.map((stat) => (
              <div key={stat.label}>
                <b>{stat.value}</b>
                {stat.label}
              </div>
            ))}
          </div>
        )}
      </div>
      {view === null ? null : <LoopArrow from={statsRef} to={nextRef} />}
      {view === null ? null : (
        <div className="tp-done-body">
          <p className="tp-done-sum">
            {view.summary === null ? null : (
              <>
                <InlineText text={view.summary} /> <span className="tp-muted">(your coach's summary)</span>
              </>
            )}
          </p>
          <Character name="group" className="tp-done-group" />
        </div>
      )}
    </Panel>
  );
}

/** In the coach thread: fetches its own stats, and "What's next" opens the completion page. */
export function LessonComplete({ lessonId, anchorProps = {} }: { lessonId: string; anchorProps?: Record<string, string> }) {
  const rpc = useTutorRpc();
  const goCourse = useCourseNavigate();
  const completion = useQuery(QUERY_KEYS.completion(lessonId), () => rpc.call("getCompletion", { lessonId }));
  const view = completion.data === null ? null : completionView(completion.data, Date.now());
  return (
    <div className="tutor-sk tp-cardwrap" {...anchorProps}>
      <LessonDone lessonId={lessonId} completion={completion.data} view={view} onNext={() => goCourse({ kind: "complete", lessonId })} />
    </div>
  );
}
