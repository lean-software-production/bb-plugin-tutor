import type { BbPluginApi, PluginSettingsHandle } from "@get-bb/plugin-sdk";
import { SETTING_KEYS } from "../../shared/constants.ts";

const descriptors = {
  [SETTING_KEYS.coursePath]: {
    type: "string",
    label: "Course folder",
    description:
      "Development only: absolute path of a course checkout on the server, in place of the hosted catalog. Leave empty for the normal first-run experience.",
  },
  [SETTING_KEYS.workspaceProject]: {
    type: "project",
    label: "Workspace",
    description: "The project holding your repo, where the coach works. Tutor makes it for your Codespace's checkout when you first start, and again if your Codespace changes.",
  },
  [SETTING_KEYS.factoryProject]: {
    type: "project",
    label: "Factory project (older Tutor)",
    description: "Read only: an older Tutor's workspace setting, still read as a fallback. Set Workspace instead.",
  },
  [SETTING_KEYS.simpleNavigation]: {
    type: "boolean",
    label: "Simple navigation",
    description:
      "Hide the Plugins and Skills rows from the sidebar navigation. Takes effect while Tutor's navigation is selected under Settings → Appearance → Navigation.",
    default: true,
  },
  [SETTING_KEYS.coachProvider]: {
    type: "string",
    label: "Coach agent",
    description:
      "The agent provider coach threads use, such as claude-code, codex or pi. Empty uses the first of Claude Code, Codex and pi you have signed in to in your Codespace, else the default agent.",
  },
  [SETTING_KEYS.coachModel]: {
    type: "string",
    label: "Coach model",
    description: "The model coach threads use, as provider/model. Applies only with a Coach agent set; empty uses the agent's default.",
  },
  [SETTING_KEYS.courseCatalog]: {
    type: "string",
    label: "Course catalog",
    description:
      "The courses you can add, as JSON: a list of { id, title, description, repo, ref }, each ref a tag or a full SHA. Leave empty for Tutor's own list.",
  },
  [SETTING_KEYS.workspaceFolder]: {
    type: "string",
    label: "Workspace folder",
    description: "The folder on your Codespace that Tutor offers as your workspace the first time. Leave empty for /workspaces/capstone-project-starter.",
  },
} as const;

export type TutorSettings = PluginSettingsHandle<typeof descriptors>;

export function defineTutorSettings(bb: BbPluginApi): TutorSettings {
  return bb.settings.define(descriptors);
}
