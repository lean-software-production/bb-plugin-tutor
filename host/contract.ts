// The contract between the plugin's server half and its host entry (host.ts),
// which BB's host daemon runs on the student's machine. Shared by both halves.
import { z } from "zod";

export const pathKindSchema = z.enum(["folder", "link", "file", "none"]);

export const hostContract = {
  /** lstat kinds and real paths of absolute paths on the machine: what sdk.files can't tell. */
  inspect: {
    input: z.object({
      paths: z.array(z.string().startsWith("/")).max(256),
      realPaths: z.array(z.string().startsWith("/")).max(16),
    }),
    output: z.object({
      kinds: z.record(z.string(), pathKindSchema),
      realPaths: z.record(z.string(), z.string()),
    }),
  },
  // adoptLesson: Task 10; seedWorkspace: Task 11
} as const;

export type HostContract = typeof hostContract;
export type InspectInput = z.infer<HostContract["inspect"]["input"]>;
export type InspectOutput = z.infer<HostContract["inspect"]["output"]>;
