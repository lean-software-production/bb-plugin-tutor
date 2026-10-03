// scripts/release-standalone.test.ts: scripts/release-standalone.sh stamps
// TUTOR_VERSION into standalone/tutor and standalone/install.sh with an
// exact line replacement, and writes a SHA256SUMS that verifies.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function run(args: string[]) {
  return execFileSync("bash", ["scripts/release-standalone.sh", ...args], { encoding: "utf8", stdio: "pipe" });
}

test("release-standalone.sh fails without the plugin archive already in out-dir", () => {
  const out = mkdtempSync(join(tmpdir(), "release-standalone-"));
  try {
    assert.throws(() => run(["9.9.9", out]), { stderr: /bb-plugin-tutor-9\.9\.9\.tgz is missing/ });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("release-standalone.sh fails without the plugin's ready-to-install build already in out-dir", () => {
  const out = mkdtempSync(join(tmpdir(), "release-standalone-"));
  try {
    writeFileSync(join(out, "bb-plugin-tutor-9.9.9.tgz"), "fixture archive bytes\n");
    assert.throws(() => run(["9.9.9", out]), { stderr: /bb-plugin-tutor-9\.9\.9-built\.tgz is missing/ });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("release-standalone.sh stamps TUTOR_VERSION with an exact line replacement and writes a verifying SHA256SUMS", () => {
  const out = mkdtempSync(join(tmpdir(), "release-standalone-"));
  const version = "9.9.9";
  try {
    writeFileSync(join(out, `bb-plugin-tutor-${version}.tgz`), "fixture archive bytes\n");
    writeFileSync(join(out, `bb-plugin-tutor-${version}-built.tgz`), "fixture built archive bytes\n");

    run([version, out]);

    const tutor = readFileSync(join(out, "tutor"), "utf8");
    assert.match(tutor, new RegExp(`^TUTOR_VERSION=${version}$`, "m"));
    assert.doesNotMatch(tutor, /TUTOR_VERSION=0\.0\.0-dev/);
    // Everything else in the file is untouched by the stamp.
    const original = readFileSync("standalone/tutor", "utf8");
    assert.equal(tutor, original.replace("TUTOR_VERSION=0.0.0-dev", `TUTOR_VERSION=${version}`));

    const installSh = readFileSync(join(out, "install.sh"), "utf8");
    assert.match(installSh, new RegExp(`^TUTOR_VERSION=${version}$`, "m"));
    const originalInstall = readFileSync("standalone/install.sh", "utf8");
    assert.equal(installSh, originalInstall.replace("TUTOR_VERSION=0.0.0-dev", `TUTOR_VERSION=${version}`));

    const sums = readFileSync(join(out, "SHA256SUMS"), "utf8");
    for (const name of ["tutor", "install.sh", `bb-plugin-tutor-${version}.tgz`, `bb-plugin-tutor-${version}-built.tgz`]) {
      assert.ok(sums.includes(`  ${name}`), `SHA256SUMS should cover ${name}`);
    }

    execFileSync("bash", ["-c", "cd \"$1\" && sha256sum -c SHA256SUMS", "_", out], { stdio: "pipe" });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
