import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProgressFile } from "../../shared/model.ts";
import { fakeHash } from "../../shared/fixtures.ts";
import { formatProgress, parseProgress } from "./progress-yaml.ts";

const hash = fakeHash("x");
const progress: ProgressFile = {
  iteration: "003",
  focus: "assembly-line/refuses-a-misspelt-machine",
  adopted: "2026-09-24T09:00:00Z",
  examples: {
    "orchestration/finished/wrong-first-time": {
      status: "passing",
      hash,
      evidence: "$ ./factory --job t\nvalidator: satisfied (attempt 2/3)\n",
      at: "2026-09-25T09:58:00Z",
      carriedFrom: "002",
    },
    "assembly-line/refuses-a-misspelt-machine/a-misspelt-validator": {
      status: "not-yet",
      hash,
      note: "Crashed in the doer loop.",
      at: "2026-09-25T10:12:00Z",
    },
  },
};

test("writes quoted ids, a stable key order and sorted Examples", () => {
  const text = formatProgress(progress, null);
  assert.match(text, /^iteration: "003"\nfocus: assembly-line\/refuses-a-misspelt-machine\nadopted: /);
  assert.match(text, /carriedFrom: "002"/);
  const keys = [...text.matchAll(/^ {2}(\S+):$/gm)].map((match) => match[1]);
  assert.deepEqual(keys, [
    "assembly-line/refuses-a-misspelt-machine/a-misspelt-validator",
    "orchestration/finished/wrong-first-time",
  ]);
  assert.match(text, /status: not-yet\n {4}hash: .*\n {4}note: Crashed/);
  assert.match(text, /evidence: \|/);
});

test("round-trips through parse", () => {
  assert.deepEqual(parseProgress(formatProgress(progress, null)), { progress, problems: [] });
});

test("keeps keys it does not know about", () => {
  const previous = [
    'iteration: "003"',
    "reviewer: ana",
    "examples:",
    "  orchestration/finished/wrong-first-time:",
    "    status: passing",
    `    hash: ${hash}`,
    "    at: 2026-09-25T09:58:00Z",
    "    ci: green",
  ].join("\n");
  const text = formatProgress(progress, previous);
  assert.match(text, /\nreviewer: ana\n?$/);
  assert.match(text, /carriedFrom: "002"\n {4}ci: green/);
});

const withHistory: ProgressFile = {
  ...progress,
  history: {
    "002": {
      adopted: "2026-09-23T09:00:00Z",
      summary: "It checks the work.",
      examples: { "orchestration/finished/wrong-first-time": { status: "passing", hash, at: "2026-09-23T10:00:00Z", carriedFrom: "001" } },
    },
    "000": { examples: {} },
  },
};

test("writes the history after the Examples, sorted by homework, with quoted ids", () => {
  const text = formatProgress(withHistory, null);
  assert.match(text, /\nhistory:\n {2}"000":\n {4}examples: \{\}\n {2}"002":\n {4}adopted: .*\n {4}summary: It checks the work\.\n {4}examples:\n/);
  assert.match(text, /history:[\s\S]*carriedFrom: "001"/);
  assert.deepEqual(parseProgress(text), { progress: withHistory, problems: [] });
});

test("a malformed history entry is dropped and reported; evidence in the history is not kept", () => {
  const text = [
    'iteration: "003"',
    "examples: {}",
    "history:",
    "  2:",
    "    examples:",
    "      a/b/c:",
    "        status: passing",
    `        hash: ${hash}`,
    "        evidence: $ ./factory",
    "        at: 2026-09-23T10:00:00Z",
    '  "001": nope',
  ].join("\n");
  const parsed = parseProgress(text);
  assert.deepEqual(parsed.progress?.history, {
    "002": { examples: { "a/b/c": { status: "passing", hash, at: "2026-09-23T10:00:00Z" } } },
  });
  assert.deepEqual(parsed.problems, ["spec/PROGRESS.yaml: the history entry for 001 is malformed and was ignored."]);
});

test("reads unquoted ids as ids", () => {
  const parsed = parseProgress("iteration: 003\nexamples: {}\n");
  assert.equal(parsed.progress?.iteration, "003");
});

test("never throws: bad entries are dropped and reported", () => {
  const parsed = parseProgress(
    [
      'iteration: "002"',
      "focus: Not A Key",
      "examples:",
      "  planning/writes/a-seed:",
      "    status: passing",
      `    hash: ${hash}`,
      "    at: 2026-09-25T09:58:00Z",
      "  planning/writes/broken:",
      "    status: maybe",
      "  not a key: {}",
    ].join("\n"),
  );
  assert.deepEqual(Object.keys(parsed.progress?.examples ?? {}), ["planning/writes/a-seed"]);
  assert.equal(parsed.progress?.focus, undefined);
  assert.equal(parsed.problems.length, 3);
});

test("unreadable files give no progress and one problem", () => {
  assert.equal(parseProgress("iteration: [").progress, null);
  assert.equal(parseProgress("- a list").problems.length, 1);
  assert.match(parseProgress("examples: {}").problems[0] ?? "", /no valid iteration/);
});
