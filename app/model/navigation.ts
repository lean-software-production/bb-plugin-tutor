// The course codespace's sidebar navigation: BB's own items without Plugins
// and Skills, which a student has no use for. Structural types, so node tests
// need no SDK import; they match ExperimentalSidebarNavigationItem.
import { SETTING_KEYS } from "../../shared/constants.ts";

export type NavigationIconLike =
  | { kind: "host"; name: string }
  | { kind: "plugin"; pluginId: string; icon: string | null };

export interface NavigationShortcutLike {
  label: string;
  ariaKeyShortcuts: string;
}

export interface NavigationItemLike {
  id: string;
  label: string;
  icon: NavigationIconLike;
  action: { kind: string; pluginId?: string; panelId?: string };
  isDisabled: boolean;
  /**
   * False when the student hid this item through BB's customize editor. BB's own navigation
   * keeps hidden items reachable in an overflow menu; Tutor's simplified nav has no menu to put
   * one in (it already drops Plugins and Skills outright, never offering them back), so it drops
   * hidden items too rather than building new UI just to reinstate a reachability guarantee BB's
   * own "Customize" entry point already gives the student (through the setting that turns this
   * simplified nav off).
   */
  isVisible: boolean;
  shortcut: NavigationShortcutLike | null;
}

/** BB 0.44.0's ids for the Plugins and Skills rows; each has its own action kind too. */
const HIDDEN_IDS: ReadonlySet<string> = new Set(["__bb__/extensions", "__bb__/skills"]);
const HIDDEN_ACTIONS: ReadonlySet<string> = new Set(["open-extensions", "open-skills"]);

export function simplifyNavigation<T extends NavigationItemLike>(items: readonly T[]): T[] {
  return items.filter((item) => item.isVisible && !HIDDEN_IDS.has(item.id) && !HIDDEN_ACTIONS.has(item.action.kind));
}

export interface SettingsStateLike {
  values: Record<string, string | number | boolean> | undefined;
  isLoading: boolean;
}

/** On only when the loaded setting says so; anything uncertain falls back to BB's navigation. */
export function simpleNavigationEnabled(settings: SettingsStateLike): boolean {
  return !settings.isLoading && settings.values?.[SETTING_KEYS.simpleNavigation] === true;
}

/** The glyphs BB's own navigation uses for its rows. */
const HOST_ICONS: Readonly<Record<string, string>> = {
  "new-thread": "MessageSquarePlus",
  search: "Search",
  extensions: "Plug02",
};
export const FALLBACK_ICON = "Puzzle";

export function navigationIconName(icon: NavigationIconLike): string {
  if (icon.kind === "host") return HOST_ICONS[icon.name] ?? FALLBACK_ICON;
  return icon.icon ?? FALLBACK_ICON;
}
