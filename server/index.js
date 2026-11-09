import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { data, save, saveNow, newId, getTopic, getPaper, getAnalysis, topicPapers, logActivity } from "./store.js";
import { DOMAINS, STUDY_TYPES, buildQueries } from "./filters.js";
import { SOURCES } from "./sources.js";
import { testConnection, listModels } from "./ai.js";
import { aiAvailable, activeConfig, publicSettings, saveSettings, candidate, problem } from "./settings.js";
import { PACKAGED, DATA_DIR } from "./paths.js";
import { exec } from "node:child_process";
import { runTopic, startScheduler, queueExtraction, startAnalysis, evidenceCsv, reviewMarkdown } from "./monitor.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// A packaged build carries the front end inside the executable.
const assets = globalThis.__ASSETS__;
if (assets) {
  const types = { html: "text/html", css: "text/css", js: "text/javascript" };
  app.use((req, res, next) => {
    const file = req.path === "/" ? "index.html" : req.path.slice(1);
    if (req.method !== "GET" || !Object.hasOwn(assets, file)) return next();
    res.type(types[file.split(".").pop()] || "application/octet-stream").send(assets[file]);
  });
} else {
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public")));
}

const fail = (res, status, message) => res.status(status).json({ error: message });
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export";

function topicFrom(body, prev = {}) {
  const ids = (list, v, fallback) => (Array.isArray(v) ? v.filter((x) => list.some((d) => d.id === x)) : fallback);
  const num = (v, min, max, fallback) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : fallback);
  const t = {
    ...prev,
    name: String(body.name ?? prev.name ?? "").trim(),
    query: String(body.query ?? prev.query ?? "").trim(),
    domains: ids(DOMAINS, body.domains, prev.domains || []),
    studyTypes: ids(STUDY_TYPES, body.studyTypes, prev.studyTypes || []),
    sources: Array.isArray(body.sources) ? body.sources.filter((s) => SOURCES[s]) : prev.sources || Object.keys(SOURCES),
    includePreprints: Boolean(body.includePreprints ?? prev.includePreprints ?? false),
    englishOnly: Boolean(body.englishOnly ?? prev.englishOnly ?? false),
    humansOnly: Boolean(body.humansOnly ?? prev.humansOnly ?? false),
    lookbackDays: num(body.lookbackDays, 1, 3650, prev.lookbackDays ?? 30),
    intervalHours: num(body.intervalHours, 0, 720, prev.intervalHours ?? 24),
    maxPerRun: num(body.maxPerRun, 1, 100, prev.maxPerRun ?? 25),
  };
  if (!t.query) throw new Error("A search query is required.");
  if (!t.sources.length) throw new Error("Choose at least one source.");
  if (!t.name) t.name = t.query.slice(0, 60);
  return t;
}

const topicView = (t) => {
  const papers = topicPapers(t.id);
  return {
    ...t,
    queries: buildQueries(t),
    counts: {
      papers: papers.length,
      unread: papers.filter((p) => p.isNew).length,
      extracting: papers.filter((p) => p.extractionStatus === "pending").length,
    },
  };
};

app.get("/api/meta", (_req, res) =>
  res.json({
    domains: DOMAINS.map(({ id, label }) => ({ id, label })),
    studyTypes: STUDY_TYPES.map(({ id, label }) => ({ id, label })),
    sources: Object.entries(SOURCES).map(([id, s]) => ({ id, label: s.label })),
  })
);

app.get("/api/settings", (_req, res) => res.json(publicSettings()));

app.put("/api/settings", (req, res) => {
  try {
    saveSettings(req.body);
  } catch (err) {
    return fail(res, 400, err.message);
  }
  res.json(publicSettings());
});

// Try a configuration before saving it: "test" sends a one-line prompt,
// "models" lists what the provider offers.
app.post("/api/settings/:check", async (req, res) => {
  const cfg = candidate(req.body);
  try {
    if (req.params.check === "models") {
      if (!cfg || (!cfg.apiKey && !cfg.keyOptional)) throw new Error("Enter an API key first.");
      return res.json({ models: await listModels(cfg) });
    }
    if (req.params.check !== "test") return fail(res, 404, "Not found.");
    const why = problem(cfg);
    if (why) throw new Error(why);
    res.json({ ok: true, reply: await testConnection(cfg) });
  } catch (err) {
    fail(res, 400, err.message);
  }
});

app.get("/api/state", (_req, res) => {
  const d = data();
  res.json({
    topics: d.topics.map(topicView),
    activity: d.activity.slice(0, 40),
    busy: d.topics.some((t) => t.status === "running") || d.papers.some((p) => p.extractionStatus === "pending") || d.analyses.some((a) => a.status === "running"),
  });
});

app.post("/api/preview", (req, res) => {
  try {
    res.json(buildQueries(topicFrom(req.body)));
  } catch (err) {
    fail(res, 400, err.message);
  }
});

