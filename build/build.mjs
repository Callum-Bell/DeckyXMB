// Builds dist/index.js (the ES module Decky Loader imports) with esbuild.
// `--preview` also builds preview/out/preview.js for the browser preview.
import { build } from "esbuild";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pluginName = JSON.parse(readFileSync(resolve(root, "plugin.json"), "utf8")).name;
const shim = (f) => resolve(here, "shims", f);

// React, @decky/ui and @decky/api are provided by Steam / Decky at runtime.
const externals = {
  name: "decky-externals",
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: shim("react.js") }));
    b.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: shim("jsx-runtime.js") }));
    b.onResolve({ filter: /^@decky\/ui$/ }, () => ({ path: shim("decky-ui.js") }));
    b.onResolve({ filter: /^@decky\/api$/ }, () => ({ path: shim("decky-api.js") }));
  },
};

const common = {
  bundle: true,
  format: "esm",
  target: "chrome100",
  jsx: "automatic",
  define: { __PLUGIN_NAME__: JSON.stringify(pluginName) },
  plugins: [externals],
  logLevel: "info",
};

await build({ ...common, entryPoints: [resolve(root, "src/index.tsx")], outfile: resolve(root, "dist/index.js") });

if (process.argv.includes("--preview")) {
  await build({ ...common, entryPoints: [resolve(root, "preview/preview.tsx")], outfile: resolve(root, "preview/out/preview.js") });
}
