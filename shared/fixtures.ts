// Small, schema-valid fixtures so the backend and the frontend can build and
// test before the content builder's real course loader lands. The course is a
// cut-down "Build a software factory": Lesson 0, then 001–003, with the
// student in the middle of 002. shared/fixtures.test.ts checks every fixture
// against its schema, so they cannot drift from the contract.
//
// Hashes here are fake (a stable digest of the Example's name and steps, not
// sha256 of the normalised text); only equality matters to the model.
import { BUILTIN_LESSON_ID, coachThreadTitle } from "./constants.ts";
import { countExamples, lessonExamples, ruleStatus } from "./derive.ts";
import { exampleKey, featureSlugFromPath, ruleKey, uniqueSlugs } from "./keys.ts";
import type {
  Course,
  Example,
  ExampleProgress,
  FeatureFile,
  Lesson,
  LexiconEntry,
  Novelty,
  Rule,
  Step,
  StudentState,
} from "./model.ts";
import type {
  FactoryProject,
  CandidateProject,
  Completion,
  FeatureOutline,
  LessonDetail,
  Overview,
  TutorThread,
} from "./rpc.ts";

export const FIXTURE_COURSE_ROOT = "/workspaces/tutorial";
export const FIXTURE_FACTORY_ROOT = "/workspaces/my-factory";
export const FIXTURE_NOW = "2026-09-25T10:12:00Z";

/** Stable fake "sha256:<64 hex>" digest: FNV-1a over the text with eight seeds. */
export function fakeHash(text: string): string {
  let hex = "";
  for (let seed = 0; seed < 8; seed += 1) {
    let h = (0x811c9dc5 ^ seed) >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    hex += h.toString(16).padStart(8, "0");
  }
  return `sha256:${hex}`;
}

function steps(...lines: string[]): Step[] {
  return lines.map((line, index) => {
    const [keyword = "", ...words] = line.split(" ");
    return { keyword, text: words.join(" "), docString: null, dataTable: null, line: index + 1 };
  });
}

interface ExampleSpec {
  name: string;
  steps: Step[];
  novelty: Novelty;
  tags?: string[];
}
interface RuleSpec {
  name: string;
  description?: string;
  examples: ExampleSpec[];
}

function aggregate(novelties: readonly Novelty[]): Novelty {
  if (novelties.length > 0 && novelties.every((n) => n === "new")) return "new";
  if (novelties.every((n) => n === "unchanged")) return "unchanged";
  return "reworded";
}

function feature(path: string, name: string, description: string, specs: RuleSpec[]): FeatureFile {
  const featureSlug = featureSlugFromPath(path);
  const ruleSlugs = uniqueSlugs(specs.map((spec) => spec.name));
  const rules: Rule[] = specs.map((spec, ruleIndex) => {
    const ruleSlug = ruleSlugs[ruleIndex] ?? "untitled";
    const exampleSlugs = uniqueSlugs(spec.examples.map((example) => example.name));
    const examples: Example[] = spec.examples.map((example, exampleIndex) => {
      const slug = exampleSlugs[exampleIndex] ?? "untitled";
      return {
        key: exampleKey(featureSlug, ruleSlug, slug),
        slug,
        name: example.name,
        description: "",
        tags: example.tags ?? [],
        steps: example.steps,
        hash: fakeHash(`${example.name}\n${example.steps.map((s) => `${s.keyword} ${s.text}`).join("\n")}`),
        line: 10 + ruleIndex * 10 + exampleIndex * 4,
        novelty: example.novelty,
      };
    });
    return {
      key: ruleKey(featureSlug, ruleSlug),
      slug: ruleSlug,
      name: spec.name,
      description: spec.description ?? "",
      tags: [],
      background: [],
      examples,
      line: 8 + ruleIndex * 10,
      novelty: aggregate(examples.map((example) => example.novelty)),
    };
  });
  return {
    slug: featureSlug,
    path,
    name,
    description,
    tags: [],
    background: steps("Given the factory keeps its jobs in a new, empty folder"),
    rules,
    novelty: aggregate(rules.flatMap((rule) => rule.examples.map((example) => example.novelty))),
  };
}

function suggestedOrder(features: FeatureFile[]): string[] {
  const rules = features.flatMap((f) => f.rules);
  return [
    ...rules.filter((rule) => rule.novelty !== "unchanged"),
    ...rules.filter((rule) => rule.novelty === "unchanged"),
  ].map((rule) => rule.key);
}

function lesson(fields: Omit<Lesson, "suggestedRuleOrder">): Lesson {
  return { ...fields, suggestedRuleOrder: suggestedOrder(fields.features) };
}

const seedBecomesPlan: ExampleSpec = {
  name: "A seed becomes a plan",
  steps: steps("Given a job with no plan", "When the factory runs", "Then the job has a plan"),
  novelty: "new",
};

