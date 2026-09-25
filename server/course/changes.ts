// "New since the previous lesson": new/reworded per Example, rolled up to Rules
// and feature files, and the suggested Rule order that puts fresh Rules first.
// The comparison rules are documented on changeSchema in shared/model.ts.
import type { Example, FeatureFile, Change, RuleKey } from "../../shared/model.ts";

interface PreviousIndex {
  hashByExampleKey: ReadonlyMap<string, string>;
  hashes: ReadonlySet<string>;
  ruleKeys: ReadonlySet<string>;
  featureSlugs: ReadonlySet<string>;
}

function indexPrevious(features: readonly FeatureFile[]): PreviousIndex {
  const hashByExampleKey = new Map<string, string>();
  const ruleKeys = new Set<string>();
  for (const feature of features) {
    for (const rule of feature.rules) {
      ruleKeys.add(rule.key);
      for (const example of rule.examples) hashByExampleKey.set(example.key, example.hash);
    }
  }
  return {
    hashByExampleKey,
    hashes: new Set(hashByExampleKey.values()),
    ruleKeys,
    featureSlugs: new Set(features.map((feature) => feature.slug)),
  };
}

function exampleChange(example: Example, previous: PreviousIndex): Change {
  const previousHash = previous.hashByExampleKey.get(example.key);
  if (previousHash !== undefined) return previousHash === example.hash ? "unchanged" : "reworded";
  return previous.hashes.has(example.hash) ? "unchanged" : "new";
}

/** A Rule or file with no Examples is new unless it existed before. */
function rollUp(changes: readonly Change[], existedBefore: boolean): Change {
  if (changes.length === 0) return existedBefore ? "unchanged" : "new";
  if (changes.every((change) => change === "new")) return "new";
  if (changes.every((change) => change === "unchanged")) return "unchanged";
  return "reworded";
}

/**
 * Returns `features` with each change (new, reworded or unchanged) filled in
 * against the previous lesson's features, or everything "new" when there is
 * no previous lesson.
 */
export function withChanges(
  features: readonly FeatureFile[],
  previousFeatures: readonly FeatureFile[] | null,
): FeatureFile[] {
  const previous = indexPrevious(previousFeatures ?? []);
  const isFirst = previousFeatures === null;
  return features.map((feature) => {
    const rules = feature.rules.map((rule) => {
      const examples = rule.examples.map((example) => ({
        ...example,
        change: isFirst ? ("new" as const) : exampleChange(example, previous),
      }));
      const change = rollUp(
        examples.map((example) => example.change),
        previous.ruleKeys.has(rule.key),
      );
      return { ...rule, examples, change };
    });
    const change = rollUp(
      rules.flatMap((rule) => rule.examples.map((example) => example.change)),
      previous.featureSlugs.has(feature.slug),
    );
    return { ...feature, rules, change };
  });
}

/** Every Rule key once: Rules that are not unchanged first, then the rest, each in file order. */
export function suggestedRuleOrder(features: readonly FeatureFile[]): RuleKey[] {
  const rules = features.flatMap((feature) => feature.rules);
  return [
    ...rules.filter((rule) => rule.change !== "unchanged"),
    ...rules.filter((rule) => rule.change === "unchanged"),
  ].map((rule) => rule.key);
}
