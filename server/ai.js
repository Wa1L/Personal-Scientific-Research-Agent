// Model-backed analysis: per-paper extraction and corpus-level synthesis
// (comparison, research gaps, literature review). Works with Anthropic's
// Messages API or any OpenAI-compatible chat completions endpoint (OpenAI,
// Gemini, OpenRouter, Ollama, ...). Falls back to rule-based heuristics when
// no provider is configured.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { activeConfig, aiAvailable, problem } from "./settings.js";
import { heuristicExtract, heuristicCompare, heuristicGaps, heuristicReview } from "./heuristics.js";

export { aiAvailable };

// ---------------------------------------------------------------- Anthropic

// Biomedical abstracts can occasionally trip safety classifiers. On the models
// that support it, server-side fallbacks re-run a declined request on another
// model instead of failing. Set ANTHROPIC_REFUSAL_FALLBACK=off to disable.
const FALLBACK_MODELS = /^claude-(?:fable-5-[12]|opus-5(?:-5)?|sonnet-5-5)$/;
const useFallback = (model) => process.env.ANTHROPIC_REFUSAL_FALLBACK !== "off" && FALLBACK_MODELS.test(model);

const clients = new Map();
function anthropic(cfg) {
  if (!clients.has(cfg.apiKey)) clients.set(cfg.apiKey, new Anthropic({ apiKey: cfg.apiKey, maxRetries: 4 }));
  return clients.get(cfg.apiKey);
}

function anthropicError(err) {
  if (err instanceof Anthropic.AuthenticationError) return new Error("Anthropic rejected the API key.");
  if (err instanceof Anthropic.NotFoundError) return new Error("Anthropic does not recognise that model name.");
  if (err instanceof Anthropic.RateLimitError) return new Error("Anthropic rate limit reached; try again shortly.");
  if (err instanceof Anthropic.APIError) return new Error(`Anthropic API error ${err.status ?? ""}: ${err.message}`);
  return err;
}

async function anthropicComplete(cfg, { system, user, schema, effort, maxTokens }) {
  const params = {
    model: cfg.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort, ...(schema && { format: zodOutputFormat(schema) }) },
  };
  let message;
  try {
    message = useFallback(cfg.model)
      ? await anthropic(cfg).beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }).finalMessage()
      : await anthropic(cfg).messages.stream(params).finalMessage();
  } catch (err) {
    throw anthropicError(err);
  }
  if (message.stop_reason === "refusal") throw new Error(`The model declined this request (${message.stop_details?.category || "no category"}).`);
  if (message.stop_reason === "max_tokens") throw new Error("The model's answer was cut off at the output limit.");
  const out = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return schema ? schema.parse(JSON.parse(out)) : out;
}

// -------------------------------------------------------- OpenAI-compatible

async function chat(cfg, body) {
  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cfg.apiKey && { Authorization: `Bearer ${cfg.apiKey}` }) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    });
  } catch (err) {
    throw new Error(`Could not reach ${cfg.label} at ${cfg.baseUrl} (${err.cause?.code || err.message}).`);
  }
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {}
  if (!res.ok) {
    const detail = (Array.isArray(json) ? json[0] : json)?.error;
    const error = new Error(`${cfg.label} error ${res.status}: ${detail?.message || (typeof detail === "string" ? detail : raw.slice(0, 300)) || res.statusText}`);
    error.status = res.status;
    throw error;
  }
  const choice = json?.choices?.[0];
  if (!choice) throw new Error(`${cfg.label} returned no answer.`);
  if (choice.finish_reason === "length") throw new Error("The model's answer was cut off at the output limit.");
  if (choice.finish_reason === "content_filter") throw new Error("The provider's content filter blocked this request.");
  const content = choice.message?.content;
  return typeof content === "string" ? content : (content || []).map((part) => part.text || "").join("");
}

/** Pull the JSON object out of a reply that may be wrapped in prose or a code fence. */
function parseJsonReply(text) {
  const from = text.indexOf("{");
  const to = text.lastIndexOf("}");
  if (from < 0 || to <= from) throw new Error("The model did not return JSON.");
  return JSON.parse(text.slice(from, to + 1));
}

async function openaiComplete(cfg, { system, user, schema }) {
  if (!schema) return chat(cfg, { model: cfg.model, messages: [{ role: "system", content: system }, { role: "user", content: user }] });

  const messages = [
    { role: "system", content: `${system}\n\nRespond with a single JSON object and nothing else. It must conform to this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}` },
    { role: "user", content: user },
  ];
  let jsonMode = true;
  const ask = async () => {
    try {
      return await chat(cfg, { model: cfg.model, messages, ...(jsonMode && { response_format: { type: "json_object" } }) });
    } catch (err) {
      // Not every compatible server implements JSON mode; the prompt alone still asks for JSON.
      if (!jsonMode || ![400, 404, 422].includes(err.status)) throw err;
      jsonMode = false;
      return chat(cfg, { model: cfg.model, messages });
    }
  };

  let reply = await ask();
  for (let attempt = 0; ; attempt++) {
    try {
      return schema.parse(parseJsonReply(reply));
    } catch (err) {
      if (attempt === 1) throw new Error(`The model's answer did not match the expected format (${err.issues ? z.prettifyError(err).split("\n")[0] : err.message}).`);
      // One repair round: show the model what was wrong with its answer.
      messages.push({ role: "assistant", content: reply }, { role: "user", content: `That answer was not valid: ${err.issues ? z.prettifyError(err) : err.message}\nReturn the corrected JSON object only.` });
      reply = await ask();
    }
  }
}

