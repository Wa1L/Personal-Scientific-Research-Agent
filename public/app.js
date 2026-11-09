// Research Agent — single-page front end (no build step).

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const S = {
  meta: { domains: [], studyTypes: [], sources: [] },
  ai: { providers: [] },
  topics: [],
  activity: [],
  busy: false,
  topicId: null,
  tab: "papers",
  papers: [],
  analyses: [],
  filter: { q: "", design: "", show: "all" },
  selected: new Set(),
  sort: { key: "year", dir: -1 },
  shown: {}, // analysis type -> analysis id on display
  drawerId: null,
  form: null,
};

// ------------------------------------------------------------------ api

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

function toast(message, isError) {
  const el = document.createElement("div");
  el.className = `toast${isError ? " err" : ""}`;
  el.textContent = message;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), isError ? 6000 : 3000);
}

const guard = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    toast(err.message, true);
  }
};

let snapshot = "";
let pollTimer;
async function refresh(force) {
  clearTimeout(pollTimer);
  try {
    const state = await api("/state");
    let papers = S.papers;
    let analyses = S.analyses;
    if (S.topicId && state.topics.some((t) => t.id === S.topicId)) {
      [papers, analyses] = await Promise.all([api(`/topics/${S.topicId}/papers`), api(`/topics/${S.topicId}/analyses`)]);
    } else if (S.topicId) {
      location.hash = "#/";
    }
    const next = JSON.stringify([state, papers, analyses]);
    if (next !== snapshot || force) {
      snapshot = next;
      Object.assign(S, state, { papers, analyses });
      render();
    }
  } catch (err) {
    console.error(err);
  }
  pollTimer = setTimeout(refresh, S.busy ? 2000 : 12000);
}

// -------------------------------------------------------------- helpers

const ICONS = {
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  down: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.8-1.2l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0-1.2-2.8H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.8l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 2.8-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0 1.2 2.8h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
};
const icon = (name, size = 16, cls = "", fill = "none") =>
  `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

function ago(iso) {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
const SCHEDULES = [[0, "Manual only"], [1, "Every hour"], [6, "Every 6 hours"], [24, "Daily"], [168, "Weekly"]];
const LOOKBACKS = [[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 3 months"], [365, "Last year"], [1825, "Last 5 years"]];
const scheduleLabel = (h) => (SCHEDULES.find(([v]) => v === h) || [0, `Every ${h} h`])[1];
const topic = () => S.topics.find((t) => t.id === S.topicId);
const paperById = (id) => S.papers.find((p) => p.id === id);
const byline = (p) => {
  const a = p.authors || [];
  const who = a.length > 3 ? `${a[0]} et al.` : a.join(", ");
  return `${esc(who || "No authors listed")} · <em>${esc(p.journal || "Unknown journal")}</em> · ${esc(p.year || "n.d.")}`;
};
const fmtN = (e) => (e?.sampleSize != null ? e.sampleSize.toLocaleString() : "");
const LEVELS = { high: ["High", "green"], moderate: ["Moderate", "blue"], low: ["Low", "gold"], very_low: ["Very low", "red"] };
const levelPill = (e) => (LEVELS[e?.evidenceLevel] ? `<span class="pill ${LEVELS[e.evidenceLevel][1]}">${LEVELS[e.evidenceLevel][0]} certainty</span>` : "");
const enginePill = (engine, model) =>
  engine === "heuristic"
    ? `<span class="pill gold" title="Rule-based fallback — no AI provider was connected">Heuristic</span>`
    : `<span class="pill accent" title="Analysed by this model">${icon("spark", 12)} ${esc(model || "Claude")}</span>`;
const DIRS = { benefit: "Benefit", harm: "Harm", no_difference: "No difference", association: "Association", mixed: "Mixed", unclear: "Unclear" };

const cites = (refs) => (refs || []).map((n) => `<button class="cite" data-action="cite" data-n="${n}">${n}</button>`).join("");
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[(\d+(?:\s*[,;–-]\s*\d+)*)\]/g, (_, inner) => cites(inner.match(/\d+/g)));

function markdown(md) {
  const out = [];
  let list = null;
  let para = [];
  let table = null;
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    if (table) {
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const [head, , ...rows] = table;
      out.push(`<table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    }
    para = [];
    list = table = null;
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) flush();
    else if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
      flush();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (/^\s*\|.*\|\s*$/.test(line)) {
      if (!table) flush(), (table = []);
      table.push(line.trim());
    } else if ((m = line.match(/^\s*(?:([-*•])|\d+[.)])\s+(.*)/))) {
      const tag = m[1] ? "ul" : "ol";
      if (!list || list.tag !== tag) flush(), (list = { tag, items: [] });
      list.items.push(m[2]);
    } else if (list && /^\s+\S/.test(raw)) list.items[list.items.length - 1] += ` ${line.trim()}`;
    else {
      if (list || table) flush();
      para.push(line.trim());
    }
  }
  flush();
  return out.join("\n");
}

// -------------------------------------------------------------- sidebar

function renderSidebar() {
  const ai = S.ai;
  $("#sidebar").innerHTML = `
    <div class="brand">
      <div class="brand-mark">R</div>
      <div><div class="brand-name">Research Agent</div><div class="brand-sub">PubMed · Europe PMC</div></div>
    </div>
    <button class="nav-item ${S.topicId ? "" : "active"}" data-action="go" data-href="#/">${icon("home")}<span class="grow">Overview</span></button>
    <div class="nav-label">Monitored topics</div>
    ${S.topics
      .map(
        (t) => `<button class="nav-item ${t.id === S.topicId ? "active" : ""}" data-action="go" data-href="#/t/${t.id}/papers" title="${esc(t.name)}">
          <span class="dot ${t.lastRun?.errors?.length ? "err" : t.intervalHours ? "live" : ""}"></span>
          <span class="grow">${esc(t.name)}</span>
          ${t.status === "running" ? icon("refresh", 13, "spin") : t.counts.unread ? `<span class="count">${t.counts.unread}</span>` : `<span class="count muted">${t.counts.papers}</span>`}
        </button>`
      )
      .join("")}
    <button class="nav-item nav-add" data-action="new-topic">${icon("plus", 14)} New topic</button>
    <button class="engine" data-action="settings" title="AI settings">
      <strong><span class="dot ${ai.available ? "live" : ""}"></span><span class="grow">${ai.available ? esc(ai.label) : "No AI connected"}</span>${icon("gear", 15)}</strong>
      ${ai.available ? esc(ai.model) : "Heuristic mode. Connect Claude, OpenAI, Gemini or another model."}
    </button>`;
}

