import { test } from "node:test";
import assert from "node:assert/strict";
import { navigationIconName, simpleNavigationEnabled, simplifyNavigation, type NavigationItemLike } from "./navigation.ts";

/** A navigation item with the fields simplifyNavigation and its tests need; the rest default. */
function item(fields: Partial<NavigationItemLike> & Pick<NavigationItemLike, "id" | "icon" | "action">): NavigationItemLike {
  return { label: fields.id, isDisabled: false, shortcut: null, ...fields };
}

// The items bb-app 0.44.0 passes to an experimental_sidebarNavigation component.
const HOST_ITEMS: NavigationItemLike[] = [
  item({ id: "__bb__/new-thread", icon: { kind: "host", name: "new-thread" }, action: { kind: "new-thread" } }),
  item({ id: "__bb__/search-threads", icon: { kind: "host", name: "search" }, action: { kind: "search-threads" } }),
  item({ id: "__bb__/extensions", icon: { kind: "host", name: "extensions" }, action: { kind: "open-extensions" } }),
  item({ id: "__bb__/skills", icon: { kind: "host", name: "extensions" }, action: { kind: "open-skills" } }),
  item({
    id: "tutor/course",
    icon: { kind: "plugin", pluginId: "tutor", icon: "FileText" },
    action: { kind: "open-plugin-panel", pluginId: "tutor", panelId: "course" },
  }),
  item({
    id: "automations/automations",
    icon: { kind: "plugin", pluginId: "automations", icon: "Clock" },
    action: { kind: "open-plugin-panel", pluginId: "automations", panelId: "automations" },
  }),
];

test("Plugins and Skills are dropped; New thread, Search and every plugin panel stay, in order", () => {
  assert.deepEqual(
    simplifyNavigation(HOST_ITEMS).map((i) => i.id),
    ["__bb__/new-thread", "__bb__/search-threads", "tutor/course", "automations/automations"],
  );
});

test("the extension and skills rows are matched by action as well as id, so a renamed id is still dropped", () => {
  const renamed: NavigationItemLike[] = [
    item({ id: "resources/plugins", icon: { kind: "host", name: "extensions" }, action: { kind: "open-extensions" } }),
    item({ id: "resources/skills", icon: { kind: "host", name: "extensions" }, action: { kind: "open-skills" } }),
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
