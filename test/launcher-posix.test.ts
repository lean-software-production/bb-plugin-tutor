// test/launcher-posix.test.ts: standalone/tutor is one POSIX sh file (no
// bashisms). CI installs shellcheck and always runs this; locally it skips
// with a clear message when shellcheck isn't on PATH (ruling L2 — replaces
// checkbashisms, which isn't available here; Ubuntu CI's /bin/sh is dash,
// which also catches bashisms at run time via `npx bats standalone/test`).
import { execFileSync } from "node:child_process";
import { test } from "node:test";

function hasShellcheck(): boolean {
  try {
    execFileSync("shellcheck", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("standalone/tutor passes shellcheck -s sh", (t) => {
  if (!hasShellcheck()) {
    t.skip("shellcheck is not on PATH; install it to run this check locally");
    return;
  }
  execFileSync("shellcheck", ["-s", "sh", "standalone/tutor"], { stdio: "inherit" });
});
