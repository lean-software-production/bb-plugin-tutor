import assert from "node:assert/strict";
import { test } from "node:test";
import { bundleBytes, escapingLink, unsafePath } from "./bundle.ts";

test("bundle paths must be relative and stay inside", () => {
  for (const bad of ["/etc/passwd", "../up", "a/../../b", "", "a//b", "./a", "a/\0"]) assert.notEqual(unsafePath(bad), null, bad);
  for (const good of ["README.md", "features/one.feature", ".agents/skills/x/SKILL.md"]) assert.equal(unsafePath(good), null, good);
});

test("links may point within the bundle only", () => {
  assert.equal(escapingLink("factory/.claude/skills", "../../.agents/skills"), null);
  assert.notEqual(escapingLink("a/link", "../../outside"), null);
  assert.notEqual(escapingLink("link", "/abs"), null);
});

test("bundleBytes counts the JSON that crosses the wire", () => {
  const bundle = { entries: [{ kind: "file" as const, path: "a", executable: false, base64: "aGk=" }] };
  assert.equal(bundleBytes(bundle), Buffer.byteLength(JSON.stringify(bundle), "utf8"));
  assert.ok(bundleBytes(bundle) > 0);
});
