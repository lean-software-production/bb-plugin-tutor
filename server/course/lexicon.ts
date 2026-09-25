// docs/lexicon.yaml: `<id>: { term, definition }` per entry.
import { isSlug } from "../../shared/keys.ts";
import type { LexiconEntry } from "../../shared/model.ts";
import { CourseLoadError } from "../../shared/ports.ts";
import { readYaml } from "./yaml-file.ts";

export function parseLexicon(text: string, displayPath: string): LexiconEntry[] {
  const { data, lineOf } = readYaml(text, displayPath, "core");
  if (data === null || data === undefined) return [];
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new CourseLoadError(`${displayPath} should map each term id to a term and a definition.`);
  }
  return Object.entries(data as Record<string, unknown>).map(([id, value]) => {
    const where = `${displayPath}, line ${lineOf([id])}`;
    if (!isSlug(id)) {
      throw new CourseLoadError(`${where}: the term id "${id}" should be lower-case words joined by hyphens.`);
    }
    const entry = (typeof value === "object" && value !== null ? value : {}) as {
      term?: unknown;
      definition?: unknown;
    };
    if (typeof entry.term !== "string" || typeof entry.definition !== "string") {
      throw new CourseLoadError(`${where}: "${id}" needs a term and a definition.`);
    }
    return { id, term: entry.term, definition: entry.definition };
  });
}
