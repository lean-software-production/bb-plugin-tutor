// Stable keys for Rules and Examples. The format is part of the on-disk
// contract (spec/PROGRESS.yaml), so it must never change silently:
//
//   rule key    "<feature-file-slug>/<rule-slug>"
//   example key "<feature-file-slug>/<rule-slug>/<example-slug>"
//
// The feature-file slug is the file's basename without `.feature`, slugified.
// Rule and Example slugs are their names, slugified, then de-duplicated among
// siblings in file order ("-2", "-3", …).

const MAX_SLUG_LENGTH = 96;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SLUG_PATTERN = SLUG;
export const RULE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const EXAMPLE_KEY_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Examples that sit directly under a Feature (no Rule) are grouped under this Rule slug. */
export const LOOSE_EXAMPLES_RULE_SLUG = "general";

/**
 * Lower-case ASCII, apostrophes dropped ("doesn't" → "doesnt"), every other
 * run of non-alphanumerics collapsed to "-". Long slugs are cut at a hyphen
 * boundary. Never empty: falls back to "untitled".
 */
export function slugify(text: string): string {
  const base = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base === "") return "untitled";
  if (base.length <= MAX_SLUG_LENGTH) return base;
  const cut = base.slice(0, MAX_SLUG_LENGTH);
  const lastHyphen = cut.lastIndexOf("-");
  return lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut;
}

/** Slugifies each name and suffixes repeats, preserving order. */
export function uniqueSlugs(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const base = slugify(name);
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
    taken.add(slug);
    return slug;
  });
}

export function featureSlugFromPath(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return slugify(file.replace(/\.feature$/i, ""));
}

export function ruleKey(featureSlug: string, ruleSlug: string): string {
  return `${featureSlug}/${ruleSlug}`;
}

export function exampleKey(featureSlug: string, ruleSlug: string, exampleSlug: string): string {
  return `${featureSlug}/${ruleSlug}/${exampleSlug}`;
}

export interface ParsedExampleKey {
  feature: string;
  rule: string;
  example: string;
}

export function parseExampleKey(key: string): ParsedExampleKey | null {
  if (!EXAMPLE_KEY_PATTERN.test(key)) return null;
  const [feature, rule, example] = key.split("/") as [string, string, string];
  return { feature, rule, example };
}

/** The Rule key an Example key belongs to, or null when the key is malformed. */
export function ruleKeyOfExample(key: string): string | null {
  const parsed = parseExampleKey(key);
  return parsed === null ? null : ruleKey(parsed.feature, parsed.rule);
}

export function isSlug(value: string): boolean {
  return SLUG.test(value);
}
