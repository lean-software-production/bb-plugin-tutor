// What the server and the student's machine share about a workspace's layout:
// the questions layout detection asks, and where a course's progress lives.

export type PathKind = "folder" | "link" | "file" | "none";

/** What layout detection may ask about the workspace: lstat kinds and real paths of absolute machine paths. */
export interface LayoutProbe {
  kinds(paths: readonly string[]): Promise<Record<string, PathKind>>;
  realPath(path: string): Promise<string>;
}

/** Where one course's progress lives in the workspace. Paths in it are relative to `dir`. */
export interface ProgressLocation {
  dir: string;
  progressFile: string;
  /** Read in order; the first is the one written. Empty: there is no ITERATION (the built-in course). */
  iterationFiles: readonly string[];
}
