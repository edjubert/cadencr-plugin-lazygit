import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function go(args) {
  const result = spawnSync("go", ["-C", join(root, "backend"), ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `go exited with ${result.status}`);
  return result.stdout.trim();
}

export async function copyNotices(source, destination, fallbackLicense) {
  const license = /^(licen[cs]e|copying)([._-].*)?$/i;
  const other = /^(notice|copyright|patents|authors|third[_-]party[_-]notices)([._-].*)?$/i;
  const entries = (await readdir(source, { withFileTypes: true })).filter((entry) =>
    (entry.isFile() || entry.isSymbolicLink()) && (license.test(entry.name) || other.test(entry.name)));
  const hasLicense = entries.some((entry) => license.test(entry.name));
  if (!hasLicense && !fallbackLicense) throw new Error(`No distributable license found in ${source}`);
  await mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const path = join(source, entry.name);
    if (!(await stat(path)).isFile()) throw new Error(`Notice must be a regular file: ${path}`);
    await writeFile(join(destination, entry.name), await readFile(path));
  }
  if (!hasLicense) {
    await writeFile(join(destination, "LICENSE"), await readFile(fallbackLicense));
  }
}

export async function notices(moduleIds = [], destination = join(root, "dist")) {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  // Vite's module-preload helper ships in the frontend. Include any bundled
  // transitive packages too, while excluding packages used only by tests.
  const packages = new Set([...Object.keys(manifest.dependencies), "vite"]);
  for (const id of moduleIds) {
    if (!id.includes("/node_modules/")) continue;
    const parts = id.split("/node_modules/").at(-1).split("/");
    packages.add(parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
  }
  const lines = [
    "# Third-party notices", "",
    "These notices accompany the compiled frontend and native terminal adapters.",
    "LazyGit is installed separately and is not bundled in this distribution.", "",
    "## Frontend", "",
  ];
  for (const name of [...packages].sort()) {
    const source = join(root, "node_modules", name);
    const dependency = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    await copyNotices(source, join(destination, "LICENSES", "npm", name));
    lines.push(`- \`${name}@${dependency.version}\`: ${dependency.license}; \`LICENSES/npm/${name}/\`.`);
  }
  lines.push("", "## Native terminal adapters", "");
  const modules = go(["list", "-mod=readonly", "-m", "-f",
    "{{if not .Main}}{{.Path}}\t{{.Version}}\t{{.Dir}}{{end}}", "all"]);
  for (const line of modules.split("\n").filter(Boolean)) {
    const [name, version, directory] = line.split("\t");
    await copyNotices(directory, join(destination, "LICENSES", "go", name));
    lines.push(`- \`${name}@${version}\`: \`LICENSES/go/${name}/\`.`);
  }
  const goroot = go(["env", "GOROOT"]);
  // Homebrew keeps Go's LICENSE beside libexec, outside GOROOT.
  await copyNotices(goroot, join(destination, "LICENSES", "go", "toolchain"), join(goroot, "..", "LICENSE"));
  for (const entry of await readdir(join(goroot, "src", "vendor", "golang.org", "x"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    await copyNotices(join(goroot, "src", "vendor", "golang.org", "x", entry.name),
      join(destination, "LICENSES", "go", "toolchain", "vendor", "golang.org", "x", entry.name));
  }
  lines.push(`- ${go(["version"])} and its vendored standard-library dependencies: \`LICENSES/go/toolchain/\`.`,
    "", "## Plugin", "", "- MIT; `LICENSES/plugin.txt`.", "");
  await writeFile(join(destination, "LICENSES", "plugin.txt"), await readFile(join(root, "LICENSE")));
  await writeFile(join(destination, "THIRD_PARTY_NOTICES.md"), lines.join("\n"));
}
