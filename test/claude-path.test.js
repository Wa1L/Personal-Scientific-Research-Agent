// Exercises the Claude code path against a local stub of the Messages API:
// checks what we send and that streamed structured output is parsed.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const seen = [];
const reply = {
  studyDesign: "Randomized controlled trial", population: "Adults with HFpEF", sampleSize: 529, sampleSizeText: "529", intervention: "Semaglutide", comparator: "Placebo",
  outcomes: ["6-minute walk distance"], methods: "Double-blind trial.", keyResults: [{ finding: "Walk distance improved", effect: "20.3 m; 95% CI 8.6 to 32.1", direction: "benefit" }],
  conclusion: "Improved exercise capacity.", limitations: ["Abstract only"], evidenceLevel: "moderate",
};
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = JSON.parse(body);
    seen.push({ url: req.url, beta: req.headers["anthropic-beta"], body: json });
    const text = json.output_config.format ? JSON.stringify(reply) : "# Review\n\nFinding [1].";
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    res.writeHead(200, { "content-type": "text/event-stream" });
    ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: json.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
    ev("content_block_stop", { index: 0 });
    ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } });
    ev("message_stop", {});
    res.end();
  });
});

test("extraction and review go through the Messages API", async (t) => {
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${server.address().port}`;
  const { extractPaper, writeReview } = await import("../server/ai.js");
  const paper = { id: "p1", title: "T", abstract: "METHODS: 529 patients.", authors: ["A B"], journal: "J", year: 2026, pubTypes: [] };

  const ex = await extractPaper(paper);
  assert.equal(ex.engine, "claude");
  assert.equal(ex.extraction.sampleSize, 529);
  const sent = seen[0];
  assert.match(sent.url, /\/v1\/messages/);
  assert.match(sent.beta, /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.model, "claude-opus-5-5");
  assert.equal(sent.body.fallbacks, "default");
  assert.equal(sent.body.stream, true);
  assert.equal(sent.body.output_config.effort, "low");
  assert.equal(sent.body.output_config.format.type, "json_schema");
  assert.equal(sent.body.thinking, undefined);

  const rv = await writeReview({ name: "Topic", query: "q" }, [{ ...paper, extraction: ex.extraction }], new Map([["p1", 1]]), "search info");
  assert.equal(rv.result.markdown, "# Review\n\nFinding [1].");
  assert.equal(seen[1].body.max_tokens, 64000);
  assert.match(seen[1].body.messages[0].content, /\[1\] A B \(2026\)/);
});
