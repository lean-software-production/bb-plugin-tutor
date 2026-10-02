// The one port through which the server reads, probes and writes the
// student's workspace. Production reaches it through the machine (Task 8);
// until then, server/workspace/local-access.ts is the local disk.
import type { LayoutProbe } from "../../layouts/types.ts";

export interface FileText {
  text: string;
  sha256: string;
}

export interface WorkspaceAccess extends LayoutProbe {
  /** The file's text and its sha256, or null when it does not exist. */
  read(path: string): Promise<FileText | null>;
  /** expected: a sha256 the file must still have; null: it must not exist yet; undefined: no check. */
  write(path: string, text: string, expected?: string | null): Promise<void>;
  /** Deletes the file; a file that is already gone is fine. */
  remove(path: string): Promise<void>;
}

/** The machine holding the workspace can't be reached. */
export class WorkspaceUnreachableError extends Error {
  override name = "WorkspaceUnreachableError";
}

/** A write's expected sha256 no longer matches the file. */
export class WriteConflictError extends Error {
  override name = "WriteConflictError";
}
