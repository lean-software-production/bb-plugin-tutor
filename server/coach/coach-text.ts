// Reads a course's coach file on the server, so its text can be inlined into
// the coach thread's first prompt and configure's instructions: coach threads
// run on the student's machine now, where a server path means nothing.
// Course content is read on the server throughout (server/course/*), so this
// is allowed to touch the local filesystem (test/no-workspace-io.test.ts).
import { readFile } from "node:fs/promises";

export const MAX_COACH_TEXT = 48 * 1024;

const TRUNCATION_NOTE = "\n\n[The coaching method is longer than Tutor passes on; the rest is left out.]";

/** `path`'s text, capped at MAX_COACH_TEXT with a note when it is cut. */
export async function readCoachText(path: string): Promise<string> {
  const text = await readFile(path, "utf8");
  if (text.length <= MAX_COACH_TEXT) return text;
  return `${text.slice(0, MAX_COACH_TEXT - TRUNCATION_NOTE.length)}${TRUNCATION_NOTE}`;
}
