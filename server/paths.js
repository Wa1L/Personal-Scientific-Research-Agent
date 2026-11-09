// Where the app keeps its data. A packaged executable cannot assume its own
// folder is writable, so it uses the per-user application data directory.
import os from "node:os";
import path from "node:path";

export const PACKAGED = Boolean(globalThis.__ASSETS__);

function userDataDir() {
  const home = os.homedir();
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Research Agent");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Research Agent");
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "research-agent");
}

export const DATA_DIR = process.env.DATA_DIR || (PACKAGED ? userDataDir() : path.resolve("data"));
