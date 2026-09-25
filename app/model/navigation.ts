// The course codespace's sidebar navigation: BB's own items without Plugins
// and Skills, which a student has no use for. Structural types, so node tests
// need no SDK import; they match ExperimentalSidebarNavigationItem.
import { SETTING_KEYS } from "../../shared/constants.ts";

export type NavigationIconLike =
  | { kind: "host"; name: string }
  | { kind: "plugin"; pluginId: string; icon: string | null };

export interface NavigationItemLike {
  id: string;
  icon: NavigationIconLike;
  action: { kind: string; pluginId?: string; panelId?: string };
}

/** BB 0.43.4's ids for the Plugins and Skills rows; both open BB's extensions workspace. */
const HIDDEN_IDS: ReadonlySet<string> = new Set(["extensions", "skills"]);
const HIDDEN_ACTIONS: ReadonlySet<string> = new Set(["open-extensions"]);

export function simplifyNavigation<T extends NavigationItemLike>(items: readonly T[]): T[] {
  return items.filter((item) => !HIDDEN_IDS.has(item.id) && !HIDDEN_ACTIONS.has(item.action.kind));
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
