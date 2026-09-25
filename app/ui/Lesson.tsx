// The paper lesson that leads the coach thread (mockup 2A) with Examples as
// annotated Gherkin (mockup 6B). Pure presentation over LessonView; the page
// owns data, open/closed state and actions.
import { useState } from "react";
import type { ReactNode } from "react";
import { clipLines } from "../model/format.ts";
import type { ExampleView, FeatureView, LessonView, MarginNote, RuleView } from "../model/lesson.ts";
import { Chips, GherkinLines, GherkinRow, InlineText, NewDot } from "./common.tsx";

const GUTTER_GLYPHS = { passing: "✓", "not-yet": "!", pending: "○", skipped: "–" } as const;
const RULE_GLYPHS = { passing: "✓", "not-yet": "!", pending: "○" } as const;
const EVIDENCE_LINES = 4;

export interface LessonProps {
  view: LessonView;
  openRules: ReadonlySet<string>;
  openFeatures: ReadonlySet<string>;
  onToggleRule: (ruleKey: string) => void;
  onToggleFeature: (slug: string) => void;
  /** Extra controls under a Rule drawn open (redirect, side thread). */
  ruleActions: (rule: RuleView) => ReactNode;
  /** Shown above the lesson, e.g. "you finished this homework". */
  banner?: ReactNode;
}

