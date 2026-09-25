// The sidebar navigation for a course codespace: BB's own rows minus Plugins
// and Skills (app/model/navigation.ts), activated through BB so every row
// still does exactly what BB's does. With the simpleNavigation setting off,
// or before settings load, BB's own navigation renders instead.
import { experimental_Icon as Icon, useSettings } from "@get-bb/plugin-sdk/app";
import type { ExperimentalSidebarNavigationItem, ExperimentalSidebarNavigationProps } from "@get-bb/plugin-sdk/app";
import { PLUGIN_ID, SLOT_IDS } from "../../shared/constants.ts";
import { FALLBACK_ICON, navigationIconName, simpleNavigationEnabled, simplifyNavigation } from "../model/navigation.ts";
import { CourseAccessory } from "./Home.tsx";

/** New thread and Search are actions; like BB, only destinations show as the current page. */
function isDestination(item: ExperimentalSidebarNavigationItem): boolean {
  return item.action.kind === "open-plugin-panel";
}

function isCourseRow(item: ExperimentalSidebarNavigationItem): boolean {
  return item.action.kind === "open-plugin-panel" && item.action.pluginId === PLUGIN_ID && item.action.panelId === SLOT_IDS.navPanel;
}

export function SimpleNavigation({
  items,
  activeItemId,
  experimental_activate: activate,
  experimental_Original: Original,
}: ExperimentalSidebarNavigationProps) {
  const settings = useSettings();
  if (!simpleNavigationEnabled(settings)) return <Original />;
  return (
    <ul className="tutor-nav">
      {simplifyNavigation(items).map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="tp-nav-item"
            aria-current={isDestination(item) && item.id === activeItemId ? "page" : undefined}
            aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
            title={item.shortcut === null ? undefined : `${item.label} (${item.shortcut.label})`}
            disabled={item.isDisabled}
            {...item.experimental_splitProps}
            // Like BB's own rows: Cmd/Ctrl-click opens the destination in a split.
            onClick={(event) => activate(item.id, { openInSplit: event.metaKey || event.ctrlKey })}
          >
            <Icon name={navigationIconName(item.icon)} fallback={FALLBACK_ICON} aria-hidden className="tp-nav-icon" />
            <span className="tp-nav-label">{item.label}</span>
            {isCourseRow(item) ? <CourseAccessory /> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
