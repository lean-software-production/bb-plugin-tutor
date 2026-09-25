import type { BbPluginApi, PluginSettingsHandle } from "@get-bb/plugin-sdk";
import { SETTING_KEYS } from "../../shared/constants.ts";

const descriptors = {
  [SETTING_KEYS.coursePath]: {
    type: "string",
    label: "Course folder",
    description:
      "Absolute path of the course checkout. Leave empty to use the tutor feature's setting, or /workspaces/tutorial.",
  },
  [SETTING_KEYS.factoryProject]: {
    type: "project",
    label: "Factory project",
    description: "The BB project holding your factory repo, where the coach works. Tutor never creates it.",
  },
  [SETTING_KEYS.simpleNavigation]: {
    type: "boolean",
    label: "Simple navigation",
    description:
      "Hide BB's Plugins and Skills rows from the sidebar navigation. Takes effect while Tutor's navigation is selected under Settings → Appearance → Navigation.",
    default: true,
  },
} as const;

export type TutorSettings = PluginSettingsHandle<typeof descriptors>;

export function defineTutorSettings(bb: BbPluginApi): TutorSettings {
  return bb.settings.define(descriptors);
}
