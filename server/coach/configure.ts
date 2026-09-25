import type { PluginAgentConfiguration, PluginAgentConfigurationContext } from "@get-bb/plugin-sdk";
import { ALL_TOOL_NAMES, SKILL_ID } from "../../shared/constants.ts";
import { coachInstructions, type InstructionFacts, type ThreadPlace } from "./prompts.ts";

export interface ConfigureFacts extends InstructionFacts {
  /** The lesson of a known coach thread, else undefined (coach-registry.ts). */
  coachLesson(threadId: string): string | undefined;
}

/**
 * Synchronous by contract. Threads Tutor spawned or forked get the tools, the
 * skill and instructions, and so do side chats BB made of a coach thread
 * Tutor knows. Every tool re-checks the calling thread anyway.
 */
export function coachConfiguration(
  context: PluginAgentConfigurationContext,
  pluginId: string,
  facts: ConfigureFacts,
): PluginAgentConfiguration {
  const { sourceThreadId, parentThreadId } = context.thread;
  const forkOf = context.origin.kind === "fork" && sourceThreadId !== null ? facts.coachLesson(sourceThreadId) : undefined;
  const own = context.origin.pluginId === pluginId;
  if (!own && forkOf === undefined) return { tools: [], skills: [] };
  const place: ThreadPlace =
    context.origin.kind === "fork"
      ? { kind: "side-chat", lessonId: forkOf ?? null }
      : parentThreadId !== null
        ? { kind: "side-thread" }
        : { kind: "coach" };
  return {
    tools: [...ALL_TOOL_NAMES],
    skills: [SKILL_ID],
    instructions: coachInstructions(context.pluginMetadata, { coachPath: facts.coachPath }, place),
  };
}
