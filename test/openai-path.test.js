// Exercises the OpenAI-compatible path (OpenAI, Gemini, OpenRouter, Ollama,
// custom servers) against a local stub: JSON-mode fallback, the repair round
// for an invalid answer, plain-text replies, model listing and saved settings.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const valid = {
  studyDesign: "Cohort study", population: "Adults", sampleSize: 48210, sampleSizeText: "48,210", intervention: "GLP-1 RA", comparator: "DPP-4 inhibitor", outcomes: ["HF hospitalisation"],
  methods: "Nationwide cohort.", keyResults: [{ finding: "Lower HF hospitalisation", effect: "HR 0.84", direction: "association" }], conclusion: "Associated with fewer hospitalisations.", limitations: [], evidenceLevel: "low",
};
const invalid = { ...valid, keyResults: [{ ...valid.keyResults[0], direction: "positive" }] };
const calls = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (status, json) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
    if (req.url === "/v1/models") return send(200, { data: [{ id: "models/zeta" }, { id: "alpha" }] });
    const json = JSON.parse(body);
    calls.push({ url: req.url, auth: req.headers.authorization, body: json });
    if (json.response_format) return send(400, { error: { message: "response_format is not supported" } });
    const isJson = json.messages[0].content.includes("JSON Schema");
    const repaired = json.messages.length > 2;
    const content = !isJson ? "ready" : repaired ? JSON.stringify(valid) : "```json\n" + JSON.stringify(invalid) + "\n```";
    send(200, { choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] });
  });
});

test("extraction works through an OpenAI-compatible endpoint", async (t) => {
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}/v1`;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ra-test-"));
  delete process.env.ANTHROPIC_API_KEY;
  Object.assign(process.env, { AI_PROVIDER: "custom", AI_BASE_URL: base + "/", AI_API_KEY: "sk-test", AI_MODEL: "my-model" });

  const settings = await import("../server/settings.js");
  const { extractPaper, testConnection, listModels } = await import("../server/ai.js");
  assert.equal(settings.aiAvailable(), true);
  assert.equal(settings.publicSettings().source, "env");
  assert.equal(JSON.stringify(settings.publicSettings()).includes("sk-test"), false, "the key must not be sent to the browser");

  const ex = await extractPaper({ id: "p", title: "T", abstract: "A cohort of 48,210 adults.", authors: [], journal: "J", year: 2026, pubTypes: [] });
  assert.equal(ex.engine, "ai");
  assert.equal(ex.model, "my-model");
  assert.equal(ex.extraction.keyResults[0].direction, "association");
  assert.equal(calls.length, 3, "JSON-mode attempt, plain retry, repair round");
  assert.equal(calls[0].url, "/v1/chat/completions");
  assert.equal(calls[0].auth, "Bearer sk-test");
  assert.equal(calls[0].body.model, "my-model");
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  assert.equal(calls[1].body.response_format, undefined);
  assert.match(calls[2].body.messages[3].content, /not valid/);

  assert.equal(await testConnection(settings.activeConfig()), "ready");
  assert.deepEqual(await listModels(settings.activeConfig()), ["alpha", "zeta"]);

  // Saved settings take over from the environment; a blank key keeps the stored one.
  settings.saveSettings({ provider: "gemini", apiKey: "g-key", model: "some-gemini-model" });
  assert.equal(settings.activeConfig().baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  settings.saveSettings({ provider: "gemini", apiKey: "", model: "other-model" });
  assert.equal(settings.activeConfig().apiKey, "g-key");
  assert.equal(settings.publicSettings().source, "settings");
  assert.throws(() => settings.saveSettings({ provider: "openai", apiKey: "", model: "m" }), /API key is required/);
});