app.post("/api/topics", (req, res) => {
  let topic;
  try {
    topic = { id: newId(), createdAt: new Date().toISOString(), status: "idle", lastCheckedAt: null, lastRun: null, ...topicFrom(req.body) };
  } catch (err) {
    return fail(res, 400, err.message);
  }
  data().topics.push(topic);
  logActivity(topic.id, `Started monitoring “${topic.name}”`);
  runTopic(topic.id);
  res.status(201).json(topicView(topic));
});

app.param("topicId", (req, res, next, id) => {
  req.topic = getTopic(id);
  req.topic ? next() : fail(res, 404, "Topic not found.");
});

app.put("/api/topics/:topicId", (req, res) => {
  try {
    Object.assign(req.topic, topicFrom(req.body, req.topic));
  } catch (err) {
    return fail(res, 400, err.message);
  }
  save();
  res.json(topicView(req.topic));
});

app.delete("/api/topics/:topicId", (req, res) => {
  const d = data();
  const id = req.topic.id;
  d.topics = d.topics.filter((t) => t.id !== id);
  d.analyses = d.analyses.filter((a) => a.topicId !== id);
  for (const p of d.papers) p.topicIds = p.topicIds.filter((t) => t !== id);
  d.papers = d.papers.filter((p) => p.topicIds.length);
  save();
  res.json({ ok: true });
});

app.post("/api/topics/:topicId/run", (req, res) => {
  runTopic(req.topic.id);
  res.status(202).json({ ok: true });
});

app.get("/api/topics/:topicId/papers", (req, res) => {
  const papers = topicPapers(req.topic.id).sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || "") || b.addedAt.localeCompare(a.addedAt));
  res.json(papers);
});

app.post("/api/topics/:topicId/seen", (req, res) => {
  for (const p of topicPapers(req.topic.id)) p.isNew = false;
  save();
  res.json({ ok: true });
});

// Re-run extraction for papers that only got the rule-based fallback.
app.post("/api/topics/:topicId/reextract", (req, res) => {
  const papers = topicPapers(req.topic.id).filter((p) => p.extractionEngine === "heuristic" && p.extractionStatus !== "pending");
  papers.forEach(queueExtraction);
  res.status(202).json({ queued: papers.length });
});

app.get("/api/topics/:topicId/analyses", (req, res) => res.json(data().analyses.filter((a) => a.topicId === req.topic.id)));

app.post("/api/topics/:topicId/analyses", (req, res) => {
  try {
    res.status(202).json(startAnalysis(req.topic, req.body.type, req.body.paperIds));
  } catch (err) {
    fail(res, 400, err.message);
  }
});

app.get("/api/topics/:topicId/evidence.csv", (req, res) => {
  res.attachment(`${slug(req.topic.name)}-evidence.csv`).type("text/csv").send(evidenceCsv(topicPapers(req.topic.id)));
});

app.patch("/api/papers/:id", (req, res) => {
  const paper = getPaper(req.params.id);
  if (!paper) return fail(res, 404, "Paper not found.");
  for (const k of ["starred", "isNew", "excluded"]) if (typeof req.body[k] === "boolean") paper[k] = req.body[k];
  save();
  res.json(paper);
});

app.post("/api/papers/:id/extract", (req, res) => {
  const paper = getPaper(req.params.id);
  if (!paper) return fail(res, 404, "Paper not found.");
  queueExtraction(paper);
  res.status(202).json(paper);
});

app.delete("/api/analyses/:id", (req, res) => {
  data().analyses = data().analyses.filter((a) => a.id !== req.params.id);
  save();
  res.json({ ok: true });
});

app.get("/api/analyses/:id/review.md", (req, res) => {
  const a = getAnalysis(req.params.id);
  if (!a || a.type !== "review" || a.status !== "done") return fail(res, 404, "Review not found.");
  res.attachment(`${slug(getTopic(a.topicId)?.name || "review")}-review.md`).type("text/markdown").send(reviewMarkdown(a));
});

app.use("/api", (_req, res) => fail(res, 404, "Not found."));

function openBrowser(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

const firstPort = Number(process.env.PORT) || 3000;
function listen(port) {
  const server = app.listen(port, PACKAGED ? "127.0.0.1" : undefined);
  server.on("error", (err) => {
    // The packaged app picks the next free port rather than failing to start.
    if (err.code === "EADDRINUSE" && PACKAGED && port < firstPort + 20) return listen(port + 1);
    console.error(err.code === "EADDRINUSE" ? `Port ${port} is already in use. Set PORT to another value.` : err.message);
    process.exit(1);
  });
  server.on("listening", () => {
    const url = `http://localhost:${port}`;
    const cfg = activeConfig();
    console.log(`Research Agent is running at ${url}`);
    console.log(aiAvailable() ? `Analysis engine: ${cfg.label} (${cfg.model})` : "Analysis engine: heuristics only — connect an AI provider in Settings");
    console.log(`Data folder: ${DATA_DIR}`);
    if (PACKAGED) console.log("\nKeep this window open while you use the app. Close it to quit.");
    startScheduler();
    if (PACKAGED && process.env.OPEN_BROWSER !== "0") openBrowser(url);
  });
}
listen(firstPort);

for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    saveNow();
    process.exit(0);
  });
