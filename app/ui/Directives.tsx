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
import { useAskSideQuestion, useCourseNavigate, useOpenRule, useOverview, useQuery, useTutorRpc } from "../hooks.ts";
import { progressCardView, termView } from "../model/cards.ts";
import type { ProgressCardView } from "../model/cards.ts";
import { lessonCardView, ruleCardView } from "../model/lesson-cards.ts";
import type { LessonCardView, RuleCardView } from "../model/lesson-cards.ts";
import { QUERY_KEYS } from "../state/app-state.ts";
import { InlineText, NewDot, ReloadButton } from "./common.tsx";
import { AnnotatedExample } from "./Lesson.tsx";

const RULE_GLYPHS = { passing: "✓", "not-yet": "!", pending: "○", focus: "●" } as const;
const NOT_REACHED_HINT = "Your coach hasn't reached this Rule yet";

function SourceFallback({ source }: { source: string }) {
  return <p>{source}</p>;
}

function useLesson(homeworkId: string | null) {
  const rpc = useTutorRpc();
  // The fetcher only runs for a non-null key, so homeworkId is set whenever it is called.
  return useQuery(homeworkId === null ? null : QUERY_KEYS.lesson(homeworkId), () =>
    rpc.call("getLesson", { homeworkId: homeworkId ?? "" }),
  );
}

/** `::tutor-lesson{homework="003"}`: the lesson that opens a coach thread. */
export function LessonCardDirective({ attributes, source }: PluginMessageDirectiveProps) {
  const ref = parseLessonRef(attributes);
  const lesson = useLesson(ref?.homeworkId ?? null);
  if (ref === null) return <SourceFallback source={source} />;
  if (lesson.data === null) {
    return lesson.status === "error" ? (
      <SourceFallback source={source} />
    ) : (
      <div className="tutor-paper tp-lcard tp-lcard--loading" role="status">
        Loading the lesson…
      </div>
    );
  }
  return <LessonCard view={lessonCardView(lesson.data)} />;
}

