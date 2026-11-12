import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const cliSource = "6fdc42cac06e6d327e04f509f7ec79733b5beb5f";
const cli = process.env.CADENCR_CLI;
assert.ok(cli, "CADENCR_CLI must name a compatible CadencR CLI.");
assert.ok(process.env.CADENCR_LAZYGIT_SMOKE, "The real LazyGit smoke test is required.");
assert.ok(["darwin", "linux"].includes(process.platform));
assert.ok(["arm64", "x64"].includes(process.arch));
const target = `${process.platform}-${process.arch === "arm64" ? "aarch64" : "x86_64"}`;
assert.ok(["darwin-aarch64", "darwin-x86_64", "linux-x86_64"].includes(target));
if (process.env.EXPECTED_TARGET) assert.equal(target, process.env.EXPECTED_TARGET);

function run(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} ${args.join(" ")}:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}
const manifest = JSON.parse(await readFile("tab.json", "utf8"));
const sourceCommit = run("git", ["rev-parse", "HEAD"]);
assert.equal(run("git", ["status", "--porcelain"]), "", "Qualification requires a clean source checkout.");
if (process.env.GITHUB_SHA) assert.equal(sourceCommit, process.env.GITHUB_SHA);
if (process.env.GITHUB_REF?.startsWith("refs/tags/")) {
  assert.equal(process.env.GITHUB_REF, `refs/tags/v${manifest.version}`);
}
assert.equal(run(cli, ["--version"]), "cadencr 0.15.8");
if (process.env.CADENCR_SOURCE_COMMIT) assert.equal(process.env.CADENCR_SOURCE_COMMIT, cliSource);
await mkdir("artifacts", { recursive: true });
for (const [program, args] of [
  ["npm", ["test"]],
  ["npm", ["run", "test:backend"]],
  ["go", ["-C", "backend", "vet", "./..."]],
]) {
  console.log(run(program, args));
}
run("npm", ["run", "stage", "--", "staging/qualification/lazygit"]);
const archive = `tab-backend-${target}.tar.gz`;
const packed = JSON.parse(run(cli, ["registry", "pack-tab-backend",
  "--directory", "staging/qualification/lazygit", "--target", target,
  "--output", `artifacts/${archive}`]));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(digest(await readFile(`artifacts/${archive}`)), packed.sha256);

// Qualify the executable extracted from the exact archive that will be released.
const extracted = "staging/extracted/lazygit";
await mkdir(extracted, { recursive: true });
for (const entry of ["tab.json", "icon.svg", "dist"]) {
  await cp(`staging/qualification/lazygit/${entry}`, `${extracted}/${entry}`, { recursive: true });
}
run("tar", ["-xzf", resolve(`artifacts/${archive}`), "-C", extracted]);
const executable = await readFile(`${extracted}/${packed.cmd}`);
assert.equal(digest(executable), packed.executable_sha256);
assert.equal(executable.length, packed.executable_size);
const conformance = JSON.parse(run(cli, ["plugin", "validate", extracted, "--kind", "tab", "--json"]));
const executableInfo = run("go", ["version", "-m", `${extracted}/${packed.cmd}`]);
assert.ok(executableInfo.includes(`vcs.revision=${sourceCommit}`));
assert.ok(executableInfo.includes("vcs.modified=false"));
// Run browser tests against those same extracted bytes, including real LazyGit.
const smoke = spawnSync("npm", ["run", "test:ui"], {
  stdio: "inherit",
  env: { ...process.env, CADENCR_LAZYGIT_BACKEND: resolve(`${extracted}/${packed.cmd}`) },
});
if (smoke.error) throw smoke.error;
assert.equal(smoke.status, 0, "Browser tests of the extracted native backend must pass.");
const qualification = {
  schema_version: 1, version: manifest.version, source_commit: sourceCommit,
  source_ref: process.env.GITHUB_REF ?? "", target,
  run_url: process.env.GITHUB_RUN_ID
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  cli: { version: "0.15.8", source_commit: cliSource },
  runtime: { node: process.version, go: run("go", ["version"]),
    lazygit: run(process.env.CADENCR_LAZYGIT_SMOKE, ["--version"]) },
  checks: { node: true, go_race: true, go_vet: true, browser_real_lazygit: true,
    extracted_backend_conformance: true },
  archive: { ...packed, archive }, executable_info: executableInfo, conformance,
};
await writeFile(`artifacts/qualification-${target}.json`, `${JSON.stringify(qualification, null, 2)}\n`);
if (target === "linux-x86_64") {
  const webDirectory = "staging/web/lazygit";
  await mkdir(webDirectory, { recursive: true });
  for (const entry of ["tab.json", "icon.svg", "dist"]) {
    await cp(`staging/qualification/lazygit/${entry}`, `${webDirectory}/${entry}`, { recursive: true });
  }
  const web = JSON.parse(run(cli, ["registry", "pack-tab", "--directory", webDirectory,
    "--output", "artifacts/tab.tar.gz"]));
  await writeFile("artifacts/web-receipt.json", `${JSON.stringify(web, null, 2)}\n`);
}
console.log(`Qualified the exact ${target} release archive.`);