const lesson0 = lesson({
  id: BUILTIN_LESSON_ID,
  title: "Using your tutor",
  set: "Start here",
  dir: "/usr/local/share/tutor/plugin/server/course/lesson-0",
  builtin: true,
  readme: "# Lesson 0 — Using your tutor\n\nLearn the course outline by using it.\n",
  dek: "Learn the course outline by using it.",
  factoryMd: "",
  seedSpec: null,
  features: [
    feature("features/tutor.feature", "Your tutor", "How the course outline and your coach work together.", [
      {
        name: "The outline shows where you are",
        examples: [
          {
            name: "The rule in focus is marked",
            steps: steps("Given the coach has moved to a rule", "Then the outline marks that rule"),
            novelty: "new",
          },
          {
            name: "A side chat appears under its rule",
            steps: steps("When you open a side chat about a rule", "Then it appears under that rule"),
            novelty: "new",
          },
        ],
      },
    ]),
  ],
  factoryDiff: null,
});

const lesson1 = lesson({
  id: "001",
  title: "Basic unvalidated loop",
  set: "Day 1",
  dir: `${FIXTURE_COURSE_ROOT}/docs/iterations/001-basic-unvalidated-loop`,
  builtin: false,
  readme: "# Homework 1 — Basic unvalidated loop\n\n*Set after day 1.*\n\nA factory that turns a seed into a plan.\n",
  dek: "A factory that turns a seed into a plan.",
  factoryMd: "# The factory\n\nA planner writes a plan from the seed.\n",
  seedSpec: "# Tetris\n\nA small Tetris.\n",
  features: [
    feature("features/planning.feature", "Planning", "The planner turns a seed into a plan.", [
      {
        name: "The planner writes a plan",
        examples: [
          seedBecomesPlan,
          {
            name: "An existing plan is kept",
            steps: steps("Given a job with a plan", "When the factory runs", "Then the plan is unchanged"),
            novelty: "new",
          },
        ],
      },
    ]),
  ],
  factoryDiff: null,
});

const lesson2 = lesson({
  id: "002",
  title: "Checking the work",
  set: "Day 2",
  dir: `${FIXTURE_COURSE_ROOT}/docs/iterations/002-checking-the-work`,
  builtin: false,
  readme: "# Homework 2 — Checking the work\n\n*Set after day 2.*\n\nA validator checks each attempt.\n",
  dek: "A validator checks each attempt.",
  factoryMd: "# The factory\n\nA planner writes a plan from the seed.\nA validator checks each attempt.\n",
  seedSpec: null,
  features: [
    feature("features/planning.feature", "Planning", "The planner turns a seed into a plan.", [
      {
        name: "The planner writes a plan",
        examples: [
          { ...seedBecomesPlan, novelty: "unchanged" },
          {
            name: "An existing plan is kept",
            steps: steps("Given a job with a plan", "When the factory runs again", "Then the plan is unchanged"),
            novelty: "reworded",
          },
        ],
      },
    ]),
    feature("features/validation.feature", "Validation", "A validator decides whether a task is finished.", [
      {
        name: "A task is finished when validation is satisfied",
        description: "The doer's work only counts once the validator is satisfied.",
        examples: [
          {
            name: "The work is right first time",
            steps: steps("Given a validator that is satisfied", "When the doer finishes its attempt", "Then the task is finished"),
            novelty: "new",
          },
          {
            name: "The work is wrong first time",
            steps: steps(
              "Given a validator that is not satisfied at first",
              "When the doer finishes its attempt",
              'Then the doer tries again with "the validator\'s report"',
            ),
            novelty: "new",
          },
        ],
      },
      {
        name: "Validation is what the validator's agent decided",
        examples: [
          {
            name: "A stand-in that is never satisfied",
            steps: steps("Given a validator configured with the never-satisfied stand-in", "When the factory runs", "Then the doer has made three attempts"),
            novelty: "new",
            tags: ["real-agent"],
          },
        ],
      },
    ]),
  ],
  factoryDiff: [
    { kind: "ctx", text: "# The factory" },
    { kind: "ctx", text: "" },
    { kind: "ctx", text: "A planner writes a plan from the seed." },
    { kind: "add", text: "A validator checks each attempt." },
  ],
});

