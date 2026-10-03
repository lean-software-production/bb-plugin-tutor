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
lessons:
  - { id: 001, title: Basic unvalidated loop, set: Day 1, dir: docs/iterations/001-basic }
  - { id: "010", title: Ten, dir: ten }
`);
  assert.deepEqual(manifest, {
    id: "software-factory",
    title: "Build a software factory",
    description: null,
    layout: null,
    coachPath: "/course/.agents/coach-me.md",
    lexiconPath: "/course/docs/lexicon.yaml",
    starter: null,
    lessons: [
      { id: "001", title: "Basic unvalidated loop", set: "Day 1", dir: "/course/docs/iterations/001-basic" },
      { id: "010", title: "Ten", set: null, dir: "/course/ten" },
    ],
  });
});

test("coach and lexicon are optional", () => {
  const manifest = parse("id: x\ntitle: X\ndescription: '  About X. '\nlessons:\n  - { id: '001', title: One, dir: one }\n");
  assert.equal(manifest.coachPath, null);
  assert.equal(manifest.lexiconPath, null);
  assert.equal(manifest.description, "About X.");
});

test("a field that does not fit names its line", () => {
  throwsAt("id: x\ntitle: X\nlessons:\n  - { id: '1', title: One, dir: one }\n", /^Could not read course\.yaml, line 4: lessons\.0\.id expected a three-digit lesson id$/);
  throwsAt("id: x\nlessons:\n  - { id: '001', title: One, dir: one }\n", /^Could not read course\.yaml, line 1: title is missing$/);
  throwsAt("id: x\ntitle: X\nlessons: []\n", /line 3: lessons should list at least one lesson$/);
});

test("broken YAML names its line", () => {
  throwsAt("id: x\ntitle: X\nlessons:\n  - { id: '001', title: One\n", /^Could not read course\.yaml, line \d+: /);
});

test("paths may not leave the course folder", () => {
  throwsAt(
    "id: x\ntitle: X\nlessons:\n  - { id: '001', title: One, dir: one }\n  - { id: '002', title: Two, dir: ../elsewhere }\n",
    /^Could not read course\.yaml, line 5: \.\.\/elsewhere is outside the course folder\.$/,
  );
  throwsAt("id: x\ntitle: X\ncoach: /etc/passwd\nlessons:\n  - { id: '001', title: One, dir: one }\n", /line 3: \/etc\/passwd is outside/);
});

test("course.yaml may declare layout: capstone-factory, and nothing else", () => {
  const yaml = (layout: string) => `id: c\ntitle: C\nlayout: ${layout}\nlessons:\n  - { id: "001", title: One, dir: one }\n`;
  assert.equal(parseCourseYaml(yaml("capstone-factory"), "/c", "course.yaml").layout, "capstone-factory");
  assert.throws(() => parseCourseYaml(yaml("other"), "/c", "course.yaml"), /line 3: layout/);
  assert.equal(parseCourseYaml("id: c\ntitle: C\nlessons:\n  - { id: \"001\", title: One, dir: one }\n", "/c", "course.yaml").layout, null);
});

test("a starter names its repo at a tag or a full SHA, with optional top-level entries left out of the seed", () => {
  const lessons = "lessons:\n  - { id: '001', title: One, dir: one }\n";
  const manifest = parse(`id: x\ntitle: X\nstarter:\n  repo: https://example.com/starter.git\n  ref: v1.2.0\n  exclude: [docs]\n${lessons}`);
  assert.deepEqual(manifest.starter, { repo: "https://example.com/starter.git", ref: "v1.2.0", exclude: ["docs"] });
  const sha = "0123456789abcdef0123456789abcdef01234567";
  assert.deepEqual(parse(`id: x\ntitle: X\nstarter: { repo: file:///s, ref: ${sha} }\n${lessons}`).starter, { repo: "file:///s", ref: sha, exclude: [] });
  throwsAt(`id: x\ntitle: X\nstarter: { repo: file:///s, ref: main }\n${lessons}`, /line 3: starter\.ref should be a tag .* or a full SHA/);
});

test("a starter's repo is an https:// or file:// URL: ssh://, ext:: and option-like values are refused at load", () => {
  const lessons = "lessons:\n  - { id: '001', title: One, dir: one }\n";
  const yaml = (repo: string) => `id: x\ntitle: X\nstarter:\n  repo: ${JSON.stringify(repo)}\n  ref: v1\n${lessons}`;
  assert.equal(parse(yaml("file:///srv/starter")).starter?.repo, "file:///srv/starter");
  for (const repo of ["ssh://git@example.com/s.git", "ext::sh -c x", "-uhttps://x", "git@example.com:s.git"]) {
    throwsAt(yaml(repo), /starter\.repo should be an https:\/\/ or file:\/\/ URL/);
  }
});
