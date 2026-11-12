import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function host(t, options = {}) {
  const state = await mkdtemp(join(tmpdir(), "cadencr-lazygit-ui-"));
  const worktree = join(state, "worktree");
  const config = join(state, "config");
  const pluginState = join(state, "plugins", "tab-state", "lazygit");
  const records = join(state, "records.jsonl");
  const settings = join(state, "settings", "settings.json");
  const alacritty = join(state, ".config", "alacritty", "alacritty.toml");
  const executable = options.executable ?? join(state, "fixture-lazygit");
  for (const directory of [worktree, config, pluginState, join(state, "settings"), join(state, ".config", "alacritty")]) {
    await mkdir(directory, { recursive: true });
  }
  const init = spawnSync("git", ["init", "-q", worktree], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(init.stderr);
  await writeFile(settings, JSON.stringify({ mono_font_family: "monospace" }));
  await writeFile(alacritty, "[font]\nsize = 13\n");
  await writeFile(join(config, "config.yml"), "gui:\n  mouseEvents: false\n");
  if (!options.executable) {
    await writeFile(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
if (process.argv[2] === "-cd") {
  console.log(process.env.CADENCR_FIXTURE_CONFIG);
} else {
  function record(value) {
    fs.appendFileSync(process.env.CADENCR_FIXTURE_RECORDS, JSON.stringify(value) + "\\n");
  }
  record({ type: "boot", pid: process.pid, cwd: process.cwd(), args: process.argv.slice(2) });
  process.stdout.write("\\x1b[2J\\x1b[HLazyGit fixture ready\\r\\n");
  process.on("SIGWINCH", () => record({ type: "resize", cols: process.stdout.columns, rows: process.stdout.rows }));
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    record({ type: "input", line });
    process.stdout.write("PROCESSED " + line + "\\r\\n");
    if (line === "q") process.exit(0);
  });
}
`, { mode: 0o700 });
  }
  const platform = process.platform === "darwin"
    ? `darwin-${process.arch === "arm64" ? "aarch64" : "x86_64"}` : "linux-x86_64";
  const child = spawn(`${root}/bin/${platform}/lazygit`, [], {
    cwd: root,
    env: {
      ...process.env,
      HOME: state,
      XDG_CONFIG_HOME: config, XDG_DATA_HOME: join(state, "data"),
      XDG_CACHE_HOME: join(state, "cache"), XDG_STATE_HOME: join(state, "state"),
      LG_CONFIG_FILE: "", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
      CADENCR_FIXTURE_CONFIG: config, CADENCR_FIXTURE_RECORDS: records,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let next = 0, transcript = "", logs = "";
  let ready;
  const pending = new Map(), attempts = [], failures = new Map();
  const lines = createInterface({ input: child.stdout });
  const handshake = new Promise((resolve, reject) => {
    ready = resolve;
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Backend exited (${code}): ${logs}`)));
  });
  child.stderr.on("data", (data) => { logs += data; });
  lines.on("line", (line) => {
    const value = JSON.parse(line);
    if (value.type === "ready") ready();
    else {
      pending.get(value.id)?.(value);
      pending.delete(value.id);
    }
  });
  const call = async (method, params) => {
    const id = String(++next);
    const response = new Promise((resolve) => pending.set(id, resolve));
    child.stdin.write(JSON.stringify({ type: "request", id, method, params }) + "\n");
    const value = await response;
    if (method === "terminal.read" && value.result?.data) {
      transcript += Buffer.from(value.result.data, "base64").toString("utf8");
    }
    return value;
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/backend") {
        let body = "";
        for await (const part of request) body += part;
        const { method, params } = JSON.parse(body);
        const attempt = { method, at: Date.now(), rejected: false };
        attempts.push(attempt);
        const failure = failures.get(method)?.shift();
        response.setHeader("Content-Type", "application/json");
        if (failure) {
          attempt.rejected = true;
          response.end(JSON.stringify({ transportError: failure }));
        } else {
          response.end(JSON.stringify(await call(method, params)));
        }
      } else {
        const path = request.url === "/" ? "index.html" : request.url.slice(1);
        if (!/^(index\.html|assets\/[a-zA-Z0-9_.-]+)$/.test(path)) {
          response.writeHead(404).end();
          return;
        }
        response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript"
          : path.endsWith(".css") ? "text/css" : "text/html");
        response.end(await readFile(join(root, "dist", path)));
      }
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  let browser;
  t.after(async () => {
    await browser?.close();
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.stdin.end();
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timeout);
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(state, { recursive: true, force: true });
  });
  child.stdin.write(JSON.stringify({
    type: "hello", protocol: 1, worktree, state_dir: pluginState, feature_id: 1,
  }) + "\n");
  await Promise.race([handshake, new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Backend not ready: ${logs}`)), 5000).unref())]);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    address: `http://127.0.0.1:${server.address().port}`,
    worktree, call, transcript: () => transcript, attempts: () => [...attempts],
    theme: () => readFile(join(pluginState, "feature-1", "cadencr-theme.yml"), "utf8"),
    records: async () => {
      try { return (await readFile(records, "utf8")).trim().split("\n").map(JSON.parse); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    },
    failNext: (method, error) => {
      const queue = failures.get(method) ?? [];
      queue.push(error);
      failures.set(method, queue);
    },
    setBrowser: (value) => { browser = value; },
    // Match the public SDK's MessagePort protocol, including native backend calls.
    attach: async (page) => page.addInitScript(({ worktree, executable, syncTheme }) => {
      const channel = new MessageChannel();
      let theme = {
        id: "test", appearance: "dark",
        tokens: {
          background: "#101218", foreground: "#e2e4e9", "muted-foreground": "#9297a5",
          primary: "#23b5d3", secondary: "#272b35", "secondary-foreground": "#e2e4e9",
          border: "#424655", destructive: "#f38ba8", accent: "#343a49",
        },
      };
      window.fixtureTheme = (primary) => {
        theme = { ...theme, tokens: { ...theme.tokens, primary } };
        channel.port1.postMessage({ v: 1, kind: "event", event: "theme.changed", payload: { theme } });
      };
      channel.port1.onmessage = async ({ data }) => {
        let result;
        if (data.method === "hello") {
          result = {
            apiVersion: 1, instanceId: "test", plugin: { id: "lazygit", version: "0.1.0" },
            visible: true, capabilities: ["backend.request"],
            context: {
              project: { id: 1, name: "Fixture", path: worktree },
              feature: { id: 1, name: "Fixture", branch: null, baseBranch: null, worktreePath: worktree },
              session: null, pullRequest: null,
            },
            theme,
          };
        } else if (data.method === "config.get") result = { lazygit_path: executable, sync_theme: syncTheme };
        else if (data.method === "backend.request") {
          const answer = await fetch("/backend", {
            method: "POST", body: JSON.stringify({ method: data.params.method, params: data.params.params }),
          }).then((response) => response.json());
          if (answer.transportError) {
            channel.port1.postMessage({ v: 1, kind: "response", id: data.id, error: answer.transportError });
            return;
          }
          result = { result: answer.result, error: answer.error };
        } else throw new Error(`Unexpected SDK request: ${data.method}`);
        channel.port1.postMessage({ v: 1, kind: "response", id: data.id, result });
      };
      window.addEventListener("DOMContentLoaded", () => {
        window.postMessage({ type: "cadencr-tab:port" }, "*", [channel.port2]);
      });
    }, { worktree, executable, syncTheme: options.syncTheme !== false }),
  };
}
