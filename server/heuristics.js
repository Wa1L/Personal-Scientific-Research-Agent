// Rule-based fallbacks used when no AI provider is configured.
// They only surface what is literally in the abstract; results are labelled
// "heuristic" in the UI so they are never mistaken for model analysis.

const DESIGN_RULES = [
  ["Meta-analysis", /meta-?analy/i],
  ["Systematic review", /systematic(?:ally)? review/i],
  ["Randomized controlled trial", /randomi[sz]ed|\bRCT\b/i],
  ["Clinical trial (non-randomized)", /clinical trial|phase (?:1|2|3|4|i{1,3}|iv)\b|single-arm|open-label/i],
  ["Cohort study", /cohort|longitudinal|prospective(?:ly)? follow/i],
  ["Case-control study", /case-control/i],
  ["Cross-sectional study", /cross-sectional|survey/i],
  ["Case report / series", /case report|case series/i],
  ["Animal study", /\b(?:mice|mouse|rats?|murine|zebrafish|in vivo)\b/i],
  ["In vitro study", /in vitro|cell lines?|organoid/i],
  ["Modelling / computational study", /simulation|in silico|machine learning|deep learning/i],
  ["Qualitative study", /qualitative|interviews?|focus groups?/i],
  ["Narrative review", /\breview\b/i],
];

export function guessDesign(paper) {
  const types = (paper.pubTypes || []).join(" ; ");
  for (const [label, re] of DESIGN_RULES) if (re.test(types)) return label;
  for (const [label, re] of DESIGN_RULES) if (re.test(paper.title)) return label;
  for (const [label, re] of DESIGN_RULES) if (re.test(paper.abstract)) return label;
  // Generic label, used only when nothing more specific was found.
  if (/observational|registry|retrospective/i.test(`${types} ${paper.title} ${paper.abstract}`)) return "Observational study";
  return "Not determined";
}

const UNITS =
  "patients|participants|subjects|individuals|adults|children|women|men|people|persons|cases|volunteers|infants|adolescents|respondents|students|mice|rats|animals|samples|specimens";
const num = (s) => Number(s.replace(/,/g, ""));

export function guessSampleSize(abstract) {
  const found = [];
  for (const m of abstract.matchAll(new RegExp(`\\b(\\d[\\d,]*)\\s+(?:[a-z-]+\\s+){0,3}?(${UNITS})\\b`, "gi")))
    found.push({ n: num(m[1]), text: m[0] });
  for (const m of abstract.matchAll(/\b[nN]\s*=\s*(\d[\d,]*)/g)) found.push({ n: num(m[1]), text: m[0] });
  const plausible = found.filter((f) => f.n > 1 && !(f.n >= 1900 && f.n <= 2100 && !/,/.test(f.text)));
  if (!plausible.length) {
    const studies = abstract.match(/\b(\d[\d,]*)\s+(?:[a-z-]+\s+){0,2}?(studies|trials|articles)\b/i);
    return { n: null, text: studies ? studies[0] : "" };
  }
  const best = plausible.reduce((a, b) => (b.n > a.n ? b : a));
  return { n: best.n, text: best.text };
}

const sentences = (t) => (t.match(/[^.!?]+(?:[.!?](?!\s|$)[^.!?]*)*[.!?]?/g) || []).map((s) => s.trim()).filter(Boolean);
const STAT = /(?:\b(?:HR|OR|RR|aOR|aHR|IRR|MD|SMD|AUC)\b[^;.]{0,60}?\d[^;,)]*|\d+(?:\.\d+)?\s?%\s?CI[^;)]*|[pP]\s?[<=>]\s?0?\.\d+)/;
const section = (paper, re) =>
  (paper.abstractSections || []).filter((s) => re.test(s.label)).map((s) => s.text).join(" ");

export function heuristicExtract(paper) {
  const abs = paper.abstract || "";
  const all = sentences(abs);
  const size = guessSampleSize(abs);
  const resultText = section(paper, /RESULT|FINDING/i);
  const resultSentences = resultText
    ? sentences(resultText)
    : all.filter((s) => STAT.test(s) || /significan|associated with|increase|decrease|reduc|improv/i.test(s));
  const conclusion = section(paper, /CONCLUSION|INTERPRETATION|DISCUSSION/i) || all.at(-1) || "";
  return {
    studyDesign: guessDesign(paper),
    population: "",
    sampleSize: size.n,
    sampleSizeText: size.text,
    intervention: "",
    comparator: "",
    outcomes: [],
    methods: section(paper, /METHOD|DESIGN|SETTING|PARTICIPANT/i),
    keyResults: resultSentences.slice(0, 4).map((s) => ({
      finding: s,
      effect: (s.match(STAT) || [""])[0].trim(),
      direction: "unclear",
    })),
    conclusion,
    limitations: [],
    evidenceLevel: "unrated",
  };
}

