// Between lessons (mockup 7): the recap, the next lesson's introduction and
// "Start lesson N", which spawns its coach thread (the first turn adopts the
// spec) and opens it, or "Continue lesson N" once it has started.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { refreshAll, useAction, useCourseNavigate, useQuery, useTutorRpc } from "../hooks.ts";
import { completionView, confettiPieces } from "../model/completion.ts";
import type { NextHomeworkView } from "../model/completion.ts";
import { QUERY_KEYS } from "../state/app-state.ts";
import { Chips, ErrorNotice, InlineText, Loading, PaperPage } from "./common.tsx";

const CONFETTI = confettiPieces();

export function CompletionPage({ homeworkId }: { homeworkId: string }) {
  const rpc = useTutorRpc();
  const goCourse = useCourseNavigate();
  const completion = useQuery(QUERY_KEYS.completion(homeworkId), () => rpc.call("getCompletion", { homeworkId }));
  if (completion.data === null) {
    return (
      <PaperPage>
        {completion.status === "error" ? (
          <>
            <ErrorNotice message={completion.error} />
            <button type="button" className="tp-btn tp-btn--ghost" onClick={() => goCourse({ kind: "start", homeworkId })}>
              Back to the lesson
            </button>
          </>
        ) : (
          <Loading label="Loading…" />
        )}
      </PaperPage>
    );
  }
  const view = completionView(completion.data, Date.now());
  return (
    <PaperPage>
      <div className="tp-done-panel">
        <div className="tp-confetti" aria-hidden>
          {CONFETTI.map((piece, index) => (
            <i
              key={index}
              style={{ left: `${piece.left}%`, top: `${piece.top}%`, background: piece.color, transform: `rotate(${piece.rotate}deg)` }}
            />
          ))}
        </div>
        <div className="tp-big">
          <span className="tp-tick" aria-hidden>
            ✓
          </span>
          <div>
            <p className="tp-eyebrow tp-eyebrow--green">{view.eyebrow}</p>
            <h2 className="tp-h2">{view.title}</h2>
          </div>
        </div>
        <div className="tp-stats">
          {view.stats.map((stat) => (
            <div key={stat.label}>
              <b>{stat.value}</b>
              {stat.label}
            </div>
          ))}
        </div>
        {view.summary === null ? null : (
          <p className="tp-prose tp-sum">
            <InlineText text={view.summary} /> <span className="tp-muted">— coach's summary</span>
          </p>
        )}
      </div>
      {view.next === null ? (
        <div className="tp-next">
          <p className="tp-eyebrow">That was the last lesson</p>
          <h1 className="tp-h1">You finished the course.</h1>
          <p className="tp-dek">Your factory, its spec and every conversation with your coach stay in your repo.</p>
        </div>
      ) : (
        <NextHomework next={view.next} />
      )}
    </PaperPage>
  );
}

function NextHomework({ next }: { next: NextHomeworkView }) {
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  const goCourse = useCourseNavigate();
  const start = useAction(async () => {
    const { threadId } = next.started
      ? await rpc.call("openCoach", { homeworkId: next.id })
      : await rpc.call("startNextHomework", { homeworkId: next.id });
    refreshAll();
    navigate.toThread(threadId);
  });
  return (
    <div className="tp-next">
      <p className="tp-eyebrow">{next.eyebrow}</p>
      <h1 className="tp-h1">{next.title}</h1>
      {next.dek === "" ? null : (
        <p className="tp-dek">
          <InlineText text={next.dek} />
        </p>
      )}
      <Chips chips={next.chips} />
      {next.diff === null ? null : (
        <div className="tp-diff">
          <div className="tp-fh">{next.diff.title}</div>
          {next.diff.lines.map((line, index) => (
            <div key={index} className={`tp-l tp-l--${line.kind}`}>
              <span className="tp-sr-only">{line.kind === "add" ? "added: " : line.kind === "del" ? "removed: " : ""}</span>
              {line.text === "" ? " " : line.text}
            </div>
          ))}
        </div>
      )}
      <div className="tp-continue">
        <button type="button" className="tp-btn tp-btn--big" disabled={start.pending} onClick={() => void start.run()}>
          {start.pending ? "Starting…" : next.startLabel}
        </button>
        <button type="button" className="tp-btn tp-btn--ghost" onClick={() => goCourse({ kind: "start", homeworkId: next.id })}>
          Read the features first
        </button>
      </div>
      {start.error === null ? null : <ErrorNotice message={start.error} />}
    </div>
  );
}
