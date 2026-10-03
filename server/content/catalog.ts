// The courses Tutor can add on request (Decision 11): a constant, pinned to
// tags or full SHAs, that the courseCatalog setting (a JSON string) can
// replace, which is how the end-to-end test points at a fixture course.
// The entry's id is the content store's key (store.ts) and the seed marker's
// course id in the workspace (.tutor/seeds/<id>.json).
import { z } from "zod";

export interface CatalogEntry {
  id: string;
  title: string;
  description: string;
  repo: string;
  ref: string;
}

/** The tutorial's commit Tutor fetches: its main at the time of this task (`git ls-remote …/tutorial.git main`), re-pinned to a tag in Task 23. */
export const TUTORIAL_REF = "33eb023e4b4abc4b658535df28d5d5d8e050af52";

export const BUILT_IN_CATALOG: readonly CatalogEntry[] = [
  {
    id: "software-factory",
    title: "Build a software factory",
    description: "Seven lessons, one factory.",
    repo: "https://github.com/lean-software-production/tutorial.git",
    ref: TUTORIAL_REF,
  },
];

/** A ref Tutor fetches (Decision 15): a tag (v…) or a full 40-hex SHA, never a branch name. */
export const PINNED_REF = /^(v\d[0-9A-Za-z._+-]*|[0-9a-f]{40})$/;
export const PINNED_REF_MESSAGE = "should be a tag (v1.2.3) or a full SHA, not a branch name";

/** Safe as a folder name in the content store and as a seed marker's name. */
const CATALOG_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const text = z.string().trim().min(1, "should not be empty");

const catalogSchema = z.array(
  z.object({
    id: z.string().regex(CATALOG_ID, "should be lower-case letters, digits and dashes"),
    title: text,
    description: z.string(),
    repo: text.refine((value) => !value.startsWith("-"), "should be a repository URL"),
    ref: z.string().regex(PINNED_REF, PINNED_REF_MESSAGE),
  }),
);

/**
 * The courseCatalog setting when it parses as a catalog, else BUILT_IN_CATALOG
 * (unset or empty). Refs must be tags (v*) or 40-hex SHAs. A setting that is
 * there but isn't a catalog throws, saying what is wrong with it: falling
 * back to the built-in catalog would fetch a course nobody asked for.
 */
export function catalogFrom(setting: string | undefined): readonly CatalogEntry[] {
  if (setting === undefined || setting.trim() === "") return BUILT_IN_CATALOG;
  let raw: unknown;
  try {
    raw = JSON.parse(setting);
  } catch {
    throw new Error("The courseCatalog setting is not valid JSON.");
  }
  const parsed = catalogSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined || issue.path.length === 0 ? "" : ` (${issue.path.map(String).join(".")})`;
    const why = issue?.message ?? "is not valid";
    // The ref rule is worded for the student; zod's other messages name the field.
    throw new Error(`The courseCatalog setting is not a course catalog${where}: ${why === PINNED_REF_MESSAGE ? "a ref must be a tag or a full SHA" : why}.`);
  }
  const seen = new Set<string>();
  for (const entry of parsed.data) {
    if (seen.has(entry.id)) throw new Error(`The courseCatalog setting lists the course "${entry.id}" twice.`);
    seen.add(entry.id);
  }
  return parsed.data;
}
