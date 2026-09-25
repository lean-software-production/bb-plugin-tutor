import type { PluginAgentConfiguration, PluginAgentConfigurationContext } from "@get-bb/plugin-sdk";
import { ALL_TOOL_NAMES, SKILL_ID } from "../../shared/constants.ts";
import { coachInstructions, type InstructionFacts } from "./prompts.ts";

/** Synchronous by contract. Only threads Tutor spawned get the tools, the skill and instructions. */
export function coachConfiguration(
  context: PluginAgentConfigurationContext,
  pluginId: string,
  facts: InstructionFacts,
): PluginAgentConfiguration {
  if (context.origin.pluginId !== pluginId) return { tools: [], skills: [] };
  return {
    tools: [...ALL_TOOL_NAMES],
    skills: [SKILL_ID],
    instructions: coachInstructions(context.pluginMetadata, facts),
  };
}
