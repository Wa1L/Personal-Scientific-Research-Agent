// AI provider settings. Saved from the Settings screen to settings.json in the
// data folder; environment variables act as a fallback for headless setups.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.js";

const FILE = path.join(DATA_DIR, "settings.json");

// `kind` selects the wire protocol: Anthropic's Messages API, or the
// OpenAI-style chat completions API that most other providers also speak.
export const PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", kind: "anthropic", baseUrl: "", defaultModel: "claude-opus-5-5" },
  openai: { label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1" },
  gemini: { label: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  openrouter: { label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1" },
  ollama: { label: "Ollama (local)", kind: "openai", baseUrl: "http://localhost:11434/v1", keyOptional: true },
  custom: { label: "Custom (OpenAI-compatible)", kind: "openai", baseUrl: "", keyOptional: true },
};

let saved = {};
try {
  saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (err) {
  if (err.code !== "ENOENT") console.error(`Ignoring unreadable ${FILE}: ${err.message}`);
}

function fromEnv() {
  const e = process.env;
  if (e.AI_PROVIDER && PROVIDERS[e.AI_PROVIDER]) return { provider: e.AI_PROVIDER, apiKey: e.AI_API_KEY || "", baseUrl: e.AI_BASE_URL || "", model: e.AI_MODEL || "" };
  if (e.ANTHROPIC_API_KEY) return { provider: "anthropic", apiKey: e.ANTHROPIC_API_KEY, baseUrl: "", model: e.ANTHROPIC_MODEL || "" };
  return null;
}

/** Fill in provider defaults; returns null for an unknown provider. */
export function resolve(raw) {
  const preset = PROVIDERS[raw?.provider];
  if (!preset) return null;
  return {
    provider: raw.provider,
    label: preset.label,
    kind: preset.kind,
    apiKey: (raw.apiKey || "").trim(),
    baseUrl: (raw.baseUrl || preset.baseUrl || "").trim().replace(/\/+$/, ""),
    model: (raw.model || preset.defaultModel || "").trim(),
    keyOptional: Boolean(preset.keyOptional),
  };
}

/** Why this configuration cannot be used yet, or null when it is complete. */
export function problem(cfg) {
  if (!cfg) return "No AI provider selected.";
  if (!cfg.apiKey && !cfg.keyOptional) return "An API key is required.";
  if (cfg.kind === "openai" && !cfg.baseUrl) return "A base URL is required.";
  if (!cfg.model) return "A model name is required.";
  return null;
}

const source = () => (saved.provider ? "settings" : fromEnv() ? "env" : "none");
export const activeConfig = () => resolve(saved.provider ? saved : fromEnv());
export const aiAvailable = () => !problem(activeConfig());

/** Settings as shown to the browser: the key itself never leaves the server. */
export function publicSettings() {
  const cfg = activeConfig();
  return {
    provider: cfg?.provider || "none",
    label: cfg?.label || "",
    baseUrl: cfg?.baseUrl || "",
    model: cfg?.model || "",
    hasKey: Boolean(cfg?.apiKey),
    available: aiAvailable(),
    source: source(),
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, kind: p.kind, baseUrl: p.baseUrl, defaultModel: p.defaultModel || "", keyOptional: Boolean(p.keyOptional) })),
  };
}

/** Merge a form submission with the stored key: a blank key means "keep it". */
export function candidate(body) {
  const current = activeConfig();
  const keep = !body.apiKey && current?.provider === body.provider;
  return resolve({ provider: body.provider, apiKey: body.apiKey || (keep ? current.apiKey : ""), baseUrl: body.baseUrl, model: body.model });
}

export function saveSettings(body) {
  if (body.provider === "none") saved = {};
  else {
    const cfg = candidate(body);
    const why = problem(cfg);
    if (why) throw new Error(why);
    saved = { provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model };
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
}
