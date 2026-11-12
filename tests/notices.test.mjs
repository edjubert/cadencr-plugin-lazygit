import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copyNotices } from "../scripts/notices.mjs";

test("dependency notices preserve license, attribution and patent text", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lazygit-notices-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"), destination = join(root, "notices");
  await mkdir(source);
  for (const file of ["LICENSE", "NOTICE.txt", "PATENTS", "README.md"]) {
    await writeFile(join(source, file), `Original ${file}\n`);
  }
  await copyNotices(source, destination);
  for (const file of ["LICENSE", "NOTICE.txt", "PATENTS"]) {
    assert.equal(await readFile(join(destination, file), "utf8"), `Original ${file}\n`);
  }
  await assert.rejects(readFile(join(destination, "README.md")), { code: "ENOENT" });
});

test("a Go installation without its root license uses the Homebrew fallback or fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "lazygit-go-notices-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "libexec"), destination = join(root, "notices");
  await mkdir(source);
  await writeFile(join(source, "PATENTS"), "Original patents\n");
  await assert.rejects(copyNotices(source, destination), /No distributable license/);
  const fallback = join(root, "LICENSE");
  await writeFile(fallback, "Original Go license\n");
  await copyNotices(source, destination, fallback);
  assert.equal(await readFile(join(destination, "LICENSE"), "utf8"), "Original Go license\n");
  assert.equal(await readFile(join(destination, "PATENTS"), "utf8"), "Original patents\n");
});
