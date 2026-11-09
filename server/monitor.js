// The agent loop: check sources for new papers on a schedule, extract
// structured data from each new paper, and run corpus-level analyses.
import { data, save, newId, logActivity, getTopic, getPaper, topicPapers } from "./store.js";
import { SOURCES, keysOf, mergeRecord } from "./sources.js";
import { buildQueries } from "./filters.js";
import { extractPaper, compareFindings, findGaps, writeReview, aiAvailable } from "./ai.js";

const DAY = 86_400_000;

// ------------------------------------------------------- extraction queue

const CONCURRENCY = 3;
const queue = [];
let active = 0;

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const paper = getPaper(queue.shift());
    if (!paper || paper.extractionStatus !== "pending") continue;
    active++;
    extractPaper(paper)
      .then(({ engine, extraction }) => Object.assign(paper, { extraction, extractionEngine: engine, extractionStatus: "done", extractionError: null }))
      .catch((err) => Object.assign(paper, { extractionStatus: "error", extractionError: err.message }))
      .finally(() => {
        active--;
        save();
        pump();
      });
  }
}

export function queueExtraction(paper) {
  paper.extractionStatus = "pending";
  queue.push(paper.id);
  save();
  pump();
}

// ------------------------------------------------------------ topic runs

const running = new Set();

export async function runTopic(topicId) {
  const topic = getTopic(topicId);
  if (!topic || running.has(topicId)) return;
  running.add(topicId);
  topic.status = "running";
  save();

  const to = new Date();
  // Re-scan a two-day overlap: indexing dates lag, and duplicates are dropped anyway.
  const from = topic.lastCheckedAt ? new Date(Date.parse(topic.lastCheckedAt) - 2 * DAY) : new Date(to - topic.lookbackDays * DAY);
  const names = topic.sources.filter((s) => SOURCES[s]);
  const settled = await Promise.allSettled(names.map((s) => SOURCES[s].search(topic, from, to)));

  const errors = [];
  const batch = new Map(); // identity key -> merged record for this run
  let found = 0;
  settled.forEach((r, i) => {
    if (r.status === "rejected") return errors.push(`${SOURCES[names[i]].label}: ${r.reason.message}`);
    found += r.value.length;
    for (const rec of r.value) {
      const hit = keysOf(rec).map((k) => batch.get(k)).find(Boolean);
      const merged = hit ? mergeRecord(hit, rec) : rec;
      for (const k of keysOf(merged)) batch.set(k, merged);
    }
  });

  const index = new Map();
  for (const p of data().papers) for (const k of keysOf(p)) index.set(k, p);

  let added = 0;
  for (const rec of new Set(batch.values())) {
    const existing = keysOf(rec).map((k) => index.get(k)).find(Boolean);
    if (existing) {
      mergeRecord(existing, rec);
      if (!existing.topicIds.includes(topicId)) {
        existing.topicIds.push(topicId);
        added++;
      }
      continue;
    }
    const paper = { id: newId(), topicIds: [topicId], addedAt: to.toISOString(), isNew: true, starred: false, excluded: false, ...rec };
    data().papers.push(paper);
    for (const k of keysOf(paper)) index.set(k, paper);
    queueExtraction(paper);
    added++;
  }

  const ok = errors.length < names.length;
  if (ok) topic.lastCheckedAt = to.toISOString();
  topic.lastAttemptAt = to.toISOString();
  topic.lastRun = { at: to.toISOString(), found, added, errors };
  topic.status = "idle";
  running.delete(topicId);
  for (const e of errors) logActivity(topicId, e, "error");
  if (ok) logActivity(topicId, added ? `${added} new paper${added === 1 ? "" : "s"} found` : "Checked — nothing new", added ? "success" : "info");
  save();
}

export function startScheduler() {
  // Finish work interrupted by a restart.
  for (const t of data().topics) t.status = "idle";
  for (const a of data().analyses) if (a.status === "running") Object.assign(a, { status: "error", error: "Interrupted by a server restart." });
  for (const p of data().papers) if (p.extractionStatus === "pending") queueExtraction(p);

  const tick = () => {
    for (const t of data().topics) {
      if (!t.intervalHours) continue;
      const last = Date.parse(t.lastAttemptAt || 0) || 0;
      if (Date.now() - last >= t.intervalHours * 3_600_000) runTopic(t.id);
    }
  };
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 2_000).unref();
}

// --------------------------------------------------------------- analyses

