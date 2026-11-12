import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the standalone tab declares the Git replacement and native platforms", async () => {
  const tab = JSON.parse(await readFile(new URL("../tab.json", import.meta.url), "utf8"));
  assert.deepEqual(tab.tab.replaces, ["git"]);
  assert.deepEqual(Object.keys(tab.backend.binary), ["darwin-aarch64", "darwin-x86_64", "linux-x86_64"]);
  assert.equal(tab.configuration.find((setting) => setting.key === "sync_theme").default, true);
});
