// Builds a standalone executable for the current platform into dist/.
// The server and its dependencies are bundled into one file, the front end is
// embedded in it, and the result is injected into a copy of the Node.js binary
// (Node "single executable application"). No Node.js install is needed to run it.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const os = { win32: "windows", darwin: "macos", linux: "linux" }[process.platform];
const exe = `dist/research-agent-${version}-${os}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;

fs.rmSync("build", { recursive: true, force: true });
fs.mkdirSync("build");
fs.mkdirSync("dist", { recursive: true });

const assets = Object.fromEntries(fs.readdirSync("public").map((f) => [f, fs.readFileSync(path.join("public", f), "utf8")]));
await build({
  entryPoints: ["server/index.js"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: "build/server.cjs",
  banner: { js: `globalThis.__ASSETS__ = ${JSON.stringify(assets)};` },
  logOverride: { "empty-import-meta": "silent" },
});

fs.writeFileSync("build/sea.json", JSON.stringify({ main: "build/server.cjs", output: "build/sea.blob", disableExperimentalSEAWarning: true }));
run(process.execPath, ["--experimental-sea-config", "build/sea.json"]);

fs.copyFileSync(process.execPath, exe);
fs.chmodSync(exe, 0o755);
if (process.platform === "darwin") run("codesign", ["--remove-signature", exe]);
run("npx", ["postject", exe, "NODE_SEA_BLOB", "build/sea.blob", "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2", ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : [])]);
if (process.platform === "darwin") run("codesign", ["--sign", "-", exe]);

console.log(`\nBuilt ${exe} (${(fs.statSync(exe).size / 1e6).toFixed(0)} MB)`);