export function Lesson({ view, openRules, openFeatures, onToggleRule, onToggleFeature, ruleActions, banner }: LessonProps) {
  const folded = view.focusFeature !== null;
  return (
    <article className="tp-lesson" aria-label={view.barTitle}>
      {banner}
      <p className="tp-eyebrow">{view.eyebrow}</p>
      <h1 className="tp-h1">{view.title}</h1>
      {view.dek === "" ? null : (
        <p className="tp-dek">
          <InlineText text={view.dek} />
        </p>
      )}
      <Chips chips={view.chips} />
      {view.compass === null ? null : (
        <div className="tp-compass">
          <p className="tp-section-label">{view.compass.title}</p>
          <ul>
            {view.compass.items.map((item) => (
              <li key={item.file}>
                <code>{item.file}</code> — <InlineText text={item.text} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {folded && view.otherFeatures.length > 0 ? (
        <div className="tp-folds">
          <p className="tp-section-label">Other features</p>
          {view.otherFeatures.map((feature) => (
            <FeatureFold
              key={feature.slug}
              feature={feature}
              open={openFeatures.has(feature.slug)}
              onToggle={() => onToggleFeature(feature.slug)}
            >
              <RuleList feature={feature} openRules={openRules} onToggleRule={onToggleRule} ruleActions={ruleActions} />
            </FeatureFold>
          ))}
        </div>
      ) : null}
      {folded && view.focusFeature !== null ? (
        <FeatureSection feature={view.focusFeature} focusLabel={view.focus?.label ?? null}>
          <RuleList
            feature={view.focusFeature}
            openRules={openRules}
            onToggleRule={onToggleRule}
            ruleActions={ruleActions}
            focusLabel={view.focus?.label ?? null}
          />
        </FeatureSection>
      ) : (
        view.otherFeatures.map((feature) => (
          <FeatureSection key={feature.slug} feature={feature} focusLabel={null}>
            <RuleList feature={feature} openRules={openRules} onToggleRule={onToggleRule} ruleActions={ruleActions} />
          </FeatureSection>
        ))
      )}
    </article>
  );
}

function FeatureSection({ feature, focusLabel, children }: { feature: FeatureView; focusLabel: string | null; children: ReactNode }) {
  return (
    <section className="tp-featurehead-wrap" aria-label={`Feature ${feature.name}`}>
      <div className="tp-featurehead">
        <p className="tp-section-label">
          Feature · {feature.file}
          <NewDot novelty={feature.novelty} mixedLabel="changed" />
        </p>
        <div className="tp-row">
          <h2 className="tp-h2">{feature.name}</h2>
          <span className="tp-cnt">{feature.count}</span>
        </div>
        {focusLabel === null || feature.description === "" ? null : (
          <p className="tp-prose tp-feature-desc">
            <InlineText text={feature.description} />
          </p>
        )}
        {feature.background.length === 0 ? null : (
          <details className="tp-background">
            <summary>Background</summary>
            <div className="tp-gherkin">
              <GherkinLines lines={feature.background} />
            </div>
          </details>
        )}
      </div>
      {children}
    </section>
  );
}

function FeatureFold({ feature, open, onToggle, children }: { feature: FeatureView; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="tp-fold">
      <button type="button" className="tp-fold-head" aria-expanded={open} onClick={onToggle}>
        <span className="tp-fold-name">
          {feature.name}
          <NewDot novelty={feature.novelty} mixedLabel="changed" />
        </span>
        <code className="tp-fold-file">{feature.file}</code>
        <span className="tp-x">
          {feature.count} {open ? "▾" : "›"}
        </span>
      </button>
      {open ? <div className="tp-fold-body">{children}</div> : null}
    </div>
  );
}

function RuleList({
  feature,
  openRules,
  onToggleRule,
  ruleActions,
  focusLabel = null,
}: {
  feature: FeatureView;
  openRules: ReadonlySet<string>;
  onToggleRule: (ruleKey: string) => void;
  ruleActions: (rule: RuleView) => ReactNode;
  focusLabel?: string | null;
}) {
  return (
    <>
      {feature.rules.map((rule) =>
        rule.isFocus || openRules.has(rule.key) ? (
          <RuleOpen
            key={rule.key}
            rule={rule}
            label={rule.isFocus && focusLabel !== null ? `Rule · ${focusLabel}` : rule.isUpNext ? "Rule · up next" : "Rule"}
            onCollapse={rule.isFocus ? null : () => onToggleRule(rule.key)}
            actions={ruleActions(rule)}
          />
        ) : (
          <button
            key={rule.key}
            type="button"
            className="tp-collapsed-rule"
            data-rule-key={rule.key}
            aria-expanded={false}
            onClick={() => onToggleRule(rule.key)}
          >
            <span className={`tp-g tp-g--${rule.status}`} aria-hidden>
              {RULE_GLYPHS[rule.status]}
            </span>
            <span className="tp-rule-name">
              {rule.name}
              <NewDot novelty={rule.novelty} />
            </span>
            <span className="tp-x">{rule.summary}</span>
          </button>
        ),
      )}
    </>
  );
}

function RuleOpen({
  rule,
  label,
  onCollapse,
  actions,
}: {
  rule: RuleView;
  label: string;
  onCollapse: (() => void) | null;
  actions: ReactNode;
}) {
  return (
    <section className={rule.isFocus ? "tp-rule tp-rule--focus" : "tp-rule"} data-rule-key={rule.key} aria-label={`Rule ${rule.name}`}>
      <p className="tp-section-label">
        {label}
        <NewDot novelty={rule.novelty} />
        {onCollapse === null ? null : (
          <button type="button" className="tp-link-button" onClick={onCollapse}>
            collapse
          </button>
        )}
      </p>
      <h2 className="tp-h2">{rule.name}</h2>
      {rule.description === "" ? null : (
        <p className="tp-prose">
          <InlineText text={rule.description} />
        </p>
      )}
      <div className="tp-gutterwrap">
        {rule.examples.map((example) => (
          <AnnotatedExample key={example.key} example={example} />
        ))}
      </div>
      {actions}
    </section>
  );
}

function AnnotatedExample({ example }: { example: ExampleView }) {
  const rows = example.lines.length;
  return (
    <div className={`tp-anno tp-anno--${example.status}`} aria-label={`Example ${example.name}: ${example.status}`}>
      <div className="tp-anno-margin" style={{ gridRow: `1 / span ${rows}` }}>
        {example.note === null ? null : <Note note={example.note} />}
      </div>
      {example.lines.map((line, index) => (
        <AnnoLine key={index} glyph={index === example.headerIndex ? GUTTER_GLYPHS[example.status] : null} status={example.status}>
          <GherkinRow line={line} />
        </AnnoLine>
      ))}
    </div>
  );
}

function AnnoLine({ glyph, status, children }: { glyph: string | null; status: string; children: ReactNode }) {
  return (
    <>
      <div className={glyph === null ? "tp-gut" : `tp-gut tp-gut--${status}`} aria-hidden>
        {glyph}
      </div>
      <div className="tp-anno-code">{children}</div>
    </>
  );
}

function Note({ note }: { note: MarginNote }) {
  const [expanded, setExpanded] = useState(false);
  const evidence = note.evidence === null ? null : clipLines(note.evidence, EVIDENCE_LINES);
  return (
    <div className={`tp-mn tp-mn--${note.tone}`}>
      <b>{note.label}</b>
      {note.text === null ? null : <InlineText text={note.text} />}
      {evidence === null ? null : <pre className="tp-evidence">{expanded ? note.evidence : evidence.text}</pre>}
      {evidence?.clipped === true ? (
        <button type="button" className="tp-link-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "show less" : "show all evidence"}
        </button>
      ) : null}
    </div>
  );
}
