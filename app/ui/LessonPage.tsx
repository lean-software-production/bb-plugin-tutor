// Lesson page (mockup 2A): one page-owned scroller on grid paper holding BB's
// ThreadChat in document layout, with the paper lesson as its leading content.
// `document` paints no background, so the grid shows through (spike finding).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ThreadChat, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { formatRoute } from "../../shared/routes.ts";
import { refreshAll, useAction, useCourseNavigate, useOverview, useQuery, useStore, useTutorRpc } from "../hooks.ts";
import { homeworkLabel } from "../model/format.ts";
import { buildLesson, coachStart, foldsHiding } from "../model/lesson.ts";
import type { CoachStart, LessonView, RuleView } from "../model/lesson.ts";
import { QUERY_KEYS, ruleRequestStore, takeRuleRequest } from "../state/app-state.ts";
import { Bar, Loading, Notice, coursePageHref, isPlainClick } from "./common.tsx";
import { Lesson } from "./Lesson.tsx";

/** Distance from the bottom beyond which "jump to latest" appears. */
const LATEST_THRESHOLD_PX = 600;
/** ThreadChat mounts its leading content only once the timeline loads; wait this long for a Rule. */
const SCROLL_WAIT_FRAMES = 120;

function toggled(set: ReadonlySet<string>, key: string, open?: boolean): Set<string> {
  const next = new Set(set);
  if (open ?? !next.has(key)) next.add(key);
  else next.delete(key);
  return next;
}

/** `ruleKey` is the Rule named in the URL, opened on arrival. */
export function LessonPage({ homeworkId, ruleKey }: { homeworkId: string; ruleKey: string | null }) {
  const rpc = useTutorRpc();
  const overview = useOverview();
  const lesson = useQuery(QUERY_KEYS.lesson(homeworkId), () => rpc.call("getLesson", { homeworkId }));
  if (lesson.data === null) {
    return (
      <div className="tutor-grid tp-lt">
        <div className="tutor-paper tp-lt-message">
          {lesson.status === "error" ? <Notice tone="error">{lesson.error}</Notice> : <Loading label="Loading the lesson…" />}
        </div>
      </div>
    );
  }
  const view = buildLesson(lesson.data, overview.data?.homeworks ?? [], Date.now());
  const start = coachStart(view.status, overview.data?.binding.status ?? null);
  return (
    <LessonLayout
      key={homeworkId}
      view={view}
      start={start}
      urlRuleKey={ruleKey}
      staleError={lesson.status === "error" ? lesson.error : null}
    />
  );
}

