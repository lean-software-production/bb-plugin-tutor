// The paper lesson on a lesson's start page (mockup 2A) with Examples as
// annotated Gherkin (mockup 6B). Pure presentation over LessonView; the page
// owns data and open/closed state.
import { useState } from "react";
import type { ReactNode } from "react";
import { clipLines, plural } from "../model/format.ts";
import { laterFoldId } from "../model/lesson.ts";
import type { ExampleView, FeatureView, LessonView, MarginNote, RuleView } from "../model/lesson.ts";
import { Chips, GherkinLines, GherkinRow, InlineText, ChangeBadge } from "./common.tsx";

const GUTTER_GLYPHS = { passing: "✓", "not-yet": "!", pending: "○", skipped: "–" } as const;
const RULE_GLYPHS = { passing: "✓", "not-yet": "!", pending: "○" } as const;
const EVIDENCE_LINES = 4;

export interface LessonProps {
  view: LessonView;
  openRules: ReadonlySet<string>;
  /** Open folds: feature slugs, and laterFoldId for the Rules after the focus. */
  openFeatures: ReadonlySet<string>;
  onToggleRule: (ruleKey: string) => void;
  onToggleFeature: (foldId: string) => void;
  /** Shown above the lesson, e.g. "you finished this lesson". */
  banner?: ReactNode;
}

export function Lesson({ view, openRules, openFeatures, onToggleRule, onToggleFeature, banner }: LessonProps) {
  const focusFeature = view.focusFeature;
  const ruleList = (rules: readonly RuleView[], focusLabel: string | null = null) => (
    <RuleList rules={rules} openRules={openRules} onToggleRule={onToggleRule} focusLabel={focusLabel} />
  );
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
      {focusFeature !== null && view.otherFeatures.length > 0 ? (
        <div className="tp-folds">
          <p className="tp-section-label">Other features</p>
          {view.otherFeatures.map((feature) => (
            <Fold
              key={feature.slug}
              name={
                <>
                  {feature.name}
                  <ChangeBadge change={feature.change} mixedLabel="changed" />
                </>
              }
              file={feature.file}
              count={feature.count}
              open={openFeatures.has(feature.slug)}
              onToggle={() => onToggleFeature(feature.slug)}
            >
              {ruleList(feature.rules)}
            </Fold>
          ))}
        </div>
      ) : null}
      {focusFeature !== null ? (
        <FeatureSection feature={focusFeature} focusLabel={view.focus?.label ?? null}>
          {/* The focus feature's rules end at the focus; the ones after it fold away above it. */}
          {ruleList(focusFeature.rules.slice(0, -1))}
          {view.laterRules.length === 0 ? null : (
            <Fold
              name="Later in this feature"
              file={null}
              count={plural(view.laterRules.length, "rule")}
              open={openFeatures.has(laterFoldId(focusFeature.slug))}
              onToggle={() => onToggleFeature(laterFoldId(focusFeature.slug))}
            >
              {ruleList(view.laterRules)}
            </Fold>
          )}
          {ruleList(focusFeature.rules.slice(-1), view.focus?.label ?? null)}
        </FeatureSection>
      ) : (
        view.otherFeatures.map((feature) => (
          <FeatureSection key={feature.slug} feature={feature} focusLabel={null}>
            {ruleList(feature.rules)}
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
          <ChangeBadge change={feature.change} mixedLabel="changed" />
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

function Fold({
  name,
  file,
  count,
  open,
  onToggle,
  children,
}: {
  name: ReactNode;
  file: string | null;
  count: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="tp-fold">
      <button type="button" className="tp-fold-head" aria-expanded={open} onClick={onToggle}>
        <span className="tp-fold-name">{name}</span>
        {file === null ? null : <code className="tp-fold-file">{file}</code>}
        <span className="tp-x">
          {count} {open ? "▾" : "›"}
        </span>
      </button>
      {open ? <div className="tp-fold-body">{children}</div> : null}
    </div>
  );
}

function RuleList({
  rules,
  openRules,
  onToggleRule,
  focusLabel,
}: {
  rules: readonly RuleView[];
  openRules: ReadonlySet<string>;
  onToggleRule: (ruleKey: string) => void;
  focusLabel: string | null;
}) {
  return (
    <>
      {rules.map((rule) =>
        rule.isFocus || openRules.has(rule.key) ? (
          <RuleOpen
            key={rule.key}
            rule={rule}
            label={rule.isFocus && focusLabel !== null ? `Rule · ${focusLabel}` : rule.isUpNext ? "Rule · up next" : "Rule"}
            onCollapse={rule.isFocus ? null : () => onToggleRule(rule.key)}
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
              <ChangeBadge change={rule.change} />
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
}: {
  rule: RuleView;
  label: string;
  onCollapse: (() => void) | null;
}) {
  return (
    <section className={rule.isFocus ? "tp-rule tp-rule--focus" : "tp-rule"} data-rule-key={rule.key} aria-label={`Rule ${rule.name}`}>
      <p className="tp-section-label">
        {label}
        <ChangeBadge change={rule.change} />
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
    </section>
  );
}

export function AnnotatedExample({ example }: { example: ExampleView }) {
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