// ------------------------------------------------------ corpus-level fallbacks

const count = (items, f) => {
  const m = new Map();
  for (const it of items) m.set(f(it), (m.get(f(it)) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const designOf = (p) => p.extraction?.studyDesign || "Not determined";
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

export function heuristicCompare(papers) {
  const designs = count(papers, designOf);
  const sizes = papers.map((p) => p.extraction?.sampleSize).filter(Boolean);
  return {
    summary:
      `${papers.length} studies compared: ${designs.map(([d, n]) => `${n} × ${d.toLowerCase()}`).join(", ")}.` +
      (sizes.length ? ` Reported sample sizes range from ${Math.min(...sizes).toLocaleString()} to ${Math.max(...sizes).toLocaleString()}.` : "") +
      " Agreement and conflict between findings need model analysis — connect an AI provider in Settings to enable it.",
    agreements: [],
    conflicts: [],
    methodDifferences: designs.length > 1
      ? [{ aspect: "Study design", detail: designs.map(([d, n]) => `${d} (${n})`).join("; "), refs: [] }]
      : [],
    strengthOfEvidence: "",
  };
}

export function heuristicGaps(papers) {
  const gaps = [];
  const add = (title, description, type, priority) => gaps.push({ title, description, type, priority, refs: [], suggestedStudy: "" });
  const designs = new Map(count(papers, designOf));
  const has = (re) => [...designs.keys()].some((d) => re.test(d));
  const sizes = papers.map((p) => p.extraction?.sampleSize).filter(Boolean);
  const blob = papers.map((p) => `${p.title} ${p.abstract}`).join(" ");

  if (!has(/randomi/i)) add("No randomized evidence", `None of the ${papers.length} tracked studies is a randomized controlled trial, so causal claims rest on non-randomized designs.`, "Design", "high");
  if (!has(/meta-analysis|systematic/i) && papers.length >= 5) add("No quantitative synthesis", "No systematic review or meta-analysis is present in this corpus.", "Synthesis", "medium");
  if (sizes.length && median(sizes) < 100) add("Small samples", `Median reported sample size is ${median(sizes)}; estimates are likely imprecise.`, "Power", "medium");
  if (sizes.length < papers.length / 2) add("Sample sizes rarely reported", `Only ${sizes.length} of ${papers.length} abstracts state a sample size that could be detected.`, "Reporting", "low");
  if (!/long-term|follow-up of \d+ (?:years|months)|\d+-year follow/i.test(blob)) add("Long-term outcomes", "No abstract mentions long-term follow-up.", "Outcomes", "medium");
  if (!/child|pediatric|paediatric|adolescent/i.test(blob)) add("Pediatric populations", "No study mentions children or adolescents.", "Population", "low");
  if (!/older adults|elderly|aged 65|geriatric/i.test(blob)) add("Older adults", "No study mentions older or elderly populations.", "Population", "low");
  return {
    overview: "Rule-based screen of study designs, sample sizes and populations mentioned in the abstracts. Connect an AI provider in Settings for a reasoned gap analysis.",
    gaps,
  };
}

export function heuristicReview(topic, papers, refNo) {
  const cite = (p) => `[${refNo.get(p.id)}]`;
  const years = papers.map((p) => p.year).filter(Boolean);
  const out = [`# ${topic.name}: literature summary`, ""];
  out.push("## Scope", "", `This summary covers ${papers.length} publications${years.length ? ` (${[...new Set([Math.min(...years), Math.max(...years)])].join("–")})` : ""} retrieved for the query “${topic.query}”. It was assembled by rules from abstracts, without model analysis; connect an AI provider in Settings to generate a narrative review.`, "");
  out.push("## Evidence base", "");
  const groups = count(papers, designOf);
  for (const [d, n] of groups) out.push(`- **${d}**: ${n}`);
  out.push("");
  for (const [d] of groups) {
    out.push(`## ${d}`, "");
    for (const p of papers.filter((x) => designOf(x) === d)) {
      const e = p.extraction || {};
      const n = e.sampleSize ? ` (n = ${e.sampleSize.toLocaleString()})` : "";
      out.push(`- ${p.authors[0] || "Anonymous"}${p.authors.length > 1 ? " et al." : ""}${n}: ${e.conclusion || p.title} ${cite(p)}`);
    }
    out.push("");
  }
  const gaps = heuristicGaps(papers).gaps;
  if (gaps.length) {
    out.push("## Possible gaps", "");
    for (const g of gaps) out.push(`- **${g.title}.** ${g.description}`);
    out.push("");
  }
  return out.join("\n");
}
