import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = resolve(process.argv[2] ?? "staging/lazygit");
const manifest = JSON.parse(await readFile(`${root}/tab.json`, "utf8"));
if (basename(destination) !== manifest.id) {
  throw new Error(`The staged folder must be named ${manifest.id}, matching tab.json.`);
}
await mkdir(dirname(destination), { recursive: true });
// Refuse an existing destination before copying anything into it.
await mkdir(destination);
try {
  for (const entry of ["tab.json", "icon.svg", "dist", "bin"]) {
    await cp(`${root}/${entry}`, `${destination}/${entry}`, {
      recursive: true, force: false, errorOnExist: true,
    });
  }
} catch (error) {
  // Only remove the new directory created by this invocation.
  await rm(destination, { recursive: true, force: true });
  throw error;
}
console.log(`Local tab prepared at ${destination}`);
