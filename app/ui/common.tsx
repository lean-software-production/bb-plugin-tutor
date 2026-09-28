// Small atoms shared by every Tutor surface. All of them render inside a
// `.tutor-sk` ancestor; see app/sketchbook.css.
import type { MouseEvent, ReactNode } from "react";
import { NAV_PANEL_PATH, PLUGIN_ID } from "../../shared/constants.ts";
import type { Change } from "../../shared/model.ts";
import type { GherkinLine } from "../model/gherkin.ts";
import { parseInline } from "../model/inline.ts";
import type { Chip } from "../model/lesson.ts";
import { isConnectionLost } from "../model/rpc-errors.ts";
import { cx } from "../sketch/tone.ts";
import { Button, KitIcon, Panel } from "./sketch/index.ts";

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
export function ChangeBadge({ change, mixedLabel = "reworded" }: { change: Change; mixedLabel?: string }) {
  if (change === "unchanged") return null;
  return <span className="tp-change-badge">{change === "new" ? "new" : mixedLabel}</span>;
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

/** A note on a page: a kit panel with the closest drawn icon (the robot when something went wrong). */
export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  return (
    <Panel
      tone={tone === "error" ? "coral" : "teal"}
      className={`tp-notice tp-notice--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <KitIcon name={tone === "error" ? "robot" : "books"} className="tp-notice-icon" />
      <div className="tp-notice-body">{children}</div>
    </Panel>
  );
}

/** Shown after any error message: a lost connection to the Codespace is only fixed by reloading. */
export function ReloadButton({ message }: { message: string | null }) {
  if (!isConnectionLost(message)) return null;
  return (
    <Button secondary className="tp-reload" onClick={() => window.location.reload()}>
      Reload
    </Button>
  );
}

/** An RPC failure as the student reads it, with Reload when the connection was lost. */
export function ErrorNotice({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <Notice tone="error">
      {message}
      <ReloadButton message={message} />
    </Notice>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p className="tp-loading" role="status">
      <KitIcon name="books" className="tp-loading-icon" />
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

/**
 * A Tutor page in the Sketchbook kit: the plain kit page with one centred
 * column. `edge` is one small character, placed by the caller's
 * CSS at an edge of the page (not over the column).
 */
export function SketchPage({ children, roomy = false, edge = null }: { children: ReactNode; roomy?: boolean; edge?: ReactNode }) {
  return (
    <div className="tutor-sk tp-page">
      <div className={cx("tp-page-in", edge !== null && "tp-page-in--edge")}>
        <div className={cx("tp-page-col", roomy && "tp-page-col--roomy")}>{children}</div>
        {edge}
      </div>
    </div>
  );
}
