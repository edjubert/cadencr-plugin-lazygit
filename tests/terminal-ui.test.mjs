import assert from "node:assert/strict";
import { realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { host } from "./terminal-host.mjs";

async function until(check) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out waiting for LazyGit.");
}

async function browser(t, fixture, viewport = { width: 1200, height: 800 }) {
  const instance = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  fixture.setBrowser(instance);
  const page = await instance.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await fixture.attach(page);
  await page.goto(fixture.address);
  return page;
}

test("direct LazyGit starts in the worktree, survives reload, receives input and restarts after exit", {
  timeout: 30_000,
}, async (t) => {
  const fixture = await host(t);
  const page = await browser(t, fixture);
  await until(async () => (await fixture.records()).some((record) => record.type === "boot"));
  const boot = (await fixture.records()).find((record) => record.type === "boot");
  assert.equal(boot.cwd, await realpath(fixture.worktree));
  assert.equal(boot.args[0], "--use-config-file");
  assert.match(boot.args[1], /config\/config\.yml,.*cadencr-theme\.yml$/);
  const resizes = (await fixture.records()).filter((record) => record.type === "resize").length;
  await page.reload();
  await page.getByRole("status").filter({ hasText: "q exits" }).waitFor();
  await until(async () => (await fixture.records()).filter((record) => record.type === "resize").length > resizes);
  assert.equal((await fixture.records()).filter((record) => record.type === "boot").length, 1);
  await page.setViewportSize({ width: 900, height: 600 });
  await until(async () => {
    const sizes = (await fixture.records()).filter((record) => record.type === "resize");
    return sizes.at(-1).cols < sizes[0].cols && sizes.at(-1).rows < sizes[0].rows;
  });
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("ordered input");
  await page.keyboard.press("Enter");
  await until(async () => (await fixture.records()).some((record) => record.line === "ordered input"));
  assert.equal((await fixture.records()).filter((record) => record.line === "ordered input").length, 1);
  await page.keyboard.type("q");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Start LazyGit", exact: true }).click();
  await until(async () => (await fixture.records()).filter((record) => record.type === "boot").length === 2);
  assert.equal(await page.locator("#error").isVisible(), false);
});

test("live CSS theme colors are normalized and written without restarting LazyGit", {
  timeout: 30_000,
}, async (t) => {
  const fixture = await host(t);
  const page = await browser(t, fixture);
  await page.getByRole("status").filter({ hasText: "q exits" }).waitFor();
  await until(async () => (await fixture.records()).some((record) => record.type === "boot"));
  assert.match(await fixture.theme(), /#23b5d3/);
  await page.evaluate(() => window.fixtureTheme("rgb(24 120 80)"));
  await until(async () => (await fixture.theme()).includes("#187850"));
  assert.equal((await fixture.records()).filter((record) => record.type === "boot").length, 1);
  assert.equal(await page.locator("#error").isVisible(), false);
});

test("a theme change offers a reload that restarts LazyGit", {
  timeout: 30_000,
}, async (t) => {
  const fixture = await host(t);
  const page = await browser(t, fixture);
  await page.getByRole("status").filter({ hasText: "q exits" }).waitFor();
  await until(async () => (await fixture.records()).some((record) => record.type === "boot"));
  assert.equal(await page.locator("#reload").isVisible(), false);
  await page.evaluate(() => window.fixtureTheme("rgb(200 60 60)"));
  await page.getByRole("button", { name: "Reload LazyGit (theme changed)" }).click();
  await until(async () => (await fixture.records()).filter((record) => record.type === "boot").length === 2);
  assert.equal(await page.locator("#error").isVisible(), false);
});

test("theme synchronization can be disabled and a tiny guest refits when expanded", {
  timeout: 30_000,
}, async (t) => {
  const fixture = await host(t, { syncTheme: false });
  const page = await browser(t, fixture, { width: 100, height: 30 });
  await until(async () => (await fixture.records()).some((record) => record.type === "boot"));
  assert.deepEqual((await fixture.records()).find((record) => record.type === "boot").args, []);
  await assert.rejects(fixture.theme(), { code: "ENOENT" });
  await page.setViewportSize({ width: 1200, height: 800 });
  await until(async () => await page.locator(".xterm-rows").evaluate((element) => element.children.length > 2));
  assert.equal(await page.locator("#error").isVisible(), false);
});

test("a quota rejection resumes the same process and delivers queued input exactly once", {
  timeout: 30_000,
}, async (t) => {
  const fixture = await host(t);
  const page = await browser(t, fixture);
  await page.getByRole("status").filter({ hasText: "q exits" }).waitFor();
  const throttle = { code: "HOST_ERROR", message: "HTTP 429", details: { status: 429, retryAfterMs: 1000 } };
  fixture.failNext("terminal.read", throttle);
  await page.getByRole("status").filter({ hasText: "Resuming LazyGit automatically" }).waitFor();
  fixture.failNext("terminal.input", throttle);
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("once after quota");
  await page.keyboard.press("Enter");
  await until(async () => (await fixture.records()).some((record) => record.line === "once after quota"));
  assert.equal((await fixture.records()).filter((record) => record.line === "once after quota").length, 1);
  assert.equal((await fixture.records()).filter((record) => record.type === "boot").length, 1);
  assert.equal(await page.locator("#error").isVisible(), false);
  const attempts = fixture.attempts();
  for (const rejected of attempts.filter((attempt) => attempt.rejected)) {
    assert.equal(attempts.filter((attempt) => attempt.at - rejected.at > 50 && attempt.at - rejected.at < 950).length, 0);
  }
});

test("other failures remain visible and do not replay requests", { timeout: 30_000 }, async (t) => {
  const fixture = await host(t);
  const page = await browser(t, fixture);
  await page.getByRole("status").filter({ hasText: "q exits" }).waitFor();
  fixture.failNext("terminal.read", { code: "BAD_REQUEST", message: "Fixture invalid request" });
  await page.getByRole("alert").filter({ hasText: "Fixture invalid request" }).waitFor();
  const count = fixture.attempts().length;
  await page.waitForTimeout(500);
  assert.equal(fixture.attempts().length, count);
});

test("the installed LazyGit renders in a real browser and accepts quit", {
  timeout: 30_000, skip: !process.env.CADENCR_LAZYGIT_SMOKE,
}, async (t) => {
  const fixture = await host(t, { executable: process.env.CADENCR_LAZYGIT_SMOKE });
  await writeFile(join(fixture.worktree, "conversation-only.txt"), "Disposable worktree fixture.\n");
  const page = await browser(t, fixture);
  await until(() => /Files|Local branches|Commits/.test(fixture.transcript()));
  assert.equal(await page.locator("#error").isVisible(), false);
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Enter");
  await until(() => fixture.transcript().includes("38;2;35;181;211"));
  await until(() => fixture.transcript().includes("conversation-only.txt"));
  if (process.env.CADENCR_LAZYGIT_SCREENSHOT) {
    await page.screenshot({ path: process.env.CADENCR_LAZYGIT_SCREENSHOT });
  }
  await page.keyboard.press("q");
  await page.getByRole("button", { name: "Start LazyGit", exact: true }).waitFor();
});
