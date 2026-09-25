// Coach moments inside BB's chat (mockup 3A): `::tutor-progress{…}` cards and
// `::term{id=…}` lexicon chips. BB renders directives in every thread and the
// attributes are whatever the model wrote, so nothing reaches the screen that
// shared/directives.ts did not validate; otherwise the source text shows.
import { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { SLOT_IDS } from "../../shared/constants.ts";
import { parseProgressCard, parseTermRef } from "../../shared/directives.ts";
import { usePortalScopeProps } from "../../lib/portal-scope.ts";
import { useCourseNavigate, useQuery, useTutorRpc } from "../hooks.ts";
import { progressCardView, termView } from "../model/cards.ts";
import type { ProgressCardView } from "../model/cards.ts";
import { QUERY_KEYS } from "../state/app-state.ts";
import { InlineText } from "./common.tsx";

function SourceFallback({ source }: { source: string }) {
  return <p>{source}</p>;
}

export function ProgressCardDirective({ attributes, source }: PluginMessageDirectiveProps) {
  const card = parseProgressCard(attributes);
  if (card === null) return <SourceFallback source={source} />;
  return <ProgressCard view={progressCardView(card)} />;
}

function ProgressCard({ view }: { view: ProgressCardView }) {
  const navigate = useBbNavigate();
  const goCourse = useCourseNavigate();
  const rule = view.rule;
  const openRule = () => {
    if (rule === null) return;
    const opened = navigate.openThreadPanel({ actionId: SLOT_IDS.ruleTab, title: "Rule", params: rule });
    if (!opened) goCourse({ kind: "lesson", homeworkId: rule.homeworkId }, { ruleKey: rule.ruleKey });
  };
  const completed = view.completedHomeworkId;
  return (
    <div className={`tutor-paper tp-pcard tp-pcard--${view.kind}`} role="group" aria-label={`${view.eyebrow}: ${view.title}`}>
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
      {rule === null && completed === null ? null : (
        <div className="tp-pcard-ft">
          {rule === null ? null : (
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