const lesson3 = lesson({
  id: "003",
  title: "The assembly line",
  set: "Day 3",
  dir: `${FIXTURE_COURSE_ROOT}/docs/iterations/003-assembly-line`,
  builtin: false,
  readme: "# Homework 3 — The assembly line\n\n*Set after day 3.*\n\nThe route comes out into an assembly line.\n",
  dek: "The route comes out into an assembly line.",
  factoryMd: "# The factory\n\nAn assembly line says what runs next.\n",
  seedSpec: null,
  features: [
    feature("features/assembly-line.feature", "Assembly line", "The route is a graph the factory reads.", [
      {
        name: "The factory refuses an assembly line naming a machine it does not have",
        examples: [
          {
            name: "A misspelt validator",
            steps: steps(
              'Given "validator" is misspelt "validater" throughout the assembly line',
              "When the factory reads the assembly line",
              "Then it refuses it",
            ),
            novelty: "new",
          },
        ],
      },
    ]),
  ],
  factoryDiff: [
    { kind: "ctx", text: "# The factory" },
    { kind: "ctx", text: "" },
    { kind: "del", text: "A validator checks each attempt." },
    { kind: "add", text: "An assembly line says what runs next." },
  ],
});

export const fixtureLexicon: LexiconEntry[] = [
  {
    id: "doer",
    term: "Doer",
    definition:
      "The machine that attempts a task: it takes the plan's next task and the seed, drives a coding agent, and leaves its work in the target.",
  },
  {
    id: "assembly-line",
    term: "Assembly line",
    definition: "An ordered sequence of *machines*, arranged as a directed graph.",
  },
];

export const fixtureCourse: Course = {
  id: "software-factory",
  title: "Build a software factory",
  description: "Seven lessons, one factory.",
  root: FIXTURE_COURSE_ROOT,
  coachPath: `${FIXTURE_COURSE_ROOT}/.agents/coach-me.md`,
  lessons: [lesson0, lesson1, lesson2, lesson3],
  lexicon: fixtureLexicon,
  source: "ledger",
};

function examplesOf(lessonId: string): Example[] {
  const found = fixtureCourse.lessons.find((h) => h.id === lessonId);
  if (found === undefined) throw new Error(`fixture lesson ${lessonId} missing`);
  return lessonExamples(found);
}

function progressFor(example: Example | undefined, entry: Omit<ExampleProgress, "hash">): [string, ExampleProgress] {
  if (example === undefined) throw new Error("fixture example missing");
  return [example.key, { ...entry, hash: example.hash }];
}

const [planFromSeed, , rightFirstTime, wrongFirstTime] = examplesOf("002");
const focusRule = lesson2.features[1]?.rules[0]?.key ?? null;

/** Mid-way through lesson 002: one carried over, one passing, one not yet. */
export const fixtureStudent: StudentState = {
  iteration: { iteration: "002", status: "WIP" },
  progress: {
    iteration: "002",
    focus: focusRule,
    adopted: "2026-09-23T09:00:00Z",
    examples: Object.fromEntries([
      progressFor(planFromSeed, {
        status: "passing",
        evidence: "$ ./factory --job t --seed seeds/tetris.md\nplan written: 4 tasks",
        at: "2026-09-22T15:00:00Z",
        carriedFrom: "001",
      }),
      progressFor(rightFirstTime, {
        status: "passing",
        evidence: "$ ./factory --job t --agent stand-ins/always-satisfied\nvalidator: satisfied (attempt 1/3)",
        at: "2026-09-25T09:58:00Z",
      }),
      progressFor(wrongFirstTime, {
        status: "not-yet",
        note: "Crashed in the doer loop instead of retrying when the validator said no.",
        at: FIXTURE_NOW,
      }),
    ]),
  },
  problems: [],
};

/** A factory repo nobody has coached yet. */
export const fixtureFreshStudent: StudentState = { iteration: null, progress: null, problems: [] };

export const fixtureFactoryProject: FactoryProject = {
  status: "found",
  projectId: "prj_factory",
  projectName: "my-factory",
  root: FIXTURE_FACTORY_ROOT,
};

export const fixtureThreads: TutorThread[] = [
  { id: "thr_coach002", lessonId: "002", role: "coach", ruleKey: null, title: coachThreadTitle("002"), coachThreadId: "thr_coach002", fork: false },
  {
    id: "thr_side002",
    lessonId: "002",
    role: "sideChat",
    ruleKey: fixtureStudent.progress?.focus ?? null,
    title: "Why does the validator see the diff?",
    coachThreadId: "thr_coach002",
    fork: false,
  },
  { id: "thr_coach001", lessonId: "001", role: "coach", ruleKey: null, title: coachThreadTitle("001"), coachThreadId: "thr_coach001", fork: false },
];

/** The Rules the Lesson 002 coach thread has focused: its sections can be jumped to. */
export const fixtureReachedRules: string[] = [fixtureStudent.progress?.focus].filter((key): key is string => typeof key === "string");

interface OutlineInput {
  progress: Readonly<Record<string, ExampleProgress>>;
  focus: string | null;
  reached: readonly string[];
}

const NOTHING_RECORDED: OutlineInput = { progress: {}, focus: null, reached: [] };

