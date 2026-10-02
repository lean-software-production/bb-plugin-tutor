// test/pins.test.ts: BB and the SDK move together (the host-entry API is experimental_).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const BB = "0.44.0";
const SDK = "0.5.29";

test("package.json, the lockfile and CI pin the same BB and SDK", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(pkg.engines.bb, `>=${BB}`);
  assert.equal(pkg.engines.bbPluginSdk, `>=${SDK}`);
  assert.equal(pkg.devDependencies["@get-bb/plugin-sdk"], SDK);
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  assert.equal(lock.packages["node_modules/@get-bb/plugin-sdk"].version, SDK);
  const ci = await readFile(".github/workflows/ci.yaml", "utf8");
  assert.match(ci, new RegExp(`BB_APP_VERSION: ${BB.replace(/\./g, "\\.")}\\b`));
});
