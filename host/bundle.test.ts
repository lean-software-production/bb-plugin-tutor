import assert from "node:assert/strict";
import { lstat, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Bundle } from "../shared/bundle.ts";
import { writeBundle } from "./bundle.ts";

async function tempTarget(): Promise<string> {
  return mkdtemp(join(tmpdir(), "write-bundle-"));
}

test("writeBundle keeps the executable bit and writes links as links", async () => {
  const target = await tempTarget();
  try {
    const bundle: Bundle = {
      entries: [
        { kind: "file", path: "run.sh", executable: true, base64: Buffer.from("#!/bin/sh\necho hi\n", "utf8").toString("base64") },
        { kind: "file", path: "README.md", executable: false, base64: Buffer.from("# Hello\n", "utf8").toString("base64") },
        { kind: "symlink", path: "alias", target: "README.md" },
      ],
    };
    const result = await writeBundle(target, bundle, { onlyIfAbsent: false });

    assert.deepEqual(result.written.sort(), ["README.md", "alias", "run.sh"].sort());
    assert.equal(((await lstat(join(target, "run.sh"))).mode & 0o111) !== 0, true);
    assert.equal(((await lstat(join(target, "README.md"))).mode & 0o111) !== 0, false);
    assert.equal(await readlink(join(target, "alias")), "README.md");
    assert.equal(await readFile(join(target, "run.sh"), "utf8"), "#!/bin/sh\necho hi\n");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("writeBundle refuses the whole bundle when one entry escapes, and writes nothing", async () => {
  const target = await tempTarget();
  try {
    const bundle: Bundle = {
      entries: [
        { kind: "file", path: "ok.txt", executable: false, base64: Buffer.from("fine\n", "utf8").toString("base64") },
        { kind: "file", path: "../x", executable: false, base64: Buffer.from("bad\n", "utf8").toString("base64") },
      ],
    };
    await assert.rejects(writeBundle(target, bundle, { onlyIfAbsent: false }));
    assert.deepEqual(await readdir(target), []);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("writeBundle refuses to write through a link already in the target", async () => {
  const target = await tempTarget();
  const elsewhere = await mkdtemp(join(tmpdir(), "elsewhere-"));
  try {
    await symlink(elsewhere, join(target, "sub"));
    const bundle: Bundle = {
      entries: [{ kind: "file", path: "sub/file", executable: false, base64: Buffer.from("x", "utf8").toString("base64") }],
    };
    await assert.rejects(writeBundle(target, bundle, { onlyIfAbsent: false }));
    assert.deepEqual(await readdir(elsewhere), []);
  } finally {
    await rm(target, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("onlyIfAbsent: an identical file is 'same', a different one is 'kept' and untouched", async () => {
  const target = await tempTarget();
  try {
    await writeFile(join(target, "same.txt"), "unchanged\n");
    await writeFile(join(target, "different.txt"), "the student's own version\n");
    const bundle: Bundle = {
      entries: [
        { kind: "file", path: "same.txt", executable: false, base64: Buffer.from("unchanged\n", "utf8").toString("base64") },
        { kind: "file", path: "different.txt", executable: false, base64: Buffer.from("course version\n", "utf8").toString("base64") },
        { kind: "file", path: "new.txt", executable: false, base64: Buffer.from("brand new\n", "utf8").toString("base64") },
      ],
    };
    const result = await writeBundle(target, bundle, { onlyIfAbsent: true });

    assert.deepEqual(result.written, ["new.txt"]);
    assert.deepEqual(result.same, ["same.txt"]);
    assert.deepEqual(result.kept, ["different.txt"]);
    assert.equal(await readFile(join(target, "different.txt"), "utf8"), "the student's own version\n");
    assert.equal(await readFile(join(target, "same.txt"), "utf8"), "unchanged\n");
    assert.equal(await readFile(join(target, "new.txt"), "utf8"), "brand new\n");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("writeBundle refuses duplicate paths, writing nothing", async () => {
  const target = await tempTarget();
  try {
    const bundle: Bundle = {
      entries: [
        { kind: "file", path: "dup.txt", executable: false, base64: Buffer.from("one", "utf8").toString("base64") },
        { kind: "file", path: "dup.txt", executable: false, base64: Buffer.from("two", "utf8").toString("base64") },
      ],
    };
    await assert.rejects(writeBundle(target, bundle, { onlyIfAbsent: false }));
    assert.deepEqual(await readdir(target), []);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("writeBundle refuses an escaping symbolic link target, writing nothing", async () => {
  const target = await tempTarget();
  try {
    const bundle: Bundle = { entries: [{ kind: "symlink", path: "link", target: "../../outside" }] };
    await assert.rejects(writeBundle(target, bundle, { onlyIfAbsent: false }));
    assert.deepEqual(await readdir(target), []);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("writeBundle refuses a target that is not a real folder", async () => {
  const parent = await tempTarget();
  try {
    const notAFolder = join(parent, "missing");
    const bundle: Bundle = { entries: [] };
    await assert.rejects(writeBundle(notAFolder, bundle, { onlyIfAbsent: false }));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("writeBundle creates parent folders for nested paths", async () => {
  const target = await tempTarget();
  try {
    const bundle: Bundle = {
      entries: [{ kind: "file", path: "a/b/c.txt", executable: false, base64: Buffer.from("deep\n", "utf8").toString("base64") }],
    };
    const result = await writeBundle(target, bundle, { onlyIfAbsent: false });
    assert.deepEqual(result.written, ["a/b/c.txt"]);
    assert.equal(await readFile(join(target, "a/b/c.txt"), "utf8"), "deep\n");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("writeBundle refuses a bundle where one entry's path has another entry, a symbolic link, as a parent", async () => {
  const target = await tempTarget();
  try {
    const bundle: Bundle = {
      entries: [
        { kind: "symlink", path: "sub", target: "other" },
        { kind: "file", path: "sub/file.txt", executable: false, base64: Buffer.from("x", "utf8").toString("base64") },
      ],
    };
    await assert.rejects(writeBundle(target, bundle, { onlyIfAbsent: false }));
    assert.deepEqual(await readdir(target), []);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("writeBundle refuses a bundle where one entry's path has another entry, a plain file, as a parent, writing nothing", async () => {
  const target = await tempTarget();
  try {
    const bundle: Bundle = {
      entries: [
        { kind: "file", path: "a", executable: false, base64: Buffer.from("leaf\n", "utf8").toString("base64") },
        { kind: "file", path: "a/b", executable: false, base64: Buffer.from("under a file\n", "utf8").toString("base64") },
      ],
    };
    await assert.rejects(writeBundle(target, bundle, { onlyIfAbsent: false }));
    assert.deepEqual(await readdir(target), []);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("writeBundle never writes through a pre-existing leaf symbolic link: the link is replaced by a plain file, the thing it pointed at is untouched", async () => {
  const target = await tempTarget();
  const outside = await mkdtemp(join(tmpdir(), "outside-"));
  try {
    await writeFile(join(outside, "secret.txt"), "the student's secret\n");
    await symlink(join(outside, "secret.txt"), join(target, "alias.txt"));

    const bundle: Bundle = {
      entries: [{ kind: "file", path: "alias.txt", executable: false, base64: Buffer.from("course content\n", "utf8").toString("base64") }],
    };
    const result = await writeBundle(target, bundle, { onlyIfAbsent: false });

    assert.deepEqual(result.written, ["alias.txt"]);
    assert.equal((await lstat(join(target, "alias.txt"))).isSymbolicLink(), false);
    assert.equal(await readFile(join(target, "alias.txt"), "utf8"), "course content\n");
    assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "the student's secret\n");
  } finally {
    await rm(target, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("onlyIfAbsent never writes through, or reads through, a pre-existing leaf symbolic link: it is reported as kept and left exactly as it was", async () => {
  const target = await tempTarget();
  const outside = await mkdtemp(join(tmpdir(), "outside-"));
  try {
    await writeFile(join(outside, "secret.txt"), "the student's secret\n");
    await symlink(join(outside, "secret.txt"), join(target, "alias.txt"));

    const bundle: Bundle = {
      entries: [{ kind: "file", path: "alias.txt", executable: false, base64: Buffer.from("course content\n", "utf8").toString("base64") }],
    };
    const result = await writeBundle(target, bundle, { onlyIfAbsent: true });

    assert.deepEqual(result.kept, ["alias.txt"]);
    assert.deepEqual(result.written, []);
    assert.deepEqual(result.same, []);
    assert.equal((await lstat(join(target, "alias.txt"))).isSymbolicLink(), true);
    assert.equal(await readlink(join(target, "alias.txt")), join(outside, "secret.txt"));
    assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "the student's secret\n");
  } finally {
    await rm(target, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
