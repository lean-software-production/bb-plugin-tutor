// Parses one .feature file into the shared model with @cucumber/gherkin.
// Novelty is left as "new" here; novelty.ts compares homeworks afterwards.
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import type * as Gherkin from "@cucumber/messages";
import {
  LOOSE_EXAMPLES_RULE_SLUG,
  exampleKey,
  featureSlugFromPath,
  ruleKey,
  uniqueSlugs,
} from "../../shared/keys.ts";
import type { Example, FeatureFile, Rule, Step } from "../../shared/model.ts";
import { CourseLoadError } from "../../shared/ports.ts";
import { exampleHash } from "./example-hash.ts";
import { dedent } from "./text.ts";

export interface FeatureSource {
  /** The file's text. */
  text: string;
  /** Relative to the homework dir, POSIX separators: "features/assembly-line.feature". */
  path: string;
  /** How to name the file in an error message, e.g. relative to the course root. */
  displayPath: string;
}

export function parseFeatureFile(source: FeatureSource): FeatureFile {
  const feature = parseGherkin(source).feature;
  if (feature === undefined) {
    throw new CourseLoadError(`${source.displayPath} has no Feature.`);
  }
  const featureSlug = featureSlugFromPath(source.path);
  const background = feature.children.flatMap((child) => child.background?.steps ?? []);
  const looseScenarios = feature.children.flatMap((child) =>
    child.scenario === undefined ? [] : [child.scenario],
  );
  const gherkinRules = feature.children.flatMap((child) => (child.rule === undefined ? [] : [child.rule]));

  const ruleNames = gherkinRules.map((rule) => rule.name);
  const hasLoose = looseScenarios.length > 0;
  // The synthetic Rule claims its slug first so a real Rule named "General" becomes "general-2".
  const slugs = uniqueSlugs(hasLoose ? [LOOSE_EXAMPLES_RULE_SLUG, ...ruleNames] : ruleNames);
  const ruleSlugs = hasLoose ? slugs.slice(1) : slugs;

  const rules: Rule[] = gherkinRules.map((rule, index) =>
    toRule(featureSlug, ruleSlugs[index] ?? "untitled", {
      name: rule.name,
      description: rule.description,
      tags: rule.tags,
      line: rule.location.line,
      background: rule.children.flatMap((child) => child.background?.steps ?? []),
      scenarios: rule.children.flatMap((child) => (child.scenario === undefined ? [] : [child.scenario])),
    }),
  );
  if (hasLoose) {
    rules.unshift(
      toRule(featureSlug, LOOSE_EXAMPLES_RULE_SLUG, {
        name: feature.name,
        description: "",
        tags: [],
        line: looseScenarios[0]?.location.line ?? feature.location.line,
        background: [],
        scenarios: looseScenarios,
      }),
    );
  }

  return {
    slug: featureSlug,
    path: source.path,
    name: feature.name,
    description: dedent(feature.description),
    tags: tagNames(feature.tags),
    background: background.map(toStep),
    rules,
    novelty: "new",
  };
}

function parseGherkin(source: FeatureSource): Gherkin.GherkinDocument {
  const parser = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher());
  try {
    return parser.parse(source.text);
  } catch (error) {
    throw new CourseLoadError(describeParseError(source.displayPath, error));
  }
}

/** "features/x.feature, line 5: expected …" from the first of the parser's errors. */
function describeParseError(displayPath: string, error: unknown): string {
  const errors = (error as { errors?: unknown[] }).errors;
  const first = (Array.isArray(errors) && errors.length > 0 ? errors[0] : error) as {
    message?: unknown;
    location?: { line?: number };
  };
  const message = typeof first.message === "string" ? first.message : String(error);
  const withoutPosition = message.replace(/^\(\d+:\d+\):\s*/, "");
  const line = first.location?.line;
  const where = typeof line === "number" ? `${displayPath}, line ${line}` : displayPath;
  const more = Array.isArray(errors) && errors.length > 1 ? ` (and ${errors.length - 1} more)` : "";
  return `Could not read ${where}: ${withoutPosition}${more}`;
}

interface RuleParts {
  name: string;
  description: string;
  tags: readonly Gherkin.Tag[];
  line: number;
  background: readonly Gherkin.Step[];
  scenarios: readonly Gherkin.Scenario[];
}

function toRule(featureSlug: string, slug: string, parts: RuleParts): Rule {
  const exampleSlugs = uniqueSlugs(parts.scenarios.map((scenario) => scenario.name));
  const examples = parts.scenarios.map((scenario, index) =>
    toExample(featureSlug, slug, exampleSlugs[index] ?? "untitled", scenario),
  );
  return {
    key: ruleKey(featureSlug, slug),
    slug,
    name: parts.name,
    description: dedent(parts.description),
    tags: tagNames(parts.tags),
    background: parts.background.map(toStep),
    examples,
    line: parts.line,
    novelty: "new",
  };
}

function toExample(featureSlug: string, ruleSlug: string, slug: string, scenario: Gherkin.Scenario): Example {
  const steps = scenario.steps.map(toStep);
  return {
    key: exampleKey(featureSlug, ruleSlug, slug),
    slug,
    name: scenario.name,
    description: dedent(scenario.description),
    tags: tagNames(scenario.tags),
    steps,
    hash: exampleHash(scenario.name, steps),
    line: scenario.location.line,
    novelty: "new",
  };
}

function toStep(step: Gherkin.Step): Step {
  return {
    keyword: step.keyword.trim(),
    text: step.text,
    docString:
      step.docString === undefined
        ? null
        : { mediaType: step.docString.mediaType ?? null, content: step.docString.content },
    dataTable: step.dataTable === undefined ? null : step.dataTable.rows.map((row) => row.cells.map((cell) => cell.value)),
    line: step.location.line,
  };
}

function tagNames(tags: readonly Gherkin.Tag[]): string[] {
  return tags.map((tag) => tag.name.replace(/^@/, ""));
}