function LessonCard({ view }: { view: LessonCardView }) {
  const openRule = useOpenRule();
  const coachThreadId = view.coachThreadId;
  return (
    <article className="tutor-paper tp-lcard" aria-label={`${view.eyebrow}: ${view.title}`} data-tutor-lesson={view.homeworkId}>
      <div className="tp-lcard-top">
        <p className="tp-eyebrow">{view.eyebrow}</p>
        <h2 className="tp-h2">{view.title}</h2>
        {view.dek === "" ? null : (
          <p className="tp-prose tp-lcard-dek">
            <InlineText text={view.dek} />
          </p>
        )}
        <div className="tp-lcard-tally">
          <div className="tp-bar" role="progressbar" aria-label={view.tally} aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}>
            <i style={{ width: `${view.percent}%` }} />
          </div>
          <span>{view.tally}</span>
        </div>
      </div>
      <div className="tp-lcard-rules">
        {view.features.map((feature) => (
          <section key={feature.slug} aria-label={`Feature ${feature.name}`}>
            <p className="tp-section-label">
              {feature.name}
              <NewDot novelty={feature.novelty} mixedLabel="changed" />
              <span className="tp-lcard-count">{feature.count}</span>
            </p>
            <ul>
              {feature.rules.map((rule) => {
                const body = (
                  <>
                    <span className={`tp-g tp-g--${rule.glyph}`} aria-hidden>
                      {RULE_GLYPHS[rule.glyph]}
                    </span>
                    <span>
                      {rule.name}
                      <NewDot novelty={rule.novelty} />
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
                        onClick={() => openRule({ coachThreadId, homeworkId: view.homeworkId, ruleKey: rule.key })}
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
    </article>
  );
}

export function ProgressCardDirective({ attributes, source, message }: PluginMessageDirectiveProps) {
  const card = parseProgressCard(attributes);
  if (card === null) return <SourceFallback source={source} />;
  const view = progressCardView(card);
  if (card.kind === "focus" && view.rule !== null) {
    return <RuleCardDirective card={view} rule={view.rule} threadId={message.threadId} />;
  }
  return <ProgressCard view={view} />;
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
  threadId,
}: {
  card: ProgressCardView;
  rule: { homeworkId: string; ruleKey: string };
  threadId: string;
}) {
  const lesson = useLesson(rule.homeworkId);
  const anchor = ruleAnchor(threadId, rule.homeworkId, rule.ruleKey);
  const anchorProps: Record<string, string> = anchor === null ? {} : { [RULE_ANCHOR_ATTRIBUTE]: anchor };
  const view = lesson.data === null ? null : ruleCardView(lesson.data, rule.ruleKey, Date.now());
  if (view === null) return <ProgressCard view={card} anchorProps={anchorProps} />;
  return <RuleCard view={view} anchorProps={anchorProps} />;
}

function RuleCard({ view, anchorProps }: { view: RuleCardView; anchorProps: Record<string, string> }) {
  const [open, setOpen] = useState(true);
  const askSide = useAskSideQuestion();
  const { rule } = view;
  return (
    <article className="tutor-paper tp-rcard" aria-label={`Rule: ${rule.name}`} {...anchorProps}>
      <div className="tp-rcard-top">
        <span className="tp-mk tp-mk--blue" aria-hidden>
          ●
        </span>
        <div className="tp-rcard-head">
          <div className="tp-ey">
            Now working on · {view.featureName}
            <NewDot novelty={rule.novelty} />
          </div>
          <h3 className="tp-tt">{rule.name}</h3>
        </div>
        <div className="tp-ring">
          <b>
            {view.passing}/{view.total}
          </b>
          examples
        </div>
      </div>
      {rule.description === "" ? null : (
        <p className="tp-prose tp-rcard-desc">
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
          <button type="button" className="tp-link-button" disabled={askSide.pending} onClick={() => void askSide.run(view.homeworkId, rule.key)}>
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
    </article>
  );
}

function ProgressCard({ view, anchorProps = {} }: { view: ProgressCardView; anchorProps?: Record<string, string> }) {
  const navigate = useBbNavigate();
  const goCourse = useCourseNavigate();
  const openRuleSection = useOpenRule();
  const overview = useOverview();
  const rule = view.rule;
  const lesson = rule === null ? undefined : overview.data?.homeworks.find((candidate) => candidate.id === rule.homeworkId);
  const reached =
    rule !== null && lesson?.outline.some((feature) => feature.rules.some((candidate) => candidate.key === rule.ruleKey && candidate.reached));
  const coachThreadId = lesson?.coachThreadId ?? null;
  const openRule = () => {
    if (rule === null) return;
    // To the Rule's section when it has one; otherwise the Rule tab beside the thread.
    if (reached === true && coachThreadId !== null) {
      openRuleSection({ coachThreadId, homeworkId: rule.homeworkId, ruleKey: rule.ruleKey });
      return;
    }
    const opened = navigate.openThreadPanel({ actionId: SLOT_IDS.ruleTab, title: "Rule", params: rule });
    if (!opened) goCourse({ kind: "lesson", homeworkId: rule.homeworkId }, { ruleKey: rule.ruleKey });
  };
  const completed = view.completedHomeworkId;
  return (
    <div className={`tutor-paper tp-pcard tp-pcard--${view.kind}`} role="group" aria-label={`${view.eyebrow}: ${view.title}`} {...anchorProps}>
      <div className="tp-pcard-top">
        <span className={`tp-mk tp-mk--${view.tone}`} aria-hidden>
          {view.mark}
        </span>
        <div>
          <div className="tp-ey">{view.eyebrow}</div>
          <div className="tp-tt">{view.title}</div>
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
          <b>{view.next}</b>
        </div>
      )}
      {view.note === null ? null : (
        <div className="tp-pcard-rows">
          <div>
            <span className={view.tone === "amber" ? "tp-a" : "tp-g"} aria-hidden>
              {view.tone === "amber" ? "!" : "✓"}
            </span>
            <span>{view.note}</span>
          </div>
        </div>
      )}
      {(rule === null || view.kind === "focus") && completed === null ? null : (
        <div className="tp-pcard-ft">
          {rule === null || view.kind === "focus" ? null : (
            <button type="button" className="tp-link-button" onClick={openRule}>
              Open the Rule ›
            </button>
          )}
          {completed === null ? null : (
            <button type="button" className="tp-link-button" onClick={() => goCourse({ kind: "complete", homeworkId: completed })}>
              What's next →
            </button>
          )}
        </div>
      )}
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
      <div className="tutor-paper tp-term-line">
        <span className="tp-term tp-term--loading">{ref.label ?? ref.id}</span>
      </div>
    );
  }
  const term = termView(ref, lexicon.data.entries);
  if (term === null) return <SourceFallback source={source} />;
  return (
    <div className="tutor-paper tp-term-line">
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
            className="tutor-paper tp-termpop"
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
