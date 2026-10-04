import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_CATALOG, catalogFrom, TUTORIAL_REF } from "./catalog.ts";

test("the built-in catalog pins a full SHA or a tag", () => {
  assert.match(TUTORIAL_REF, /^([0-9a-f]{40}|v\d+\.\d+\.\d+)$/);
  for (const entry of BUILT_IN_CATALOG) assert.equal(entry.ref, TUTORIAL_REF);
});

test("a catalog override must pin refs to tags or full SHAs", () => {
  assert.throws(() => catalogFrom(JSON.stringify([{ id: "c", title: "C", description: "", repo: "file:///x", ref: "main" }])), /tag or a full SHA/);
  assert.equal(catalogFrom(undefined), BUILT_IN_CATALOG);
});

test("an empty override is the built-in catalog; a valid one replaces it", () => {
  assert.equal(catalogFrom("  "), BUILT_IN_CATALOG);
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const entries = [
    { id: "c", title: "C", description: "A course.", repo: "file:///x", ref: "v1" },
    { id: "d", title: "D", description: "", repo: "file:///y", ref: sha },
  ];
  assert.deepEqual(catalogFrom(JSON.stringify(entries)), entries);
});

test("an override that isn't a catalog says what is wrong with it", () => {
  assert.throws(() => catalogFrom("{not json"), /courseCatalog/);
  assert.throws(() => catalogFrom(JSON.stringify({ id: "c" })), /courseCatalog/);
  assert.throws(() => catalogFrom(JSON.stringify([{ id: "../c", title: "C", description: "", repo: "file:///x", ref: "v1" }])), /courseCatalog/);
  const twice = { id: "c", title: "C", description: "", repo: "file:///x", ref: "v1" };
  assert.throws(() => catalogFrom(JSON.stringify([twice, twice])), /twice/);
});

test("a catalog override may name https:// or file:// repos only", () => {
  const entry = (repo: string) => JSON.stringify([{ id: "c", title: "C", description: "", repo, ref: "v1" }]);
  assert.equal(catalogFrom(entry("https://example.com/c.git"))[0]?.repo, "https://example.com/c.git");
  assert.equal(catalogFrom(entry("file:///srv/c"))[0]?.repo, "file:///srv/c");
  for (const repo of ["ssh://git@example.com/c.git", "git://example.com/c.git", "ext::sh -c x", "-uhttps://x", "/srv/c", "http://example.com/c.git"]) {
    assert.throws(() => catalogFrom(entry(repo)), /courseCatalog.*https:\/\/ or file:\/\//, repo);
  }
});
