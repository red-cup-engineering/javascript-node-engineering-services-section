import assert from "node:assert/strict";
import test from "node:test";
import { renamedPackages, underBaseNames } from "../scripts/ratchet-layer-imports.mjs";

test("a package renamed in its own directory keys its findings under its old name", () => {
  const base = { packages: { "@old/english": "lib/a/english", "@x/kept": "lib/x" } };
  const candidate = { packages: { "@new/english": "lib/a/english", "@x/kept": "lib/x", "@y/fresh": "lib/y" } };
  const renamed = renamedPackages(base, candidate);
  assert.deepEqual([...renamed], [["@new/english", "@old/english"]]);
  assert.equal(underBaseNames("@new/english/pragmatics", renamed), "@old/english/pragmatics");
  assert.equal(underBaseNames("@new/english", renamed), "@old/english");
  // A new package, or a name that merely shares a prefix, is not a rename.
  assert.equal(underBaseNames("@y/fresh", renamed), "@y/fresh");
  assert.equal(underBaseNames("@new/englishes", renamed), "@new/englishes");
});
