import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import { git } from "../../test/helpers/disk.ts";
import { fetchRepo } from "./fetch.ts";

/** A repo with one commit holding `hello.txt`, tagged v1; returns its file:// URL and the commit. */
async function makeRepo(t: TestContext): Promise<{ dir: string; url: string; sha: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tutor-fetch-src-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  git(dir, "init", "-q", "-b", "main");
  await writeFile(join(dir, "hello.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "one");
  git(dir, "tag", "v1");
  return { dir, url: pathToFileURL(dir).href, sha: git(dir, "rev-parse", "HEAD").trim() };
}

async function destDir(t: TestContext): Promise<string> {
  const top = await mkdtemp(join(tmpdir(), "tutor-fetch-dest-"));
  t.after(() => rm(top, { recursive: true, force: true }));
  return join(top, "course");
}

test("fetchRepo clones a local repo at a tag, and a second fetch at the same ref is a no-op", async (t) => {
  const repo = await makeRepo(t);
  const dest = await destDir(t);
  await fetchRepo(repo.url, "v1", dest);
  assert.equal(git(dest, "rev-parse", "HEAD").trim(), repo.sha);
  assert.equal(await readFile(join(dest, "hello.txt"), "utf8"), "one\n");
  const before = (await stat(join(dest, ".git/HEAD"))).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await fetchRepo(repo.url, "v1", dest);
  assert.equal((await stat(join(dest, ".git/HEAD"))).mtimeMs, before);
});

test("fetchRepo fetches a full SHA, and a second fetch at the same SHA is a no-op", async (t) => {
  const repo = await makeRepo(t);
  const dest = await destDir(t);
  await fetchRepo(repo.url, repo.sha, dest);
  assert.equal(git(dest, "rev-parse", "HEAD").trim(), repo.sha);
  assert.equal(await readFile(join(dest, "hello.txt"), "utf8"), "one\n");
  const before = (await stat(join(dest, ".git/HEAD"))).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await fetchRepo(repo.url, repo.sha, dest);
  assert.equal((await stat(join(dest, ".git/HEAD"))).mtimeMs, before);
});

test("fetchRepo replaces a clone at another ref", async (t) => {
  const repo = await makeRepo(t);
  const dest = await destDir(t);
  await fetchRepo(repo.url, "v1", dest);
  await writeFile(join(repo.dir, "hello.txt"), "two\n");
  git(repo.dir, "commit", "-q", "-am", "two");
  git(repo.dir, "tag", "v2");
  await fetchRepo(repo.url, "v2", dest);
  assert.equal(await readFile(join(dest, "hello.txt"), "utf8"), "two\n");
});

test("fetchRepo refuses a branch name, and a repo it can't reach leaves nothing behind", async (t) => {
  const repo = await makeRepo(t);
  const dest = await destDir(t);
  await assert.rejects(fetchRepo(repo.url, "main", dest), /tag or a full SHA/);
  await assert.rejects(fetchRepo(pathToFileURL(join(repo.dir, "gone")).href, "v1", dest), /Could not fetch/);
  await assert.rejects(stat(dest), { code: "ENOENT" });
});