// ------------------------------------------------------------------ shared

async function complete(request, cfg = activeConfig()) {
  const why = problem(cfg);
  if (why) throw new Error(why);
  const req = { maxTokens: 32000, effort: "high", ...request };
  return cfg.kind === "anthropic" ? anthropicComplete(cfg, req) : openaiComplete(cfg, req);
}

const engine = () => ({ engine: "ai", model: activeConfig().model });

/** Send a trivial request to check that a configuration works. */
export async function testConnection(cfg) {
  const reply = await complete({ system: "You are a connection test.", user: "Reply with the single word: ready", effort: "low", maxTokens: 2000 }, cfg);
  return reply.trim().slice(0, 80);
}

/** List the model names a provider offers, for the Settings screen. */
export async function listModels(cfg) {
  if (cfg.kind === "anthropic") {
    const ids = [];
    try {
      for await (const m of anthropic(cfg).models.list()) ids.push(m.id);
    } catch (err) {
      throw anthropicError(err);
    }
    return ids;
  }
  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/models`, { headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new Error(`Could not reach ${cfg.label} at ${cfg.baseUrl} (${err.cause?.code || err.message}).`);
  }
  if (!res.ok) throw new Error(`${cfg.label} error ${res.status} while listing models.`);
  const json = await res.json();
  return (json.data || json.models || []).map((m) => String(m.id || m.name || "").replace(/^models\//, "")).filter(Boolean).sort();
}

// ------------------------------------------------------------- extraction

const Extraction = z.object({
  studyDesign: z.string().describe("e.g. Randomized controlled trial, Cohort study, Meta-analysis, Animal study, Narrative review"),
  population: z.string().describe("Who or what was studied; empty string if not stated"),
  sampleSize: z.number().nullable().describe("Total number of participants/subjects analysed; null if not stated. For meta-analyses, pooled participants if given"),
  sampleSizeText: z.string().describe("Sample size as reported, incl. arms or number of studies, e.g. '412 (207 vs 205)' or '23 trials'"),
  intervention: z.string().describe("Intervention or exposure; empty string if not applicable"),
  comparator: z.string().describe("Control/comparator; empty string if none"),
  outcomes: z.array(z.string()).describe("Outcomes measured"),
  methods: z.string().describe("One or two sentences on how the study was done"),
  keyResults: z.array(
    z.object({
      finding: z.string().describe("One result in plain language"),
      effect: z.string().describe("The statistic exactly as reported (effect size, CI, p); empty string if none"),
      direction: z.enum(["benefit", "harm", "no_difference", "association", "mixed", "unclear"]),
    })
  ),
  conclusion: z.string().describe("The authors' main conclusion in one sentence"),
  limitations: z.array(z.string()).describe("Limitations stated or evident from the design"),
  evidenceLevel: z.enum(["high", "moderate", "low", "very_low", "unrated"]).describe("GRADE-style confidence given design, size and precision"),
});

const EXTRACT_SYSTEM = `You extract structured data from scientific abstracts for an evidence table that researchers will rely on.

Report only what the abstract states. Copy numbers and statistics exactly; never compute, round or infer values that are not written. When something is not reported, use an empty string, an empty list or null rather than a guess. The limitations field is the one place for your own judgement: include limitations the authors state and those that follow directly from the design described.`;

const paperBlock = (p) =>
  [
    `Title: ${p.title}`,
    `Journal: ${p.journal || "n/a"} (${p.year || "n.d."})${p.isPreprint ? " — PREPRINT, not peer reviewed" : ""}`,
    `Publication types: ${(p.pubTypes || []).join("; ") || "n/a"}`,
    `Abstract:\n${p.abstract || "(no abstract available)"}`,
  ].join("\n");

export async function extractPaper(paper) {
  if (!aiAvailable() || !paper.abstract) return { engine: "heuristic", model: null, extraction: heuristicExtract(paper) };
  const extraction = await complete({ system: EXTRACT_SYSTEM, user: paperBlock(paper), schema: Extraction, effort: "low", maxTokens: 16000 });
  return { ...engine(), extraction };
}

// -------------------------------------------------------------- synthesis

function corpus(papers, refNo) {
  return papers
    .map((p) => {
      const e = p.extraction;
      const lines = [`[${refNo.get(p.id)}] ${p.authors[0] || "Anonymous"}${p.authors.length > 1 ? " et al." : ""} (${p.year || "n.d."}). ${p.title}. ${p.journal}${p.isPreprint ? " [preprint]" : ""}`];
      if (e) {
        lines.push(`Design: ${e.studyDesign} | N: ${e.sampleSizeText || e.sampleSize || "not reported"} | Evidence level: ${e.evidenceLevel}`);
        if (e.population) lines.push(`Population: ${e.population}`);
        if (e.intervention) lines.push(`Intervention/exposure: ${e.intervention}${e.comparator ? ` vs ${e.comparator}` : ""}`);
      }
      lines.push(`Abstract: ${p.abstract || "(none)"}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

const SYNTH_RULES = `Ground every statement in the studies provided and identify them by their bracketed reference numbers. Do not draw on studies that are not in the list, and do not invent statistics: quote effect sizes as the abstracts report them. You are working from abstracts only, so say so where a judgement would need the full text. Weigh studies by design and size rather than counting votes, and treat preprints as unreviewed.`;

const refs = z.array(z.number()).describe("Reference numbers of the supporting studies");

const Comparison = z.object({
  summary: z.string().describe("Three or four sentences: what the studies collectively show"),
  agreements: z.array(z.object({ point: z.string(), refs })),
  conflicts: z.array(
    z.object({
      point: z.string().describe("What the studies disagree on"),
      positions: z.array(z.object({ stance: z.string(), refs })),
      likelyExplanation: z.string().describe("Differences in design, population, dose, outcome definition etc. that may explain it"),
    })
  ),
  methodDifferences: z.array(z.object({ aspect: z.string(), detail: z.string(), refs })),
  strengthOfEvidence: z.string().describe("Overall confidence in the body of evidence and why"),
});

const Gaps = z.object({
  overview: z.string().describe("Two or three sentences on what is well covered and what is not"),
  gaps: z.array(
    z.object({
      title: z.string(),
      description: z.string().describe("What is missing and why it matters"),
      type: z.enum(["Population", "Intervention", "Comparator", "Outcomes", "Design", "Mechanism", "Setting", "Replication", "Other"]),
      priority: z.enum(["high", "medium", "low"]),
      refs: z.array(z.number()).describe("Studies that expose or border this gap"),
      suggestedStudy: z.string().describe("A concrete study that would close the gap"),
    })
  ),
});

const header = (topic, papers) => `Research topic: ${topic.name}\nSearch query: ${topic.query}\nStudies (${papers.length}):\n\n`;

export async function compareFindings(topic, papers, refNo) {
  if (!aiAvailable()) return { engine: "heuristic", result: heuristicCompare(papers) };
  const result = await complete({
    system: `You compare findings across scientific studies for a researcher who knows the field. ${SYNTH_RULES}`,
    user: `${header(topic, papers)}${corpus(papers, refNo)}\n\nCompare these studies: where they agree, where they conflict and the most plausible reasons, how their methods differ, and how strong the overall evidence is.`,
    schema: Comparison,
  });
  return { ...engine(), result };
}

export async function findGaps(topic, papers, refNo) {
  if (!aiAvailable()) return { engine: "heuristic", result: heuristicGaps(papers) };
  const result = await complete({
    system: `You identify research gaps in a body of literature for a researcher planning their next study. ${SYNTH_RULES}\n\nA gap is something these studies leave unanswered: an unstudied population, comparator or outcome, an untested mechanism, a missing design, or an unreplicated finding. This list reflects one search rather than the whole field, so phrase each gap as absent from this corpus. Prefer a few well-argued gaps over a long list.`,
    user: `${header(topic, papers)}${corpus(papers, refNo)}\n\nIdentify the research gaps this corpus reveals, most important first.`,
    schema: Gaps,
  });
  return { ...engine(), result };
}

export async function writeReview(topic, papers, refNo, searchInfo) {
  if (!aiAvailable()) return { engine: "heuristic", result: { markdown: heuristicReview(topic, papers, refNo) } };
  const markdown = await complete({
    system: `You write structured literature reviews for a scientific readership. ${SYNTH_RULES}

Write in Markdown. Cite with bracketed reference numbers such as [3] or [2, 7], using only the numbers given. The application appends the reference list and the evidence table itself, so write neither.

Structure: a title (# heading), then ## sections for Summary, Background, Search methods, Findings (organised by theme with ### subsections, not study by study), Consistency and conflicts, Quality of the evidence, Research gaps, and Conclusions. The Search methods section should report the search details you are given, as given.`,
    user: `${header(topic, papers)}${corpus(papers, refNo)}\n\nSearch details: ${searchInfo}\n\nWrite the literature review.`,
    maxTokens: 64000,
  });
  return { ...engine(), result: { markdown: markdown.trim() } };
}
