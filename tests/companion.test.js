import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("loopback companion and provider protocol regressions", () => {
  const run = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    ["-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      timeout: 90000,
    },
  );
  if (run.error) throw run.error;
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
