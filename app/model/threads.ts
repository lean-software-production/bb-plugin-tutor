// How Tutor draws BB's live thread state. The SDK ships no status component,
// so each surface maps `PluginSidebarThread.indicator` to its own glyph.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/** The fields of a sidebar thread Tutor reads (tests build only these). */
export type SidebarThreadLike = Pick<
  PluginSidebarThread,
  | "id"
  | "projectId"
  | "href"
  | "displayTitle"
  | "parentThreadId"
  | "sourceThreadId"
  | "indicator"
  | "indicatorLabel"
  | "isHidden"
  | "isArchived"
  | "isPinned"
  | "createdAt"
  | "updatedAt"
>;

export type IndicatorTone = "working" | "attention" | "error" | "unread" | "queued" | "none";

export interface IndicatorView {
  tone: IndicatorTone;
  /** BB's accessible label, or null when there is nothing to announce. */
  label: string | null;
}

/** Unknown kinds draw nothing, as the SDK asks: BB adds kinds over time. */
export function indicatorTone(indicator: string): IndicatorTone {
  switch (indicator) {
    case "runtime":
    case "background-agent":
    case "background-command":
    case "workflow":
    case "goal":
    case "plan-mode":
    case "working-draft":
      return "working";
    case "waiting-for-input":
      return "attention";
    case "unread-error":
    case "queued-failed":
      return "error";
    case "unread-success":
      return "unread";
    case "queued-waiting":
      return "queued";
    default:
      return "none";
  }
}

export function indicatorView(thread: Pick<SidebarThreadLike, "indicator" | "indicatorLabel">): IndicatorView {
  const tone = indicatorTone(thread.indicator);
  return { tone, label: tone === "none" ? null : thread.indicatorLabel };
}

/** Threads a list should draw: BB's own list hides these too. */
export function isListed(thread: Pick<SidebarThreadLike, "isHidden" | "isArchived">): boolean {
  return !thread.isHidden && !thread.isArchived;
}
