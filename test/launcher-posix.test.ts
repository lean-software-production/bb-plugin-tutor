// test/launcher-posix.test.ts: standalone/tutor is one POSIX sh file (no
// bashisms). CI installs shellcheck and always runs this; locally it skips
// with a clear message when shellcheck isn't on PATH (ruling L2 — replaces
// checkbashisms, which isn't available here). CI's launcher job also runs
// `dash -n standalone/tutor` and `dash standalone/tutor help` directly under
// dash. Most of `npx bats standalone/test` sources the script into bats' own
// bash process (see standalone/test/helper.bash); standalone/test/
// subprocess.bats and install.bats run it as `sh`, which is dash on Ubuntu.
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

test("standalone/tutor and standalone/install.sh pass shellcheck -s sh", (t) => {
  if (!hasShellcheck()) {
    t.skip("shellcheck is not on PATH; install it to run this check locally");
    return;
  }
  execFileSync("shellcheck", ["-s", "sh", "standalone/tutor", "standalone/install.sh"], { stdio: "inherit" });
});
