// Small paper atoms shared by every Tutor surface. All of them render inside
// a `.tutor-paper` ancestor; see app/paper.css.
import type { MouseEvent, ReactNode } from "react";
import { NAV_PANEL_PATH, PLUGIN_ID } from "../../shared/constants.ts";
import type { Novelty } from "../../shared/model.ts";
import type { GherkinLine } from "../model/gherkin.ts";
import { parseInline } from "../model/inline.ts";
import type { Chip } from "../model/lesson.ts";

/** App-relative URL of a course sub-route, for anchors that also work with middle-click. */
export function coursePageHref(subPath: string): string {
  const base = `/plugins/${PLUGIN_ID}/${NAV_PANEL_PATH}`;
  return subPath === "" ? base : `${base}/${subPath}`;
}

/** True for a click the app should route itself (not a new-tab or modified click). */
export function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token, index) => {
        switch (token.kind) {
          case "code":
            return <code key={index}>{token.text}</code>;
          case "strong":
            return <strong key={index}>{token.text}</strong>;
          case "em":
            return <em key={index}>{token.text}</em>;
          case "text":
            return <span key={index}>{token.text}</span>;
        }
      })}
    </>
  );
}

/** A feature's "reworded" means a mix of new and reworded Rules, so it reads "changed". */
export function NewDot({ novelty, mixedLabel = "reworded" }: { novelty: Novelty; mixedLabel?: string }) {
  if (novelty === "unchanged") return null;
  return <span className="tp-newdot">{novelty === "new" ? "new" : mixedLabel}</span>;
}

export function Bar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="tp-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Chips({ chips }: { chips: readonly Chip[] }) {
  return (
    <div className="tp-meta">
      {chips.map((chip) => (
        <span key={chip.text} className={chip.tone === "plain" ? "tp-chip" : `tp-chip tp-chip--${chip.tone}`}>
          {chip.text}
        </span>
      ))}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  return (
    <div className={`tp-notice tp-notice--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p className="tp-loading" role="status">
      {label}
    </p>
  );
}

export function GherkinLines({ lines }: { lines: readonly GherkinLine[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <GherkinRow key={index} line={line} />
      ))}
    </>
  );
}

export function GherkinRow({ line }: { line: GherkinLine }) {
  return (
    <div
      className={line.verbatim ? "tp-gl tp-gl--verbatim" : "tp-gl"}
      style={{ ["--tp-indent" as string]: line.indent }}
    >
      {line.tokens.map((token, index) => (
        <span key={index} className={token.kind === "text" ? undefined : `tp-gk--${token.kind}`}>
          {token.text}
        </span>
      ))}
    </div>
  );
}

/** A plain paper page: grid background, one centred column with the margin rule. */
export function PaperPage({ children, roomy = false }: { children: ReactNode; roomy?: boolean }) {
  return (
    <div className="tutor-grid tp-page">
      <div className={`tutor-paper tp-page-col tp-margin${roomy ? " tp-page-col--roomy" : ""}`}>{children}</div>
    </div>
  );
}