export function formatReference(p) {
  const authors = p.authors.length > 6 ? `${p.authors.slice(0, 6).join(", ")}, et al` : p.authors.join(", ");
  const vol = p.volume ? `;${p.volume}${p.issue ? `(${p.issue})` : ""}${p.pages ? `:${p.pages}` : ""}` : "";
  return [
    authors && `${authors}.`,
    `${p.title.replace(/\.$/, "")}.`,
    p.journal && `${p.journal}.`,
    `${p.year || "n.d."}${vol}.`,
    p.isPreprint && "[Preprint].",
    p.doi && `doi:${p.doi}.`,
    p.pmid && `PMID: ${p.pmid}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

const RUNNERS = { compare: compareFindings, gaps: findGaps, review: writeReview };
const MIN_PAPERS = { compare: 2, gaps: 3, review: 2 };

export function startAnalysis(topic, type, paperIds) {
  if (!RUNNERS[type]) throw new Error("Unknown analysis type.");
  let papers = topicPapers(topic.id);
  if (paperIds?.length) papers = papers.filter((p) => paperIds.includes(p.id));
  if (papers.length < MIN_PAPERS[type]) throw new Error(`Select at least ${MIN_PAPERS[type]} papers for this analysis.`);
  papers.sort((a, b) => (a.year || 0) - (b.year || 0) || a.title.localeCompare(b.title));

  // Reference numbers are assigned here, not by the model, so every [n] in
  // the output maps to a real record.
  const refNo = new Map(papers.map((p, i) => [p.id, i + 1]));
  const analysis = {
    id: newId(),
    topicId: topic.id,
    type,
    status: "running",
    createdAt: new Date().toISOString(),
    engine: aiAvailable() ? "claude" : "heuristic",
    references: papers.map((p, i) => ({ n: i + 1, paperId: p.id, text: formatReference(p), url: p.url })),
    result: null,
  };
  data().analyses.unshift(analysis);
  save();

  const q = buildQueries(topic);
  const searchInfo = `Sources: ${topic.sources.map((s) => SOURCES[s].label).join(" and ")}. PubMed query: ${q.pubmed}. Europe PMC query: ${q.europepmc}. Records retrieved by automated monitoring up to ${new Date().toISOString().slice(0, 10)}; ${papers.length} records included. Data were extracted from abstracts only.`;

  RUNNERS[type](topic, papers, refNo, searchInfo)
    .then(({ engine, result }) => {
      Object.assign(analysis, { status: "done", engine, result });
      logActivity(topic.id, { compare: "Comparison", gaps: "Gap analysis", review: "Literature review" }[type] + ` ready (${papers.length} papers)`, "success");
    })
    .catch((err) => Object.assign(analysis, { status: "error", error: err.message }))
    .finally(save);
  return analysis;
}

// ---------------------------------------------------------------- exports

const csvCell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;

export function evidenceCsv(papers) {
  const head = ["Authors", "Year", "Title", "Journal", "Design", "Population", "Sample size", "Intervention / exposure", "Comparator", "Outcomes", "Key results", "Conclusion", "Limitations", "Evidence level", "PMID", "DOI", "URL"];
  const rows = papers.map((p) => {
    const e = p.extraction || {};
    return [
      p.authors.join("; "), p.year, p.title, p.journal, e.studyDesign, e.population, e.sampleSizeText || e.sampleSize, e.intervention, e.comparator,
      (e.outcomes || []).join("; "),
      (e.keyResults || []).map((r) => (r.effect && !r.finding.includes(r.effect) ? `${r.finding} (${r.effect})` : r.finding)).join(" | "),
      e.conclusion, (e.limitations || []).join("; "), e.evidenceLevel, p.pmid, p.doi, p.url,
    ];
  });
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function reviewMarkdown(analysis) {
  const mdCell = (v) => String(v ?? "—").replaceAll("|", "\\|").replace(/\s+/g, " ") || "—";
  const out = [analysis.result.markdown, "", "## Evidence table", "", "| Ref | Study | Design | N | Main finding |", "|---|---|---|---|---|"];
  for (const r of analysis.references) {
    const p = getPaper(r.paperId);
    if (!p) continue;
    const e = p.extraction || {};
    out.push(`| ${r.n} | ${mdCell(`${p.authors[0] || "Anonymous"}${p.authors.length > 1 ? " et al." : ""} ${p.year || ""}`)} | ${mdCell(e.studyDesign)} | ${mdCell(e.sampleSizeText || e.sampleSize)} | ${mdCell(e.conclusion)} |`);
  }
  out.push("", "## References", "");
  for (const r of analysis.references) out.push(`${r.n}. ${r.text} ${r.url}`);
  return out.join("\n") + "\n";
}