function LessonLayout({
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
  const homeworkId = view.homeworkId;
  const [startedThreadId, setStartedThreadId] = useState<string | null>(null);
  const threadId = view.coachThreadId ?? startedThreadId;
  const [openRules, setOpenRules] = useState<ReadonlySet<string>>(new Set());
  const [openFeatures, setOpenFeatures] = useState<ReadonlySet<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const [farFromLatest, setFarFromLatest] = useState(false);

  // The latest scroll wins: a Rule asked for on arrival overrides the focus.
  const scrollSeq = useRef(0);
  const scrollToRule = useCallback((ruleKey: string) => {
    const seq = ++scrollSeq.current;
    let frames = 0;
    const attempt = () => {
      if (seq !== scrollSeq.current) return;
      const target = scroller.current?.querySelector(`[data-rule-key="${CSS.escape(ruleKey)}"]`);
      if (target !== null && target !== undefined) target.scrollIntoView({ block: "start", behavior: "smooth" });
      else if (++frames < SCROLL_WAIT_FRAMES) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }, []);

  // Open on the Rule the lesson ends at, so the student lands on the work.
  const focusKey = view.focus?.ruleKey ?? null;
  useEffect(() => {
    if (focusKey !== null) scrollToRule(focusKey);
  }, [focusKey, scrollToRule]);

  // A Rule named in the URL or clicked in the rail: open it and whatever folds hide it, then scroll there.
  const latestView = useRef(view);
  latestView.current = view;
  const revealRule = useCallback(
    (ruleKey: string) => {
      for (const fold of foldsHiding(latestView.current, ruleKey)) setOpenFeatures((set) => toggled(set, fold, true));
      setOpenRules((set) => toggled(set, ruleKey, true));
      scrollToRule(ruleKey);
    },
    [scrollToRule],
  );
  useEffect(() => {
    if (urlRuleKey !== null) revealRule(urlRuleKey);
  }, [urlRuleKey, revealRule]);
  // The rail also asks through the store, so clicking the Rule already in the URL scrolls back to it.
  const request = useStore(ruleRequestStore);
  useEffect(() => {
    const taken = takeRuleRequest(homeworkId);
    if (taken !== null) revealRule(taken.ruleKey);
  }, [request, homeworkId, revealRule]);

  const onScroll = () => {
    const element = scroller.current;
    if (element === null) return;
    setFarFromLatest(element.scrollHeight - element.scrollTop - element.clientHeight > LATEST_THRESHOLD_PX);
  };

  const redirect = useAction(async (ruleKey: string) => {
    await rpc.call("redirectFocus", { homeworkId, ruleKey });
    toast.success("Asked your coach to move to this Rule.");
  });
  const sideThread = useAction(async (ruleKey: string) => {
    const { threadId: created } = await rpc.call("startSideThread", { homeworkId, ruleKey });
    refreshAll();
    navigate.toThread(created);
  });
  const openCoach = useAction(async () => {
    const { threadId: opened } = await rpc.call("openCoach", { homeworkId });
    setStartedThreadId(opened);
    refreshAll();
  });

  const canCoach = threadId !== null && view.status === "current";
  const ruleActions = (rule: RuleView): ReactNode => {
    if (!canCoach) return null;
    const busy = redirect.pending || sideThread.pending;
    return (
      <div className="tp-rule-actions">
        {rule.isFocus || rule.status === "passing" ? null : (
          <button type="button" className="tp-btn" disabled={busy} onClick={() => void redirect.run(rule.key)}>
            Work on this Rule next
          </button>
        )}
        <button type="button" className="tp-btn tp-btn--ghost" disabled={busy} onClick={() => void sideThread.run(rule.key)}>
          Ask a side question ↗
        </button>
        {[redirect.error, sideThread.error].map((error) =>
          error === null ? null : (
            <span key={error} className="tp-inline-error" role="alert">
              {error}
            </span>
          ),
        )}
      </div>
    );
  };

  const completeHref = coursePageHref(formatRoute({ kind: "complete", homeworkId }));
  const lead = (
    <div className="tutor-paper tp-lead tp-margin">
      <Lesson
        view={view}
        openRules={openRules}
        openFeatures={openFeatures}
        onToggleRule={(key) => setOpenRules((set) => toggled(set, key))}
        onToggleFeature={(slug) => setOpenFeatures((set) => toggled(set, slug))}
        ruleActions={ruleActions}
        banner={
          <>
            {staleError === null ? null : <Notice tone="error">{staleError}</Notice>}
            {view.readyToComplete ? (
              <a
                className="tp-banner"
                href={completeHref}
                onClick={(event) => {
                  if (!isPlainClick(event)) return;
                  event.preventDefault();
                  goCourse({ kind: "complete", homeworkId });
                }}
              >
                ✓ You finished {homeworkLabel(homeworkId).toLowerCase()}. See what's next →
              </a>
            ) : null}
          </>
        }
      />
      {threadId === null ? null : <div className="tp-convo-div">Your coach · {homeworkLabel(homeworkId)}</div>}
    </div>
  );

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
        {threadId === null ? null : (
          <button type="button" className="tp-link-button" onClick={() => navigate.toThread(threadId)}>
            Open as thread ↗
          </button>
        )}
      </header>
      <div className="tp-lt-body" ref={scroller} onScroll={onScroll}>
        <div className="tp-lt-inner">
          {threadId === null ? (
            <>
              {lead}
              <div className="tutor-paper tp-lead">
                <StartCoach
                  start={start}
                  pending={openCoach.pending}
                  error={openCoach.error}
                  onStart={() => void openCoach.run()}
                  onSetUp={() => goCourse({ kind: "welcome" })}
                />
              </div>
            </>
          ) : (
            <ThreadChat threadId={threadId} variant="full" layout="document" leadingContent={lead} />
          )}
        </div>
        {threadId !== null && farFromLatest ? (
          <button
            type="button"
            className="tutor-paper tp-chipdown"
            aria-label="Jump to the latest message"
            onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}
          >
            ↓
          </button>
        ) : null}
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
            This homework comes after the one you're on. Read ahead as much as you like; your coach picks it up when you
            get here.
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
              ? "Your coach works through this homework with you, one Rule at a time, in your factory repo."
              : "You finished this homework. Open its coach thread to look back at how it went."}
          </p>
          <button type="button" className="tp-btn tp-btn--big" disabled={pending} onClick={onStart}>
            {pending ? "Starting…" : start === "start" ? "Start with your coach →" : "Open the coach thread →"}
          </button>
          {error === null ? null : <Notice tone="error">{error}</Notice>}
        </div>
      );
  }
}