// ------------------------------------------------------------- overview

function renderOverview() {
  if (!S.topics.length) {
    return `<div class="hero">
      <h1>Your literature, watched and organised.</h1>
      <p>Tell the agent what you study. It checks PubMed and Europe PMC for new papers, pulls out methods, sample sizes and results, and turns them into evidence tables, comparisons, gap analyses and referenced reviews.</p>
      <button class="btn primary" data-action="new-topic">${icon("plus")} Create your first topic</button>
      <div class="steps">
        <div class="card step"><i>01</i><b>Monitor</b><span>Define a query with domain and study-type filters. The agent re-checks on your schedule.</span></div>
        <div class="card step"><i>02</i><b>Extract</b><span>Each new abstract is parsed into design, population, sample size, results and limitations.</span></div>
        <div class="card step"><i>03</i><b>Synthesise</b><span>Compare findings, surface research gaps and draft a structured review with references.</span></div>
      </div>
    </div>`;
  }
  const sum = (f) => S.topics.reduce((n, t) => n + f(t), 0);
  const scheduled = S.topics.filter((t) => t.intervalHours).length;
  return `<div class="page">
    <div class="page-head">
      <div><h1>Overview</h1><p class="sub">${scheduled} of ${S.topics.length} topic${S.topics.length === 1 ? "" : "s"} on a schedule.</p></div>
      <div class="actions"><button class="btn primary" data-action="new-topic">${icon("plus")} New topic</button></div>
    </div>
    <div class="stats">
      <div class="card stat"><div class="v">${S.topics.length}</div><div class="l">Topics</div></div>
      <div class="card stat"><div class="v">${sum((t) => t.counts.papers)}</div><div class="l">Papers tracked</div></div>
      <div class="card stat"><div class="v">${sum((t) => t.counts.unread)}</div><div class="l">Unread</div></div>
      <div class="card stat"><div class="v">${sum((t) => t.counts.extracting)}</div><div class="l">Being extracted</div></div>
    </div>
    <div class="split">
      <div>
        <h2 class="section-title">Topics</h2>
        ${S.topics
          .map(
            (t) => `<div class="card topic-card" data-action="go" data-href="#/t/${t.id}/papers" role="link" tabindex="0">
              <h3>${esc(t.name)} ${t.counts.unread ? `<span class="pill gold">${t.counts.unread} new</span>` : ""}</h3>
              <div class="row"><span class="query">${esc(t.query)}</span></div>
              <div class="row">
                <span class="pill">${t.counts.papers} papers</span>
                <span class="pill">${scheduleLabel(t.intervalHours)}</span>
                <span class="pill">${t.status === "running" ? "Checking now…" : `Checked ${ago(t.lastCheckedAt)}`}</span>
                ${t.lastRun?.errors?.length ? `<span class="pill red">Source error</span>` : ""}
              </div>
            </div>`
          )
          .join("")}
      </div>
      <div>
        <h2 class="section-title">Activity</h2>
        <div class="card activity"><ul>
          ${S.activity
            .slice(0, 14)
            .map((a) => {
              const t = S.topics.find((x) => x.id === a.topicId);
              return `<li><span class="dot ${a.level}"></span><div>${esc(a.message)}<div class="when">${t ? `${esc(t.name)} · ` : ""}${ago(a.at)}</div></div></li>`;
            })
            .join("") || `<li><span></span><div class="when">Nothing yet.</div></li>`}
        </ul></div>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- topic

const TABS = [["papers", "Papers"], ["evidence", "Evidence table"], ["compare", "Compare"], ["gaps", "Research gaps"], ["review", "Literature review"]];

function renderTopic() {
  const t = topic();
  if (!t) return "";
  const labels = (list, ids) => list.filter((x) => ids.includes(x.id)).map((x) => x.label);
  const running = t.status === "running";
  const body = { papers: renderPapers, evidence: renderEvidence, compare: () => renderAnalysis("compare"), gaps: () => renderAnalysis("gaps"), review: () => renderAnalysis("review") }[S.tab]();
  const doneCount = (type) => S.analyses.filter((a) => a.type === type).length;
  return `<div class="page">
    <div class="page-head">
      <div style="min-width:0">
        <h1>${esc(t.name)}</h1>
        <div class="meta-row">
          <span class="query" title="${esc(t.query)}">${esc(t.query)}</span>
          ${labels(S.meta.domains, t.domains).map((l) => `<span class="pill accent">${esc(l)}</span>`).join("")}
          ${labels(S.meta.studyTypes, t.studyTypes).map((l) => `<span class="pill blue">${esc(l)}</span>`).join("")}
          ${labels(S.meta.sources, t.sources).map((l) => `<span class="pill outline">${esc(l)}</span>`).join("")}
          ${t.includePreprints ? `<span class="pill outline">+ preprints</span>` : ""}
        </div>
        <p class="sub" style="font-size:13px;margin-top:10px">${scheduleLabel(t.intervalHours)} · ${running ? "checking sources now…" : `last checked ${ago(t.lastCheckedAt)}`}${t.counts.extracting ? ` · extracting ${t.counts.extracting} paper${t.counts.extracting === 1 ? "" : "s"}…` : ""}</p>
      </div>
      <div class="actions">
        <button class="btn" data-action="run" ${running ? "disabled" : ""}>${icon("refresh", 15, running ? "spin" : "")} ${running ? "Checking…" : "Check now"}</button>
        <button class="btn ghost" data-action="edit-topic" title="Edit topic">${icon("edit")}</button>
        <button class="btn ghost danger" data-action="delete-topic" title="Delete topic">${icon("trash")}</button>
      </div>
    </div>
    ${(t.lastRun?.errors || []).map((e) => `<div class="banner err" style="margin-top:14px">${esc(e)}</div>`).join("")}
    <div class="tabs">
      ${TABS.map(([id, label]) => {
        const n = id === "papers" ? t.counts.papers : id === "evidence" ? "" : doneCount(id);
        return `<button class="tab ${S.tab === id ? "active" : ""}" data-action="go" data-href="#/t/${t.id}/${id}">${label}${n ? `<span class="n">${n}</span>` : ""}</button>`;
      }).join("")}
    </div>
    <div id="tab-body">${body}</div>
  </div>`;
}

// ----------------------------------------------------------- papers tab

function visiblePapers() {
  const { q, design, show } = S.filter;
  const needle = q.trim().toLowerCase();
  return S.papers.filter((p) => {
    if (show === "new" && !p.isNew) return false;
    if (show === "starred" && !p.starred) return false;
    if (design && p.extraction?.studyDesign !== design) return false;
    if (!needle) return true;
    return `${p.title} ${p.authors.join(" ")} ${p.journal} ${p.abstract}`.toLowerCase().includes(needle);
  });
}

function paperRow(p) {
  const e = p.extraction;
  const gist = e?.conclusion || p.abstract.slice(0, 260);
  return `<div class="paper ${p.isNew ? "unread" : ""}" data-action="open-paper" data-id="${p.id}">
    <input type="checkbox" data-action="select" data-id="${p.id}" ${S.selected.has(p.id) ? "checked" : ""} aria-label="Select for comparison">
    <div>
      <h3>${esc(p.title)}</h3>
      <div class="byline">${byline(p)}</div>
      ${gist ? `<div class="gist">${esc(gist)}</div>` : ""}
      <div class="tags">
        ${p.isNew ? `<span class="pill gold">New</span>` : ""}
        ${p.extractionStatus === "pending" ? `<span class="pill">${icon("refresh", 11, "spin")} Extracting</span>` : ""}
        ${p.extractionStatus === "error" ? `<span class="pill red" title="${esc(p.extractionError)}">Extraction failed</span>` : ""}
        ${e ? `<span class="pill accent">${esc(e.studyDesign)}</span>` : ""}
        ${fmtN(e) ? `<span class="pill outline">n = ${fmtN(e)}</span>` : ""}
        ${levelPill(e)}
        ${p.isPreprint ? `<span class="pill red">Preprint</span>` : ""}
        ${p.isOpenAccess ? `<span class="pill green">Open access</span>` : ""}
      </div>
    </div>
    <button class="icon-btn ${p.starred ? "on" : ""}" data-action="star" data-id="${p.id}" title="${p.starred ? "Unstar" : "Star"}" style="align-self:start">${icon("star", 17, "", p.starred ? "currentColor" : "none")}</button>
  </div>`;
}

function paperListHtml() {
  const list = visiblePapers();
  if (list.length) return `<div class="card">${list.map(paperRow).join("")}</div>`;
  const t = topic();
  if (!S.papers.length)
    return `<div class="card empty"><h3>${t.status === "running" ? "Searching PubMed and Europe PMC…" : "No papers yet"}</h3><p>${
      t.status === "running" ? "New records will appear here as they are found." : `Nothing matched in the ${LOOKBACKS.find(([d]) => d === t.lookbackDays)?.[1].toLowerCase() || `last ${t.lookbackDays} days`}. Broaden the query or the look-back window.`
    }</p></div>`;
  return `<div class="card empty"><h3>No papers match these filters</h3></div>`;
}

function selectionBar() {
  const n = S.selected.size;
  return n ? `<div class="selbar"><span>${n} selected</span><button class="btn sm primary" data-action="analyse" data-type="compare" ${n < 2 ? "disabled" : ""}>Compare findings</button><button class="btn sm" data-action="clear-selection" style="color:var(--ink)">Clear</button></div>` : "";
}

function renderPapers() {
  const designs = [...new Set(S.papers.map((p) => p.extraction?.studyDesign).filter(Boolean))].sort();
  const f = S.filter;
  return `<div class="toolbar">
      <input class="input search" id="q" type="search" placeholder="Filter by title, author, text…" value="${esc(f.q)}">
      <select class="input" id="design"><option value="">All designs</option>${designs.map((d) => `<option ${d === f.design ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>
      <div class="toggle">${[["all", "All"], ["new", "New"], ["starred", "Starred"]].map(([v, l]) => `<button class="${f.show === v ? "active" : ""}" data-action="show" data-v="${v}">${l}</button>`).join("")}</div>
      <span class="spacer"></span>
      ${topic().counts.unread ? `<button class="btn ghost sm" data-action="mark-read">Mark all read</button>` : ""}
    </div>
    <div id="paper-list">${paperListHtml()}</div>
    <div id="selbar">${selectionBar()}</div>`;
}

// --------------------------------------------------------- evidence tab

function renderEvidence() {
  const rows = S.papers.filter((p) => p.extraction);
  if (!rows.length) return `<div class="card empty"><h3>No extracted studies yet</h3><p>The evidence table fills in as papers are found and analysed.</p></div>`;
  const { key, dir } = S.sort;
  const val = { year: (p) => p.year || 0, n: (p) => p.extraction.sampleSize ?? -1, design: (p) => p.extraction.studyDesign, study: (p) => p.authors[0] || "" }[key];
  rows.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  const th = (k, label) => `<th data-sort="${k}" data-action="sort">${label}${key === k ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`;
  const heuristic = rows.some((p) => p.extractionEngine === "heuristic");
  return `<div class="toolbar">
      <span class="sub" style="margin:0">${rows.length} stud${rows.length === 1 ? "y" : "ies"} · extracted from abstracts</span>
      <span class="spacer"></span>
      <a class="btn sm" href="/api/topics/${S.topicId}/evidence.csv">${icon("down", 14)} Export CSV</a>
    </div>
    ${heuristic ? `<div class="banner info">Some rows were filled by rule-based extraction, which only detects study design, sample size and result sentences. ${S.ai.available ? `<button class="btn sm" data-action="reextract-all" style="margin-left:auto">Re-extract with ${esc(S.ai.model)}</button>` : `<button class="btn sm" data-action="settings" style="margin-left:auto">Connect an AI model</button>`}</div>` : ""}
    <div class="card table-wrap"><table class="ev">
      <thead><tr>${th("study", "Study")}${th("design", "Design")}${th("n", "N")}<th>Population</th><th>Intervention / exposure</th><th>Key results</th><th>Conclusion</th><th>Certainty</th></tr></thead>
      <tbody>${rows
        .map((p) => {
          const e = p.extraction;
          return `<tr data-action="open-paper" data-id="${p.id}">
            <td class="study"><b>${esc(p.authors[0] || "Anonymous")}${p.authors.length > 1 ? " et al." : ""} ${esc(p.year || "")}</b><span>${esc(p.journal)}</span></td>
            <td>${esc(e.studyDesign)}${p.isPreprint ? `<br><span class="pill red" style="margin-top:4px">Preprint</span>` : ""}</td>
            <td class="num" title="${esc(e.sampleSizeText)}">${fmtN(e) || esc(e.sampleSizeText) || "—"}</td>
            <td class="mid">${esc(e.population) || "—"}</td>
            <td class="mid">${esc(e.intervention) || "—"}${e.comparator ? `<br><span style="color:var(--ink-3)">vs ${esc(e.comparator)}</span>` : ""}</td>
            <td class="wide">${e.keyResults.length ? `<ul>${e.keyResults.map((r) => `<li>${esc(r.finding)}${r.effect && !r.finding.includes(r.effect) ? ` <span class="stat-inline">${esc(r.effect)}</span>` : ""}</li>`).join("")}</ul>` : "—"}</td>
            <td class="wide">${esc(e.conclusion) || "—"}</td>
            <td>${levelPill(e) || "—"}</td>
          </tr>`;
        })
        .join("")}</tbody>
    </table></div>`;
}

// -------------------------------------------------------- analysis tabs

const ANALYSIS = {
  compare: { title: "Compare findings", verb: "Compare", min: 2, blurb: "See where studies agree, where they conflict, and why. Select papers in the Papers tab to compare a subset, or compare the whole topic." },
  gaps: { title: "Research gaps", verb: "Analyse gaps", min: 3, blurb: "Find the populations, comparators, outcomes and designs this body of work leaves open." },
  review: { title: "Literature review", verb: "Generate review", min: 2, blurb: "Draft a structured narrative review with numbered references and an evidence table." },
};

function renderAnalysis(type) {
  const spec = ANALYSIS[type];
  const list = S.analyses.filter((a) => a.type === type);
  const current = list.find((a) => a.id === S.shown[type]) || list[0];
  const usingSelection = type === "compare" && S.selected.size >= 2;
  const n = usingSelection ? S.selected.size : S.papers.length;
  const runBtn = `<button class="btn primary" data-action="analyse" data-type="${type}" ${n < spec.min || current?.status === "running" ? "disabled" : ""}>${icon("spark")} ${spec.verb}${type === "compare" ? ` ${usingSelection ? `${n} selected` : `all ${n}`}` : ""}</button>`;

  if (!current)
    return `<div class="card empty"><h3>${spec.title}</h3><p style="max-width:520px;margin:0 auto 18px">${spec.blurb}</p>${runBtn}${n < spec.min ? `<p class="sub" style="font-size:13px;margin-top:10px">Needs at least ${spec.min} papers.</p>` : ""}</div>`;

  const head = `<div class="analysis-head">
      ${list.length > 1 ? `<select class="input" id="history" data-type="${type}">${list.map((a) => `<option value="${a.id}" ${a.id === current.id ? "selected" : ""}>${new Date(a.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${a.references.length} papers</option>`).join("")}</select>` : `<span class="sub" style="margin:0">${new Date(current.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${current.references.length} papers</span>`}
      ${enginePill(current.engine, current.model)}
      <span class="spacer"></span>
      ${type === "review" && current.status === "done" ? `<a class="btn sm" href="/api/analyses/${current.id}/review.md">${icon("down", 14)} Markdown</a>` : ""}
      <button class="btn ghost sm danger" data-action="delete-analysis" data-id="${current.id}" title="Delete">${icon("trash", 14)}</button>
      ${runBtn}
    </div>`;

  let body;
  if (current.status === "running")
    body = `<div class="card working"><div class="pulse"></div><div><b>${type === "review" ? "Writing the review" : "Analysing"} ${current.references.length} papers…</b><br>This can take a few minutes. You can leave this tab.</div></div>`;
  else if (current.status === "error") body = `<div class="banner err">${esc(current.error)}</div>`;
  else body = { compare: compareBody, gaps: gapsBody, review: reviewBody }[type](current);
  return head + body;
}

const refList = (a) => `<ol class="refs">${a.references.map((r) => `<li id="ref-${r.n}"><b>${r.n}</b><span>${esc(r.text)} <a href="${esc(r.url)}" target="_blank" rel="noopener">Open</a></span></li>`).join("")}</ol>`;
const refsBlock = (a) => `<div class="block"><h3>Studies</h3>${refList(a)}</div>`;

function compareBody(a) {
  const r = a.result;
  return `<div class="card pad">
    <p class="lead">${inline(r.summary)}</p>
    ${r.agreements.length ? `<div class="block"><h3>Where studies agree</h3>${r.agreements.map((x) => `<div class="item agree"><p>${inline(x.point)} ${cites(x.refs)}</p></div>`).join("")}</div>` : ""}
    ${r.conflicts.length ? `<div class="block"><h3>Where they conflict</h3>${r.conflicts.map((x) => `<div class="item conflict"><h4>${inline(x.point)}</h4>${(x.positions || []).map((p) => `<div class="stance"><span>${cites(p.refs)}</span><span>${inline(p.stance)}</span></div>`).join("")}${x.likelyExplanation ? `<p class="why"><b>Likely explanation:</b> ${inline(x.likelyExplanation)}</p>` : ""}</div>`).join("")}</div>` : ""}
    ${r.methodDifferences.length ? `<div class="block"><h3>Methodological differences</h3>${r.methodDifferences.map((x) => `<div class="item method"><h4>${inline(x.aspect)}</h4><p>${inline(x.detail)} ${cites(x.refs)}</p></div>`).join("")}</div>` : ""}
    ${r.strengthOfEvidence ? `<div class="block"><h3>Strength of evidence</h3><p>${inline(r.strengthOfEvidence)}</p></div>` : ""}
    ${refsBlock(a)}
  </div>`;
}

function gapsBody(a) {
  const r = a.result;
  const colour = { high: "red", medium: "gold", low: "" };
  return `<p class="lead" style="margin-bottom:18px">${inline(r.overview)}</p>
    ${r.gaps.length ? `<div class="gap-grid">${r.gaps
      .map(
        (g) => `<div class="card gap">
          <div style="display:flex;gap:6px"><span class="pill ${colour[g.priority]}">${esc(g.priority)} priority</span><span class="pill outline">${esc(g.type)}</span></div>
          <h4>${inline(g.title)}</h4>
          <p>${inline(g.description)} ${cites(g.refs)}</p>
          ${g.suggestedStudy ? `<div class="suggest"><b>Study that would close it:</b> ${inline(g.suggestedStudy)}</div>` : ""}
        </div>`
      )
      .join("")}</div>` : `<div class="card empty">No gaps were flagged.</div>`}
    <div class="card pad" style="margin-top:18px">${refsBlock(a).replace('class="block"', "")}</div>`;
}

function reviewBody(a) {
  return `<div class="card pad" style="padding:40px 28px"><article class="prose">
    ${markdown(a.result.markdown)}
    <h2>References</h2>${refList(a)}
  </article></div>`;
}

// --------------------------------------------------------------- drawer

function renderDrawer() {
  const p = S.drawerId && paperById(S.drawerId);
  if (!p) return ($("#drawer").innerHTML = "");
  const e = p.extraction;
  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : "");
  const sections = p.abstractSections?.length ? p.abstractSections : [{ label: "", text: p.abstract }];
  const scroll = $(".drawer")?.scrollTop;
  $("#drawer").innerHTML = `<div class="scrim" data-action="close-drawer"></div>
  <aside class="drawer" ${scroll != null ? 'style="animation:none"' : ""}>
    <div class="drawer-head">
      <button class="icon-btn ${p.starred ? "on" : ""}" data-action="star" data-id="${p.id}" title="Star">${icon("star", 18, "", p.starred ? "currentColor" : "none")}</button>
      <a class="btn sm" href="${esc(p.url)}" target="_blank" rel="noopener">${icon("ext", 14)} ${p.sources.includes("pubmed") ? "PubMed" : "Europe PMC"}</a>
      ${p.doi ? `<a class="btn sm" href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">${icon("ext", 14)} DOI</a>` : ""}
      <span style="flex:1"></span>
      <button class="btn ghost sm" data-action="re-extract" data-id="${p.id}" ${p.extractionStatus === "pending" ? "disabled" : ""}>${icon("refresh", 14, p.extractionStatus === "pending" ? "spin" : "")} Re-extract</button>
      <button class="btn ghost sm danger" data-action="exclude" data-id="${p.id}" title="Remove this paper from your library">Remove</button>
      <button class="icon-btn" data-action="close-drawer" title="Close">${icon("x", 18)}</button>
    </div>
    <div class="drawer-body">
      <h2>${esc(p.title)}</h2>
      <p class="sub">${esc(p.authors.slice(0, 12).join(", "))}${p.authors.length > 12 ? ", et al." : ""}</p>
      <p class="sub"><em>${esc(p.journal)}</em> · ${esc(p.pubDate || p.year || "n.d.")}${p.pmid ? ` · PMID ${esc(p.pmid)}` : ""}</p>
      <div class="meta-row">
        ${e ? `<span class="pill accent">${esc(e.studyDesign)}</span>` : ""}${levelPill(e)}
        ${p.isPreprint ? `<span class="pill red">Preprint — not peer reviewed</span>` : ""}
        ${p.sources.map((s) => `<span class="pill outline">${s === "pubmed" ? "PubMed" : "Europe PMC"}</span>`).join("")}
        ${e ? enginePill(p.extractionEngine, p.extractionModel) : ""}
      </div>
      ${p.extractionStatus === "error" ? `<div class="banner err" style="margin-top:14px">Extraction failed: ${esc(p.extractionError)}</div>` : ""}
      ${e ? `
        <div class="block"><h3>Study</h3><dl class="kv">
          ${row("Sample size", esc(e.sampleSizeText || fmtN(e)))}
          ${row("Population", esc(e.population))}
          ${row("Intervention", esc(e.intervention))}
          ${row("Comparator", esc(e.comparator))}
          ${row("Outcomes", esc(e.outcomes.join("; ")))}
          ${row("Methods", esc(e.methods))}
        </dl></div>
        ${e.keyResults.length ? `<div class="block"><h3>Key results</h3>${e.keyResults.map((r) => `<div class="result"><span class="dir ${r.direction}" title="${DIRS[r.direction] || ""}"></span>${esc(r.finding)}${r.effect && !r.finding.includes(r.effect) ? `<div class="stat-inline" style="margin:3px 0 0 14px">${esc(r.effect)}</div>` : ""}</div>`).join("")}</div>` : ""}
        ${e.conclusion ? `<div class="block"><h3>Conclusion</h3><p class="lead" style="font-size:16px">${esc(e.conclusion)}</p></div>` : ""}
        ${e.limitations.length ? `<div class="block"><h3>Limitations</h3><ul style="margin:0;padding-left:18px">${e.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>` : ""}` : ""}
      <div class="block"><h3>Abstract</h3><div class="abstract">${p.abstract ? sections.map((s) => `<p>${s.label ? `<b>${esc(s.label)}</b><br>` : ""}${esc(s.text)}</p>`).join("") : "<p>No abstract available.</p>"}</div></div>
      ${p.mesh?.length ? `<div class="block"><h3>MeSH terms</h3><div class="chips">${p.mesh.map((m) => `<span class="pill">${esc(m)}</span>`).join("")}</div></div>` : ""}
    </div>
  </aside>`;
  if (scroll != null) $(".drawer").scrollTop = scroll;
}

// ----------------------------------------------------------- topic form

function openForm(existing) {
  S.form = existing
    ? { ...existing, domains: [...existing.domains], studyTypes: [...existing.studyTypes], sources: [...existing.sources] }
    : { name: "", query: "", domains: [], studyTypes: [], sources: S.meta.sources.map((s) => s.id), includePreprints: false, englishOnly: false, humansOnly: false, lookbackDays: 30, intervalHours: 24, maxPerRun: 25 };
  const f = S.form;
  const chips = (field, list) => `<div class="chips">${list.map((x) => `<button type="button" class="chip ${f[field].includes(x.id) ? "on" : ""}" data-action="chip" data-field="${field}" data-id="${x.id}">${esc(x.label)}</button>`).join("")}</div>`;
  const flag = (field, label) => `<button type="button" class="chip ${f[field] ? "on" : ""}" data-action="flag" data-field="${field}">${label}</button>`;
  const select = (field, opts) => `<select class="input" name="${field}">${opts.map(([v, l]) => `<option value="${v}" ${f[field] === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  $("#modal").innerHTML = `<div class="modal"><div class="scrim" data-action="close-modal"></div>
    <form id="topic-form">
      <div class="modal-head"><h2>${existing ? "Edit topic" : "New monitored topic"}</h2><p class="sub">The agent searches for this on a schedule and analyses every new paper.</p></div>
      <div class="modal-body">
        <div class="field"><label for="f-query">Search query</label>
          <textarea class="input" id="f-query" name="query" required placeholder='e.g. semaglutide AND "heart failure"'>${esc(f.query)}</textarea>
          <div class="hint">Keywords with AND / OR / NOT and "quoted phrases" work in both sources.</div></div>
        <div class="field"><label for="f-name">Name</label><input class="input" id="f-name" name="name" value="${esc(f.name)}" placeholder="Optional — defaults to the query"></div>
        <div class="field"><div class="label">Domains</div>${chips("domains", S.meta.domains)}<div class="hint">Limit results to one or more fields. Leave empty for any domain.</div></div>
        <div class="field"><div class="label">Study types</div>${chips("studyTypes", S.meta.studyTypes)}</div>
        <div class="field"><div class="label">Sources and limits</div><div class="chips">
          ${S.meta.sources.map((x) => `<button type="button" class="chip ${f.sources.includes(x.id) ? "on" : ""}" data-action="chip" data-field="sources" data-id="${x.id}">${esc(x.label)}</button>`).join("")}
          ${flag("includePreprints", "Include preprints")}${flag("englishOnly", "English only")}${flag("humansOnly", "Humans only")}
        </div></div>
        <div class="grid-3">
          <div class="field"><label>First search covers</label>${select("lookbackDays", LOOKBACKS)}</div>
          <div class="field"><label>Check for new papers</label>${select("intervalHours", SCHEDULES)}</div>
          <div class="field"><label>Max per source, per check</label>${select("maxPerRun", [[10, "10"], [25, "25"], [50, "50"], [100, "100"]])}</div>
        </div>
        <div class="preview" id="preview"><div><b>Query preview</b>Type a query to see what will be sent.</div></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button class="btn primary">${existing ? "Save changes" : "Start monitoring"}</button>
      </div>
    </form></div>`;
  $("#f-query").focus();
  updatePreview();
}

function readForm() {
  const form = $("#topic-form");
  const f = S.form;
  f.query = form.query.value;
  f.name = form.name.value;
  for (const k of ["lookbackDays", "intervalHours", "maxPerRun"]) f[k] = Number(form[k].value);
  return f;
}

let previewTimer;
function updatePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const f = readForm();
    if (!f.query.trim() || !$("#preview")) return;
    try {
      const q = await api("/preview", { method: "POST", body: f });
      if (!$("#preview")) return;
      $("#preview").innerHTML = `${f.sources.includes("pubmed") ? `<div><b>PubMed</b>${esc(q.pubmed)}</div>` : ""}${f.sources.includes("europepmc") ? `<div><b>Europe PMC</b>${esc(q.europepmc)}</div>` : ""}`;
    } catch {}
  }, 250);
}

// ------------------------------------------------------------- settings

function openSettings() {
  const ai = S.ai;
  S.aiForm = { provider: ai.provider === "none" ? "anthropic" : ai.provider };
  $("#modal").innerHTML = `<div class="modal"><div class="scrim" data-action="close-modal"></div>
    <form id="settings-form">
      <div class="modal-head"><h2>AI model</h2><p class="sub">Choose which model reads the abstracts and writes comparisons, gap analyses and reviews.</p></div>
      <div class="modal-body">
        <div class="field"><div class="label">Provider</div><div class="chips">${ai.providers.map((p) => `<button type="button" class="chip" data-action="provider" data-id="${p.id}">${esc(p.label)}</button>`).join("")}</div></div>
        <div class="field"><label for="s-key">API key</label><input class="input" id="s-key" name="apiKey" type="password" autocomplete="off" spellcheck="false"><div class="hint" id="s-key-hint"></div></div>
        <div class="field" id="s-url-field"><label for="s-url">Base URL</label><input class="input" id="s-url" name="baseUrl" spellcheck="false" placeholder="https://your-server.example/v1"><div class="hint">The address of an OpenAI-compatible API, ending before <code>/chat/completions</code>.</div></div>
        <div class="field"><label for="s-model">Model</label>
          <div style="display:flex;gap:8px"><input class="input" id="s-model" name="model" list="s-models" spellcheck="false" autocomplete="off"><button type="button" class="btn" data-action="load-models">Load list</button></div>
          <datalist id="s-models"></datalist><div class="hint" id="s-model-hint"></div></div>
        <div id="s-result"></div>
        <p class="hint">The key is saved on this computer only, in the app's data folder, and is sent to nothing but the provider you choose.${ai.source === "env" ? " The current configuration comes from environment variables; saving here overrides it." : ""}</p>
      </div>
      <div class="modal-foot">
        ${ai.source === "settings" ? `<button type="button" class="btn ghost danger" data-action="disconnect-ai" style="margin-right:auto">Disconnect</button>` : ""}
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button type="button" class="btn" data-action="test-ai">Test connection</button>
        <button class="btn primary">Save</button>
      </div>
    </form></div>`;
  const form = $("#settings-form");
  form.baseUrl.value = ai.baseUrl || "";
  form.model.value = ai.model || "";
  showProvider(true);
}

function showProvider(keepValues) {
  const form = $("#settings-form");
  const p = S.ai.providers.find((x) => x.id === S.aiForm.provider);
  const isCurrent = S.ai.provider === p.id;
  for (const el of form.querySelectorAll("[data-action=provider]")) el.classList.toggle("on", el.dataset.id === p.id);
  if (!keepValues || !isCurrent) {
    form.baseUrl.value = isCurrent ? S.ai.baseUrl : p.baseUrl;
    form.model.value = isCurrent ? S.ai.model : p.defaultModel;
    form.apiKey.value = "";
    $("#s-models").innerHTML = "";
  }
  $("#s-url-field").hidden = p.kind !== "openai";
  form.apiKey.placeholder = isCurrent && S.ai.hasKey ? "Saved — leave blank to keep it" : p.keyOptional ? "Optional for this provider" : "Paste your key";
  $("#s-key-hint").textContent = p.id === "ollama" ? "Ollama runs on your own machine and needs no key." : "";
  $("#s-model-hint").textContent = p.defaultModel ? `Default: ${p.defaultModel}.` : "Type the model name exactly as the provider lists it, or load the list.";
  $("#s-result").innerHTML = "";
}

function settingsBody() {
  const form = $("#settings-form");
  return { provider: S.aiForm.provider, apiKey: form.apiKey.value.trim(), baseUrl: form.baseUrl.value.trim(), model: form.model.value.trim() };
}

async function withButton(el, label, fn) {
  const original = el.innerHTML;
  el.disabled = true;
  el.innerHTML = `${icon("refresh", 14, "spin")} ${label}`;
  try {
    await fn();
  } catch (err) {
    $("#s-result").innerHTML = `<div class="banner err" style="margin:0">${esc(err.message)}</div>`;
  } finally {
    el.disabled = false;
    el.innerHTML = original;
  }
}

async function reloadSettings() {
  S.ai = await api("/settings");
  renderSidebar();
}

// --------------------------------------------------------------- render

function render() {
  renderSidebar();
  const main = $("#main");
  const scroll = main.scrollTop;
  const focused = document.activeElement?.id;
  main.innerHTML = S.topicId ? renderTopic() : renderOverview();
  main.scrollTop = scroll;
  if (focused === "q" && $("#q")) {
    const el = $("#q");
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
  renderDrawer();
}

function route() {
  const [, kind, id, tab] = location.hash.split("/");
  const nextId = kind === "t" ? id : null;
  if (nextId !== S.topicId) {
    Object.assign(S, { topicId: nextId, papers: [], analyses: [], selected: new Set(), filter: { q: "", design: "", show: "all" }, drawerId: null });
    $("#main").scrollTop = 0;
  }
  S.tab = TABS.some(([t]) => t === tab) ? tab : "papers";
  render();
  refresh(true);
}

// -------------------------------------------------------------- actions

const patchPaper = (id, body) => api(`/papers/${id}`, { method: "PATCH", body });

const actions = {
  go: (el) => (location.hash = el.dataset.href),
  "new-topic": () => openForm(),
  "edit-topic": () => openForm(topic()),
  "close-modal": () => ($("#modal").innerHTML = ""),
  settings: () => openSettings(),
  provider(el) {
    S.aiForm.provider = el.dataset.id;
    showProvider();
  },
  "load-models": (el) =>
    withButton(el, "Loading", async () => {
      const { models } = await api("/settings/models", { method: "POST", body: settingsBody() });
      $("#s-models").innerHTML = models.map((m) => `<option value="${esc(m)}">`).join("");
      $("#s-result").innerHTML = `<div class="banner ok" style="margin:0">${models.length} models available. Click the Model field to choose one.</div>`;
    }),
  "test-ai": (el) =>
    withButton(el, "Testing", async () => {
      await api("/settings/test", { method: "POST", body: settingsBody() });
      $("#s-result").innerHTML = `<div class="banner ok" style="margin:0">Connected — the model answered.</div>`;
    }),
  async "disconnect-ai"() {
    await api("/settings", { method: "PUT", body: { provider: "none" } });
    $("#modal").innerHTML = "";
    await reloadSettings();
    render();
  },
  async "reextract-all"() {
    const { queued } = await api(`/topics/${S.topicId}/reextract`, { method: "POST" });
    toast(`Re-extracting ${queued} paper${queued === 1 ? "" : "s"}`);
    await refresh();
  },
  "close-drawer": () => {
    S.drawerId = null;
    renderDrawer();
  },
  async "delete-topic"() {
    const t = topic();
    if (!confirm(`Delete “${t.name}” with its papers and analyses?`)) return;
    await api(`/topics/${t.id}`, { method: "DELETE" });
    location.hash = "#/";
  },
  async run() {
    await api(`/topics/${S.topicId}/run`, { method: "POST" });
    await refresh();
  },
  async "mark-read"() {
    await api(`/topics/${S.topicId}/seen`, { method: "POST" });
    await refresh();
  },
  show(el) {
    S.filter.show = el.dataset.v;
    render();
  },
  select(el) {
    S.selected[el.checked ? "add" : "delete"](el.dataset.id);
    $("#selbar").innerHTML = selectionBar();
  },
  "clear-selection"() {
    S.selected.clear();
    render();
  },
  async star(el) {
    const p = paperById(el.dataset.id);
    p.starred = !p.starred;
    render();
    await patchPaper(p.id, { starred: p.starred });
  },
  async "open-paper"(el) {
    S.drawerId = el.dataset.id;
    renderDrawer();
    const p = paperById(S.drawerId);
    if (p?.isNew) {
      await patchPaper(p.id, { isNew: false });
      await refresh();
    }
  },
  async "re-extract"(el) {
    await api(`/papers/${el.dataset.id}/extract`, { method: "POST" });
    await refresh();
  },
  async exclude(el) {
    if (!confirm("Remove this paper? It will not be added again.")) return;
    await patchPaper(el.dataset.id, { excluded: true });
    S.drawerId = null;
    S.selected.delete(el.dataset.id);
    await refresh();
  },
  cite(el) {
    const type = S.tab;
    const a = S.analyses.find((x) => x.id === S.shown[type]) || S.analyses.find((x) => x.type === type);
    const ref = a?.references.find((r) => r.n === Number(el.dataset.n));
    if (!ref || !paperById(ref.paperId)) return toast(`Reference ${el.dataset.n} is not in this analysis.`, true);
    S.drawerId = ref.paperId;
    renderDrawer();
  },
  sort(el) {
    const key = el.dataset.sort;
    S.sort = { key, dir: S.sort.key === key ? -S.sort.dir : key === "study" || key === "design" ? 1 : -1 };
    render();
  },
  async analyse(el) {
    const type = el.dataset.type;
    const paperIds = type === "compare" && S.selected.size >= 2 ? [...S.selected] : undefined;
    const a = await api(`/topics/${S.topicId}/analyses`, { method: "POST", body: { type, paperIds } });
    S.shown[type] = a.id;
    if (S.tab !== type) location.hash = `#/t/${S.topicId}/${type}`;
    await refresh();
  },
  async "delete-analysis"(el) {
    if (!confirm("Delete this analysis?")) return;
    await api(`/analyses/${el.dataset.id}`, { method: "DELETE" });
    await refresh();
  },
  chip(el) {
    const list = S.form[el.dataset.field];
    const i = list.indexOf(el.dataset.id);
    i < 0 ? list.push(el.dataset.id) : list.splice(i, 1);
    el.classList.toggle("on", i < 0);
    updatePreview();
  },
  flag(el) {
    S.form[el.dataset.field] = !S.form[el.dataset.field];
    el.classList.toggle("on", S.form[el.dataset.field]);
    updatePreview();
  },
};

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  // A click on the checkbox or star inside a paper row must not also open it.
  if (el.tagName !== "INPUT" && !el.matches("a")) ev.preventDefault();
  guard(actions[el.dataset.action])(el);
});

document.addEventListener("input", (ev) => {
  if (ev.target.id === "q") {
    S.filter.q = ev.target.value;
    $("#paper-list").innerHTML = paperListHtml();
  } else if (ev.target.closest("#topic-form")) updatePreview();
});

document.addEventListener("change", (ev) => {
  if (ev.target.id === "design") {
    S.filter.design = ev.target.value;
    render();
  } else if (ev.target.id === "history") {
    S.shown[ev.target.dataset.type] = ev.target.value;
    render();
  }
});

document.addEventListener(
  "submit",
  guard(async (ev) => {
    ev.preventDefault();
    if (ev.target.id === "settings-form") {
      await api("/settings", { method: "PUT", body: settingsBody() }).catch((err) => {
        $("#s-result").innerHTML = `<div class="banner err" style="margin:0">${esc(err.message)}</div>`;
        throw err;
      });
      $("#modal").innerHTML = "";
      await reloadSettings();
      render();
      return toast(`Using ${S.ai.model}`);
    }
    if (ev.target.id !== "topic-form") return;
    const f = readForm();
    const saved = f.id ? await api(`/topics/${f.id}`, { method: "PUT", body: f }) : await api("/topics", { method: "POST", body: f });
    $("#modal").innerHTML = "";
    toast(f.id ? "Topic updated" : "Monitoring started — searching now");
    if (location.hash === `#/t/${saved.id}/papers`) await refresh(true);
    else location.hash = `#/t/${saved.id}/papers`;
  })
);

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    if ($("#modal").innerHTML) actions["close-modal"]();
    else if (S.drawerId) actions["close-drawer"]();
  } else if (ev.key === "Enter" && ev.target.matches?.(".topic-card")) ev.target.click();
});

window.addEventListener("hashchange", route);

[S.meta, S.ai] = await Promise.all([api("/meta"), api("/settings")]);
route();
