// Packages the Decky install zip: release/DeckyXMB-<version>.zip
// (run `npm run package`, which builds first).
import { execFileSync } from "child_process";
import { cpSync, mkdirSync, readFileSync, rmSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const name = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8")).name;
const stage = join(root, "release", "pkg");
const pluginDir = join(stage, name);
const zip = join(root, "release", `${name}-${version}.zip`);

rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(join(pluginDir, "dist"), { recursive: true });
cpSync(join(root, "dist", "index.js"), join(pluginDir, "dist", "index.js"));
for (const f of ["plugin.json", "package.json", "main.py", "README.md", "LICENSE", "NOTICE"]) cpSync(join(root, f), join(pluginDir, f));
// Decky puts this on the Python path (without any bytecode a local run left behind)
cpSync(join(root, "py_modules"), join(pluginDir, "py_modules"), { recursive: true, filter: (src) => !/__pycache__|\.pyc$/.test(src) });

if (process.platform === "win32") {
  // Windows' bsdtar writes "/" separators (Compress-Archive writes "\", which breaks on the Deck).
  const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"); // not Git Bash's GNU tar
  execFileSync(tar, ["-a", "-c", "-f", zip, name], { cwd: stage, stdio: "inherit" });
} else {
  execFileSync("zip", ["-qr", zip, name], { cwd: stage, stdio: "inherit" });
}
rmSync(stage, { recursive: true, force: true });
console.log(zip);
