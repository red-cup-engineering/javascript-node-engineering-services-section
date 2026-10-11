import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { nodeFirstEnvironment } from "../src/environment.mjs";

test("puts the running Node.js first on PATH once and keeps the rest of the environment", () => {
  const own = path.dirname(process.execPath);
  const environment = nodeFirstEnvironment({ PATH: ["/usr/bin", own, "/bin"].join(path.delimiter), HOME: "/home/x" });
  assert.equal(environment.PATH, [own, "/usr/bin", "/bin"].join(path.delimiter));
  assert.equal(environment.HOME, "/home/x");
  assert.equal(nodeFirstEnvironment({}).PATH, own);
});
