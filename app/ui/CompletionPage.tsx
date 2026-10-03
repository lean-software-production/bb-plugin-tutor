// Between lessons: the lesson-complete panel the coach thread shows too
// (LessonComplete.tsx), then the next lesson's introduction and "Start lesson
// N", which spawns its coach thread (the first turn adopts the spec) and opens
// it, or "Continue lesson N" once it has started. With no next lesson (Lesson 0
// with nothing fetched yet), a course that can be added is offered instead.
import { useRef } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { refreshAll, useAction, useAddCourse, useCourseNavigate, useOverview, useQuery, useTutorRpc } from "../hooks.ts";
import { completionView, courseOffer } from "../model/completion.ts";
import type { CourseOffer, NextLessonView } from "../model/completion.ts";
import { QUERY_KEYS } from "../state/app-state.ts";
import { Chips, ErrorNotice, InlineText, Loading, SketchPage } from "./common.tsx";
import { LessonDone } from "./LessonComplete.tsx";
import { Button, Highlight } from "./sketch/index.ts";

export function CompletionPage({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const rpc = useTutorRpc();
  const goCourse = useCourseNavigate();
  const overview = useOverview();
  const nextRef = useRef<HTMLDivElement>(null);
  const completion = useQuery(QUERY_KEYS.completion(courseId, lessonId), () => rpc.call("getCompletion", { courseId, lessonId }));
  if (completion.data === null) {
    return (
      <SketchPage>
        {completion.status === "error" ? (
          <>
            <ErrorNotice message={completion.error} />
            <Button secondary onClick={() => goCourse({ kind: "start", courseId, lessonId })}>
              Back to the lesson
            </Button>
          </>
        ) : (
          <Loading label="Loading…" />
        )}
      </SketchPage>
    );
  }
  const view = completionView(completion.data, Date.now());
  const offer = courseOffer(overview.data?.available ?? []);
  // "What's next" here is the section under the panel: go to it and hand it the focus.
  const toNext = () => {
    const section = nextRef.current;
    section?.scrollIntoView({ block: "start" });
    section?.focus({ preventScroll: true });
  };
  return (
    <SketchPage>
      <div className="tp-done-panel">
        <LessonDone lessonId={lessonId} completion={completion.data} view={view} onNext={toNext} />
      </div>
      <div ref={nextRef} tabIndex={-1} className="tp-next-lesson">
        {view.next !== null ? (
          <NextLesson next={view.next} />
        ) : offer !== null ? (
          <AddCourse offer={offer} />
        ) : (
          <>
            <p className="tp-eyebrow">That was the last lesson</p>
            <h1 className="sk-title tp-page-title">
              <Highlight>You finished the course.</Highlight>
            </h1>
            <p className="tp-dek">Your work and every conversation with your coach stay in your workspace.</p>
          </>
        )}
      </div>
    </SketchPage>
  );
}

function NextLesson({ next }: { next: NextLessonView }) {
  const rpc = useTutorRpc();
  const navigate = useBbNavigate();
  const goCourse = useCourseNavigate();
  const start = useAction(async () => {
    const { threadId } = next.started
      ? await rpc.call("openCoach", { courseId: next.courseId, lessonId: next.id })
      : await rpc.call("startNextLesson", { courseId: next.courseId, lessonId: next.id });
    refreshAll();
    navigate.toThread(threadId);
  });
  return (
    <>
      <p className="tp-eyebrow">{next.eyebrow}</p>
      <h1 className="sk-title tp-page-title">
        <Highlight>{next.title}</Highlight>
      </h1>
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
        <Button disabled={start.pending} onClick={() => void start.run()}>
          {start.pending ? "Starting…" : next.startLabel}
        </Button>
        <Button secondary onClick={() => goCourse({ kind: "start", courseId: next.courseId, lessonId: next.id })}>
          Read the features first
        </Button>
      </div>
      {start.error === null ? null : <ErrorNotice message={start.error} />}
    </>
  );
}

/** No next lesson, and a course to add: the same action as the outline's "Add the course". */
function AddCourse({ offer }: { offer: CourseOffer }) {
  const add = useAddCourse(offer.courseId);
  return (
    <>
      <p className="tp-eyebrow">Your next course</p>
      <h1 className="sk-title tp-page-title">
        <Highlight>{offer.title}</Highlight>
      </h1>
      {offer.description === "" ? null : <p className="tp-dek">{offer.description}</p>}
      <div className="tp-continue">
        <Button disabled={add.pending} onClick={() => void add.run()}>
          {add.pending ? "Adding the course…" : offer.action}
        </Button>
      </div>
      {add.error === null ? null : <ErrorNotice message={add.error} />}
    </>
  );
}
