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

/**
 * What is at `path` once symbolic links are followed, as stat sees it: a link
 * reads as its target's kind, and a dangling one as "none".
 */
export async function followedKind(probe: LayoutProbe, path: string): Promise<PathKind> {
  const kind = (await probe.kinds([path]))[path] ?? "none";
  if (kind !== "link") return kind;
  const target = await probe.realPath(path);
  const targetKind = (await probe.kinds([target]))[target] ?? "none";
  // A link that does not resolve comes back as itself (or another link): nothing is there.
  return targetKind === "link" ? "none" : targetKind;
}