/** Lesson 002 is the one under way; the others have nothing recorded. */
function recorded(lessonId: string): OutlineInput {
  if (lessonId !== "002") return NOTHING_RECORDED;
  return { progress: fixtureStudent.progress?.examples ?? {}, focus: fixtureStudent.progress?.focus ?? null, reached: fixtureReachedRules };
}

function outline(lessonId: string, { progress, focus, reached }: OutlineInput = recorded(lessonId)): FeatureOutline[] {
  const hw = fixtureCourse.lessons.find((h) => h.id === lessonId);
  return (hw?.features ?? []).map((f) => ({
    slug: f.slug,
    name: f.name,
    path: f.path,
    novelty: f.novelty,
    counts: countExamples(
      f.rules.flatMap((rule) => rule.examples),
      progress,
    ),
    rules: f.rules.map((rule) => ({
      key: rule.key,
      name: rule.name,
      novelty: rule.novelty,
      status: ruleStatus(rule, progress),
      isFocus: rule.key === focus,
      counts: countExamples(rule.examples, progress),
      lastAt:
        rule.examples
          .map((example) => progress[example.key]?.at)
          .filter((at): at is string => at !== undefined)
          .sort()
          .at(-1) ?? null,
      reached: reached.includes(rule.key),
    })),
  }));
}

const coachByLesson: Readonly<Record<string, string>> = { "001": "thr_coach001", "002": "thr_coach002" };

const statusByLesson = { "000": "done", "001": "done", "002": "current", "003": "ahead" } as const;

export const fixtureOverview: Overview = {
  course: { id: fixtureCourse.id, title: fixtureCourse.title, description: fixtureCourse.description },
  courseError: null,
  factoryProject: fixtureFactoryProject,
  lessons: fixtureCourse.lessons.map((hw) => ({
    id: hw.id,
    title: hw.title,
    set: hw.set,
    builtin: hw.builtin,
    status: statusByLesson[hw.id as keyof typeof statusByLesson],
    counts: countExamples(lessonExamples(hw), hw.id === "002" ? (fixtureStudent.progress?.examples ?? {}) : {}),
    coachThreadId: coachByLesson[hw.id] ?? null,
    outline: outline(hw.id),
  })),
  current: {
    lessonId: "002",
    iterationStatus: "WIP",
    focus: fixtureStudent.progress?.focus ?? null,
    focusRuleName: "A task is finished when validation is satisfied",
    counts: countExamples(examplesOf("002"), fixtureStudent.progress?.examples ?? {}),
    outline: outline("002"),
    coachThreadId: "thr_coach002",
    lastNote:
      wrongFirstTime === undefined
        ? null
        : {
            exampleKey: wrongFirstTime.key,
            exampleName: wrongFirstTime.name,
            note: "Crashed in the doer loop instead of retrying when the validator said no.",
            at: FIXTURE_NOW,
          },
  },
  threads: fixtureThreads,
};

/** First run: course loaded, no factory project yet. */
export const fixtureOverviewNoFactory: Overview = {
  ...fixtureOverview,
  factoryProject: { status: "unset" },
  lessons: fixtureOverview.lessons.map((hw) => ({
    ...hw,
    status: hw.id === BUILTIN_LESSON_ID ? "current" : "ahead",
    counts: countExamples(examplesOf(hw.id), {}),
    coachThreadId: null,
    outline: outline(hw.id, NOTHING_RECORDED),
  })),
  current: null,
  threads: [],
};

export const fixtureLessonDetail: LessonDetail = {
  lesson: lesson2,
  status: "current",
  iterationStatus: "WIP",
  focus: fixtureStudent.progress?.focus ?? null,
  progress: fixtureStudent.progress?.examples ?? {},
  coachThreadId: "thr_coach002",
  reachedRules: fixtureReachedRules,
};

export const fixtureCompletion: Completion = {
  lesson: { id: "001", title: lesson1.title, set: lesson1.set },
  counts: { total: 2, passing: 2, notYet: 0, skipped: 0, pending: 0, fresh: 2 },
  freshRules: 1,
  sideChats: 0,
  adoptedAt: "2026-09-22T09:00:00Z",
  summary: "Your factory turns a seed into a plan and keeps a plan it already has.",
  next: {
    id: "002",
    status: "ahead",
    title: lesson2.title,
    set: lesson2.set,
    dek: lesson2.dek,
    rules: 3,
    examples: 5,
    carryOver: 1,
    fresh: 4,
    factoryDiff: lesson2.factoryDiff,
  },
};

export const fixtureCandidates: CandidateProject[] = [
  {
    projectId: "prj_factory",
    name: "my-factory",
    root: FIXTURE_FACTORY_ROOT,
    qualifies: true,
    detail: "spec/ITERATION · 002 WIP",
  },
  { projectId: "prj_tutorial", name: "tutorial", root: FIXTURE_COURSE_ROOT, qualifies: false, detail: "the course itself" },
];
