// "New since the previous lesson": novelty per Example, rolled up to Rules
// and feature files, and the suggested Rule order that puts fresh Rules first.
// The comparison rules are documented on noveltySchema in shared/model.ts.
import type { Example, FeatureFile, Novelty, RuleKey } from "../../shared/model.ts";

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

function exampleNovelty(example: Example, previous: PreviousIndex): Novelty {
  const previousHash = previous.hashByExampleKey.get(example.key);
  if (previousHash !== undefined) return previousHash === example.hash ? "unchanged" : "reworded";
  return previous.hashes.has(example.hash) ? "unchanged" : "new";
}

/** A Rule or file with no Examples is new unless it existed before. */
function rollUp(novelties: readonly Novelty[], existedBefore: boolean): Novelty {
  if (novelties.length === 0) return existedBefore ? "unchanged" : "new";
  if (novelties.every((novelty) => novelty === "new")) return "new";
  if (novelties.every((novelty) => novelty === "unchanged")) return "unchanged";
  return "reworded";
}

/**
 * Returns `features` with novelty filled in against the previous lesson's
 * features, or everything "new" when there is no previous lesson.
 */
export function withNovelty(
  features: readonly FeatureFile[],
  previousFeatures: readonly FeatureFile[] | null,
): FeatureFile[] {
  const previous = indexPrevious(previousFeatures ?? []);
  const isFirst = previousFeatures === null;
  return features.map((feature) => {
    const rules = feature.rules.map((rule) => {
      const examples = rule.examples.map((example) => ({
        ...example,
        novelty: isFirst ? ("new" as const) : exampleNovelty(example, previous),
      }));
      const novelty = rollUp(
        examples.map((example) => example.novelty),
        previous.ruleKeys.has(rule.key),
      );
      return { ...rule, examples, novelty };
    });
    const novelty = rollUp(
      rules.flatMap((rule) => rule.examples.map((example) => example.novelty)),
      previous.featureSlugs.has(feature.slug),
    );
    return { ...feature, rules, novelty };
  });
}

/** Every Rule key once: Rules that are not unchanged first, then the rest, each in file order. */
export function suggestedRuleOrder(features: readonly FeatureFile[]): RuleKey[] {
  const rules = features.flatMap((feature) => feature.rules);
  return [
    ...rules.filter((rule) => rule.novelty !== "unchanged"),
    ...rules.filter((rule) => rule.novelty === "unchanged"),
  ].map((rule) => rule.key);
}
