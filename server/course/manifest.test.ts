import { test } from "node:test";
import assert from "node:assert/strict";
import { CourseLoadError } from "../../shared/ports.ts";
import { parseCourseYaml } from "./manifest.ts";

const parse = (yaml: string) => parseCourseYaml(yaml, "/course", "course.yaml");

function throwsAt(yaml: string, message: RegExp): void {
  assert.throws(() => parse(yaml), (error: unknown) => error instanceof CourseLoadError && message.test(error.message));
}

test("course.yaml becomes a manifest with absolute paths and string ids", () => {
  const manifest = parse(`id: software-factory
title: Build a software factory
coach: .agents/coach-me.md
lexicon: docs/lexicon.yaml
homeworks:
  - { id: 001, title: Basic unvalidated loop, set: Day 1, dir: docs/iterations/001-basic }
  - { id: "010", title: Ten, dir: ten }
`);
  assert.deepEqual(manifest, {
    id: "software-factory",
    title: "Build a software factory",
    description: null,
    coachPath: "/course/.agents/coach-me.md",
    lexiconPath: "/course/docs/lexicon.yaml",
    homeworks: [
      { id: "001", title: "Basic unvalidated loop", set: "Day 1", dir: "/course/docs/iterations/001-basic" },
      { id: "010", title: "Ten", set: null, dir: "/course/ten" },
    ],
  });
});

test("coach and lexicon are optional", () => {
  const manifest = parse("id: x\ntitle: X\ndescription: '  About X. '\nhomeworks:\n  - { id: '001', title: One, dir: one }\n");
  assert.equal(manifest.coachPath, null);
  assert.equal(manifest.lexiconPath, null);
  assert.equal(manifest.description, "About X.");
});

test("a field that does not fit names its line", () => {
  throwsAt("id: x\ntitle: X\nhomeworks:\n  - { id: '1', title: One, dir: one }\n", /^Could not read course\.yaml, line 4: homeworks\.0\.id expected a three-digit homework id$/);
  throwsAt("id: x\nhomeworks:\n  - { id: '001', title: One, dir: one }\n", /^Could not read course\.yaml, line 1: title is missing$/);
  throwsAt("id: x\ntitle: X\nhomeworks: []\n", /line 3: homeworks should list at least one homework$/);
});

test("broken YAML names its line", () => {
  throwsAt("id: x\ntitle: X\nhomeworks:\n  - { id: '001', title: One\n", /^Could not read course\.yaml, line \d+: /);
});

test("paths may not leave the course folder", () => {
  throwsAt(
    "id: x\ntitle: X\nhomeworks:\n  - { id: '001', title: One, dir: one }\n  - { id: '002', title: Two, dir: ../elsewhere }\n",
    /^Could not read course\.yaml, line 5: \.\.\/elsewhere is outside the course folder\.$/,
  );
  throwsAt("id: x\ntitle: X\ncoach: /etc/passwd\nhomeworks:\n  - { id: '001', title: One, dir: one }\n", /line 3: \/etc\/passwd is outside/);
});
