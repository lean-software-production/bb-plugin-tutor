import { test } from "node:test";
import assert from "node:assert/strict";
import { navigationIconName, simpleNavigationEnabled, simplifyNavigation, type NavigationItemLike } from "./navigation.ts";

// The items bb-app 0.43.4 passes to an experimental_sidebarNavigation component.
const HOST_ITEMS: NavigationItemLike[] = [
  { id: "new-thread", icon: { kind: "host", name: "new-thread" }, action: { kind: "new-thread" } },
  { id: "search-threads", icon: { kind: "host", name: "search" }, action: { kind: "search-threads" } },
  { id: "extensions", icon: { kind: "host", name: "extensions" }, action: { kind: "open-extensions" } },
  { id: "skills", icon: { kind: "host", name: "extensions" }, action: { kind: "open-extensions" } },
  {
    id: "plugin-panel:tutor/course",
    icon: { kind: "plugin", pluginId: "tutor", icon: "FileText" },
    action: { kind: "open-plugin-panel", pluginId: "tutor", panelId: "course" },
  },
  {
    id: "plugin-panel:automations/automations",
    icon: { kind: "plugin", pluginId: "automations", icon: "Clock" },
    action: { kind: "open-plugin-panel", pluginId: "automations", panelId: "automations" },
  },
];

test("Plugins and Skills are dropped; New thread, Search and every plugin panel stay, in order", () => {
  assert.deepEqual(
    simplifyNavigation(HOST_ITEMS).map((item) => item.id),
    ["new-thread", "search-threads", "plugin-panel:tutor/course", "plugin-panel:automations/automations"],
  );
});

test("the extension rows are matched by action as well as id, so a renamed id is still dropped", () => {
  const renamed: NavigationItemLike[] = [
    { id: "resources/plugins", icon: { kind: "host", name: "extensions" }, action: { kind: "open-extensions" } },
    { id: "skills", icon: { kind: "host", name: "extensions" }, action: { kind: "some-future-kind" } },
  ];
  assert.deepEqual(simplifyNavigation(renamed), []);
});

test("simple navigation is on only once settings have loaded and the setting is not false", () => {
  assert.equal(simpleNavigationEnabled({ values: { simpleNavigation: true }, isLoading: false }), true);
  assert.equal(simpleNavigationEnabled({ values: { simpleNavigation: false }, isLoading: false }), false);
  // Any doubt renders BB's own navigation.
  assert.equal(simpleNavigationEnabled({ values: undefined, isLoading: true }), false);
  assert.equal(simpleNavigationEnabled({ values: undefined, isLoading: false }), false);
  assert.equal(simpleNavigationEnabled({ values: { simpleNavigation: "yes" }, isLoading: false }), false);
  assert.equal(simpleNavigationEnabled({ values: {}, isLoading: false }), false);
});

test("icons use BB's own glyphs for host rows and the plugin's icon name for panels", () => {
  assert.equal(navigationIconName({ kind: "host", name: "new-thread" }), "MessageSquarePlus");
  assert.equal(navigationIconName({ kind: "host", name: "search" }), "Search");
  assert.equal(navigationIconName({ kind: "plugin", pluginId: "tutor", icon: "FileText" }), "FileText");
  assert.equal(navigationIconName({ kind: "plugin", pluginId: "x", icon: null }), "Puzzle");
});
