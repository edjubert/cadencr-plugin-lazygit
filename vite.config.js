import { defineConfig } from "vite";
import { notices } from "./scripts/notices.mjs";

let moduleIds = [];

export default defineConfig({
  base: "./",
  plugins: [{
    name: "distribution-notices",
    generateBundle() { moduleIds = [...this.getModuleIds()]; },
    async closeBundle() { await notices(moduleIds); },
  }],
});
