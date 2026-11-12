import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("tab.json", "utf8"));
const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
assert.equal(result.status, 0);
const commit = result.stdout.trim();
if (process.env.GITHUB_SHA) assert.equal(commit, process.env.GITHUB_SHA);
const targets = Object.keys(manifest.backend.binary);
const qualifications = [];
const archives = [];
async function verifyArchive(name, expected) {
  const bytes = await readFile(`artifacts/${name}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256, expected.sha256, `Archive digest mismatch: ${name}`);
  assert.equal(bytes.length, expected.size, `Archive size mismatch: ${name}`);
  return { name, sha256, size: bytes.length };
}
for (const target of targets) {
  const proof = JSON.parse(await readFile(`artifacts/qualification-${target}.json`, "utf8"));
  assert.equal(proof.target, target);
  assert.equal(proof.version, manifest.version);
  assert.equal(proof.source_commit, commit);
  assert.equal(proof.cli.source_commit, "6fdc42cac06e6d327e04f509f7ec79733b5beb5f");
  for (const check of ["node", "go_race", "go_vet", "browser_real_lazygit", "extracted_backend_conformance"]) {
    assert.equal(proof.checks[check], true, `Missing ${check} qualification for ${target}`);
  }
  if (process.env.GITHUB_RUN_ID) {
    assert.equal(proof.run_url, `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`);
    assert.equal(proof.run_attempt, process.env.GITHUB_RUN_ATTEMPT);
    assert.equal(proof.source_ref, process.env.GITHUB_REF);
  }
  const name = `tab-backend-${target}.tar.gz`;
  assert.equal(proof.archive.archive, name);
  archives.push(await verifyArchive(name, proof.archive));
  qualifications.push(proof);
}
const web = JSON.parse(await readFile("artifacts/web-receipt.json", "utf8"));
archives.unshift(await verifyArchive("tab.tar.gz", web));
const receipt = {
  schema_version: 1, plugin_id: manifest.id, version: manifest.version,
  source: { repository: "https://github.com/edjubert/cadencr-plugin-lazygit", commit,
    tag: `v${manifest.version}` },
  workflow: ".github/workflows/native-release.yml",
  run_url: qualifications[0].run_url, archives, qualifications,
};
await writeFile("artifacts/build-receipt.json", `${JSON.stringify(receipt, null, 2)}\n`);
await writeFile("artifacts/SHA256SUMS", archives.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(""));
console.log(`Verified ${archives.length} archives and all ${targets.length} native qualifications.`);
