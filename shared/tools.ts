// Parameter schemas of the coach tools. The backend registers them
// (`bb.agents.registerTool({ name, parameters, … })`); the skill documents
// them; the feature's scripted-provider tests call them with
// `CALL <tool> {json}` lines, so their JSON shape is a cross-builder contract.
//
// Every tool's execute() must re-check that the calling thread is one Tutor
// spawned (BB runs a plugin tool even when configure did not offer it) and
// return `{ content: [...], isError: true }` otherwise.
import { z } from "zod";
import { TOOL_NAMES, type ToolName } from "./constants.ts";
import { exampleKeySchema, exampleStatusSchema, lessonIdSchema, ruleKeySchema } from "./model.ts";

export const MAX_EVIDENCE_LENGTH = 8000;
export const MAX_NOTE_LENGTH = 1000;
export const MAX_SUMMARY_LENGTH = 2000;

export const toolParameterSchemas = {
  [TOOL_NAMES.status]: z.object({}),
  [TOOL_NAMES.focusRule]: z.object({
    rule: ruleKeySchema.describe("Rule key <feature>/<rule>, as listed by tutor_status."),
  }),
  [TOOL_NAMES.markExample]: z
    .object({
      example: exampleKeySchema.describe("Example key <feature>/<rule>/<example>, as listed by tutor_status."),
      status: exampleStatusSchema,
      evidence: z
        .string()
        .trim()
        .min(1)
        .max(MAX_EVIDENCE_LENGTH)
        .optional()
        .describe("Required for passing: the command you ran and its output, or a test name."),
      note: z
        .string()
        .trim()
        .min(1)
        .max(MAX_NOTE_LENGTH)
        .optional()
        .describe("Required for not-yet: what happened instead. Optional otherwise."),
    })
    .superRefine((value, ctx) => {
      if (value.status === "passing" && value.evidence === undefined) {
        ctx.addIssue({ code: "custom", path: ["evidence"], message: "evidence is required for passing" });
      }
      if (value.status === "not-yet" && value.note === undefined) {
        ctx.addIssue({ code: "custom", path: ["note"], message: "note is required for not-yet" });
      }
    }),
  [TOOL_NAMES.adoptIteration]: z.object({
    iteration: lessonIdSchema.describe("The lesson to adopt: the one after the student's Done iteration."),
  }),
  [TOOL_NAMES.completeIteration]: z.object({
    iteration: lessonIdSchema,
    summary: z
      .string()
      .trim()
      .min(1)
      .max(MAX_SUMMARY_LENGTH)
      .describe("Two or three sentences for the student: what their factory can do now."),
  }),
  [TOOL_NAMES.sideChat]: z.object({
    title: z.string().trim().min(1).max(120),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .describe("The side question, as the student asked it: the side chat's agent reads it before the student's first message."),
    rule: ruleKeySchema.optional().describe("The Rule the side chat is about, if any."),
  }),
} satisfies Record<ToolName, z.ZodType>;

export type ToolParameters<Name extends ToolName> = z.infer<(typeof toolParameterSchemas)[Name]>;
