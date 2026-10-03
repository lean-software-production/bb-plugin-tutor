// Coach moments inside BB's chat (mockup 3A) and the lesson they carry: the
// `::tutor-lesson{…}` lesson card, `::tutor-progress{…}` cards (a `focus` card
// is the Rule card where a Rule's section starts) and `::term{id=…}` lexicon
// chips. BB renders directives in every thread and the attributes are
// whatever the model wrote, so nothing reaches the screen that
// shared/directives.ts did not validate; otherwise the source text shows.
import { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { SLOT_IDS } from "../../shared/constants.ts";
import { RULE_ANCHOR_ATTRIBUTE, parseLessonRef, parseProgressCard, parseTermRef, ruleAnchor } from "../../shared/directives.ts";
import { usePortalScopeProps } from "../../lib/portal-scope.ts";
import { useAskSideQuestion, useCourseNavigate, useLessonCourse, useOpenRule, useOverview, useQuery, useTutorRpc } from "../hooks.ts";
import { progressCardView, termView } from "../model/cards.ts";
import type { ProgressCardView } from "../model/cards.ts";
import { lessonCardView, ruleCardView } from "../model/lesson-cards.ts";
import type { LessonCardView, RuleCardView } from "../model/lesson-cards.ts";
import { QUERY_KEYS } from "../state/app-state.ts";
import { stepTone } from "../sketch/step-colour.ts";
import { cx, toneClass } from "../sketch/tone.ts";
import { InlineText, ChangeBadge, ReloadButton } from "./common.tsx";
import { AnnotatedExample } from "./Lesson.tsx";
import { LessonComplete } from "./LessonComplete.tsx";
import { Bubble, Highlight, KitIcon, Meter, Panel, StepBadge, Tick } from "./sketch/index.ts";

/** Passing Rules get the kit's tick instead. */
const RULE_GLYPHS = { "not-yet": "!", pending: "○", focus: "●" } as const;
const NOT_REACHED_HINT = "Your coach hasn't reached this Rule yet";

function SourceFallback({ source }: { source: string }) {
  return <p>{source}</p>;
}

function useLessonDetail(courseId: string | null, lessonId: string | null) {
  const rpc = useTutorRpc();
  // The fetcher only runs for a non-null key, so courseId and lessonId are set whenever it is called.
  return useQuery(courseId === null || lessonId === null ? null : QUERY_KEYS.lessonDetail(courseId, lessonId), () =>
    rpc.call("getLessonDetail", { courseId: courseId ?? "", lessonId: lessonId ?? "" }),
  );
}

/**
 * `::tutor-lesson{lesson="003"}`: the lesson that opens a coach thread. The
 * directive names no course: the thread's says which (useLessonCourse).
 */
export function LessonCardDirective({ attributes, source, message }: PluginMessageDirectiveProps) {
  const ref = parseLessonRef(attributes);
  const courseId = useLessonCourse(message.threadId, ref?.lessonId ?? null);
  const detail = useLessonDetail(courseId, ref?.lessonId ?? null);
  if (ref === null) return <SourceFallback source={source} />;
  if (detail.data === null) {
    return detail.status === "error" ? (
      <SourceFallback source={source} />
    ) : (
      <div className="tutor-sk tp-cardwrap tp-lcard--loading" role="status">
        Loading the lesson…
      </div>
    );
  }
  return <LessonCard view={lessonCardView(detail.data)} />;
}

function LessonCard({ view }: { view: LessonCardView }) {
  const openRule = useOpenRule();
  const coachThreadId = view.coachThreadId;
  return (
    <div className="tutor-sk tp-cardwrap">
      <Panel as="article" tone="mustard" className="tp-lcard" aria-label={`${view.eyebrow}: ${view.title}`} data-tutor-lesson={view.lessonId}>
        <p className="tp-eyebrow">{view.eyebrow}</p>
        <h2 className="sk-title tp-lcard-title">
          <Highlight>{view.title}</Highlight>
        </h2>
        {view.dek === "" ? null : (
          <p className="tp-lcard-dek">
            <InlineText text={view.dek} />
          </p>
        )}
        <Meter className="tp-tally" value={view.passing} max={view.total} label="Examples that hold" unit={view.tallyUnit} />
        <div className="tp-checklist">
          <KitIcon name="checklist" className="tp-checklist-icon" />
          <div className="tp-checklist-body">
            {view.features.map((feature) => (
              <section key={feature.slug} className="tp-lcard-feature" aria-label={`Feature ${feature.name}`}>
                <p className="tp-checklist-hd">
                  {feature.name}
                  <ChangeBadge change={feature.change} mixedLabel="changed" />
                  <span className="tp-lcard-count">{feature.count}</span>
                </p>
                <ul>
                  {feature.rules.map((rule) => {
                    const body = (
                      <>
                        <span className={`tp-g tp-g--${rule.glyph}`} aria-hidden>
                          {rule.glyph === "passing" ? <Tick /> : RULE_GLYPHS[rule.glyph]}
                        </span>
                        <span>
                          {rule.glyph === "focus" ? <Highlight>{rule.name}</Highlight> : rule.name}
                          <ChangeBadge change={rule.change} />
                        </span>
                      </>
                    );
                    return (
                      <li key={rule.key}>
                        {rule.reached && coachThreadId !== null ? (
                          <button
                            type="button"
                            className="tp-lcard-rule"
                            title="Show where your coach started this Rule"
                            onClick={() => openRule({ coachThreadId, lessonId: view.lessonId, ruleKey: rule.key })}
                          >
                            {body}
                          </button>
                        ) : (
                          <span className="tp-lcard-rule tp-lcard-rule--unreached" title={NOT_REACHED_HINT}>
                            {body}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function ProgressCardDirective({ attributes, source, message }: PluginMessageDirectiveProps) {
  const card = parseProgressCard(attributes);
  const courseId = useLessonCourse(message.threadId, card?.lessonId ?? null);
  if (card === null) return <SourceFallback source={source} />;
  const view = progressCardView(card);
  if (card.kind === "focus" && view.rule !== null) {
    return <RuleCardDirective card={view} rule={view.rule} courseId={courseId} threadId={message.threadId} />;
  }
  if (view.completedLessonId !== null && courseId !== null) return <LessonComplete courseId={courseId} lessonId={view.completedLessonId} />;
  return <ProgressCard view={view} courseId={courseId} />;
}

/**
 * A `focus` card is the Rule card: the start of the Rule's section, which the
 * course outline scrolls to by its anchor. Until the lesson loads (or if the
 * Rule has gone from the course) it draws as a plain focus card, anchored
 * all the same.
 */
function RuleCardDirective({
  card,
  rule,
  courseId,
  threadId,
}: {
  card: ProgressCardView;
  rule: { lessonId: string; ruleKey: string };
  courseId: string | null;
  threadId: string;
}) {
  const detail = useLessonDetail(courseId, rule.lessonId);
  const anchor = ruleAnchor(threadId, rule.lessonId, rule.ruleKey);
  const anchorProps: Record<string, string> = anchor === null ? {} : { [RULE_ANCHOR_ATTRIBUTE]: anchor };
  const view = detail.data === null || courseId === null ? null : ruleCardView(detail.data, rule.ruleKey, Date.now());
  if (view === null || courseId === null) return <ProgressCard view={card} courseId={courseId} anchorProps={anchorProps} />;
  return <RuleCard view={view} courseId={courseId} anchorProps={anchorProps} />;
}

function RuleCard({ view, courseId, anchorProps }: { view: RuleCardView; courseId: string; anchorProps: Record<string, string> }) {
  const [open, setOpen] = useState(true);
  const askSide = useAskSideQuestion();
  const { rule } = view;
  const position = view.number - 1;
  return (
    <div className="tutor-sk tp-cardwrap" {...anchorProps}>
      <Panel as="article" tone={stepTone(position)} className="tp-rcard" aria-label={`Rule: ${rule.name}`}>
        <p className="tp-eyebrow">
          Now working on · {view.featureName}
          <ChangeBadge change={rule.change} />
        </p>
        <div className="tp-rulehead">
          <h3 className="sk-step tp-rcard-step">
            <StepBadge position={position} label={view.number} />
            <span className="sk-label tp-tt">{rule.name}</span>
          </h3>
          <div className="tp-ring">
            <b>
              {view.passing}/{view.total}
            </b>
            examples
          </div>
        </div>
        {rule.description === "" ? null : (
          <p className="tp-rcard-desc">
            <InlineText text={rule.description} />
          </p>
        )}
        <button type="button" className="tp-rcard-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "▾" : "▸"} {rule.examples.length === 1 ? "Example" : `Examples (${rule.examples.length})`}
        </button>
        {open ? (
          <div className="tp-gutterwrap tp-rcard-examples">
            {rule.examples.map((example) => (
              <AnnotatedExample key={example.key} example={example} />
            ))}
          </div>
        ) : null}
        {view.current && view.coachThreadId !== null ? (
          <div className="tp-pcard-ft">
            <button type="button" className="tp-link" disabled={askSide.pending} onClick={() => void askSide.run(courseId, view.lessonId, rule.key)}>
              {askSide.pending ? "Opening a side chat…" : "Ask a side question ↗"}
            </button>
            {askSide.error === null ? null : (
              <span className="tp-inline-error" role="alert">
                {askSide.error}
                <ReloadButton message={askSide.error} />
              </span>
            )}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function ProgressCard({
  view,
  courseId,
  anchorProps = {},
}: {
  view: ProgressCardView;
  /** The card's lesson's course, once known. */
  courseId: string | null;
  anchorProps?: Record<string, string>;
}) {
  const navigate = useBbNavigate();
  const goCourse = useCourseNavigate();
  const openRuleSection = useOpenRule();
  const overview = useOverview();
  const rule = view.rule;
  const lessons = overview.data?.courses.find((entry) => entry.course.id === courseId)?.lessons ?? [];
  const lesson = rule === null ? undefined : lessons.find((candidate) => candidate.id === rule.lessonId);
  const reached =
    rule !== null && lesson?.outline.some((feature) => feature.rules.some((candidate) => candidate.key === rule.ruleKey && candidate.reached));
  const coachThreadId = lesson?.coachThreadId ?? null;
  const openRule = () => {
    if (rule === null) return;
    // To the Rule's section when it has one; otherwise the Rule tab beside the thread.
    if (reached === true && coachThreadId !== null) {
      openRuleSection({ coachThreadId, lessonId: rule.lessonId, ruleKey: rule.ruleKey });
      return;
    }
    const opened = navigate.openThreadPanel({ actionId: SLOT_IDS.ruleTab, title: "Rule", params: { ...rule, courseId } });
    if (!opened) goCourse({ kind: "start", courseId, lessonId: rule.lessonId }, { ruleKey: rule.ruleKey });
  };
  const ruleLink =
    rule === null || view.kind === "focus" ? null : (
      <button type="button" className="tp-link" onClick={openRule}>
        Open the Rule ›
      </button>
    );
  return (
    <div className="tutor-sk tp-cardwrap" {...anchorProps}>
      <Panel tone={view.kitTone} className={`tp-pcard tp-pcard--${view.kind}`} role="group" aria-label={`${view.eyebrow}: ${view.title}`}>
        <div className="tp-pcard-top">
          <span className={cx("sk-num", toneClass(view.kitTone), "tp-mk")} aria-hidden>
            {view.mark}
          </span>
          <div className="tp-pcard-head">
            <p className="tp-eyebrow">{view.eyebrow}</p>
            <div className="tp-tt">{view.kind === "rule-passing" ? <Highlight sweep>{view.title}</Highlight> : view.title}</div>
          </div>
          {view.ring === null ? null : (
            <div className="tp-ring">
              <b>{view.ring}</b>examples
            </div>
          )}
        </div>
        {view.next === null ? null : (
          <div className="tp-pcard-next">
            <span className="tp-lab">Now</span>
            <span>{view.next}</span>
          </div>
        )}
        {view.note === null ? (
          ruleLink === null ? null : <div className="tp-pcard-ft">{ruleLink}</div>
        ) : (
          <div className="tp-speaker">
            <KitIcon name="robot" className="tp-speaker-icon" />
            <Bubble className="tp-pcard-note">{view.note}</Bubble>
            {ruleLink}
          </div>
        )}
      </Panel>
    </div>
  );
}

export function TermDirective({ attributes, source }: PluginMessageDirectiveProps) {
  const rpc = useTutorRpc();
  const lexicon = useQuery(QUERY_KEYS.lexicon, () => rpc.call("getLexicon", null));
  const [open, setOpen] = useState(false);
  // A click on a chip the mouse already opened by hovering must not toggle it shut.
  const hovering = useRef(false);
  const portalScope = usePortalScopeProps();
  const ref = parseTermRef(attributes);
  if (ref === null) return <SourceFallback source={source} />;
  if (lexicon.data === null) {
    return lexicon.status === "error" ? (
      <SourceFallback source={source} />
    ) : (
      <div className="tutor-sk tp-term-line">
        <span className="tp-term tp-term--loading">{ref.label ?? ref.id}</span>
      </div>
    );
  }
  const term = termView(ref, lexicon.data.entries);
  if (term === null) return <SourceFallback source={source} />;
  return (
    <div className="tutor-sk tp-term-line">
      <Popover.Root open={open} onOpenChange={(next) => setOpen(next || hovering.current)}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="tp-term"
            onPointerEnter={(event) => {
              if (event.pointerType !== "mouse") return;
              hovering.current = true;
              setOpen(true);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== "mouse") return;
              hovering.current = false;
              setOpen(false);
            }}
          >
            {term.label}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            {...portalScope}
            className="tutor-sk tp-termpop"
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            // A definition to read, not a dialog: focus stays on the chip.
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <b>Lexicon · {term.entry.term}</b>
            <InlineText text={term.entry.definition} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
