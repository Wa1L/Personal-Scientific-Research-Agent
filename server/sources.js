// PubMed (NCBI E-utilities) and Europe PMC clients. Both return records in
// one normalized shape so the rest of the app is source-agnostic.
import { XMLParser } from "fast-xml-parser";
import { buildQueries, pubmedDate, epmcDateRange } from "./filters.js";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x) => (x == null ? "" : typeof x === "object" ? String(x["#text"] ?? "") : String(x));

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function stripMarkup(s) {
  return String(s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res.json();
}

const sectionsToAbstract = (sections) =>
  sections.map((s) => (s.label ? `${s.label}: ${s.text}` : s.text)).join("\n\n");

// ---------------------------------------------------------------- PubMed

function ncbiParams(extra) {
  const p = new URLSearchParams({ db: "pubmed", tool: "research-agent", ...extra });
  if (process.env.NCBI_API_KEY) p.set("api_key", process.env.NCBI_API_KEY);
  if (process.env.NCBI_EMAIL) p.set("email", process.env.NCBI_EMAIL);
  return p;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  // Titles and abstracts contain inline markup (<i>, <sup>); keep them raw.
  stopNodes: ["*.ArticleTitle", "*.AbstractText"],
  processEntities: true,
});

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function pubmedDateOf(pubDate) {
  if (!pubDate) return { year: null, date: null };
  const medline = text(pubDate.MedlineDate);
  const year = Number(text(pubDate.Year) || (medline.match(/\d{4}/) || [])[0]) || null;
  if (!year) return { year: null, date: null };
  const m = text(pubDate.Month);
  const month = Number(m) || MONTHS[m.slice(0, 3).toLowerCase()] || 1;
  const day = Number(text(pubDate.Day)) || 1;
  const pad = (n) => String(n).padStart(2, "0");
  return { year, date: `${year}-${pad(month)}-${pad(day)}` };
}

export function parsePubmedXml(xmlText) {
  const doc = xml.parse(xmlText);
  return arr(doc?.PubmedArticleSet?.PubmedArticle).map((a) => {
    const cit = a.MedlineCitation || {};
    const art = cit.Article || {};
    const journal = art.Journal || {};
    const issue = journal.JournalIssue || {};
    const ids = arr(a.PubmedData?.ArticleIdList?.ArticleId);
    const idOf = (type) => text(ids.find((i) => i["@IdType"] === type)) || null;
    const sections = arr(art.Abstract?.AbstractText)
      .map((s) => ({ label: typeof s === "object" ? s["@Label"] || "" : "", text: stripMarkup(text(s)) }))
      .filter((s) => s.text);
    const { year, date } = pubmedDateOf(issue.PubDate);
    const pmid = text(cit.PMID);
    return {
      pmid,
      pmcid: idOf("pmc"),
      doi: idOf("doi")?.toLowerCase() || null,
      title: stripMarkup(text(art.ArticleTitle)).replace(/\.$/, ""),
      abstract: sectionsToAbstract(sections),
      abstractSections: sections,
      authors: arr(art.AuthorList?.Author)
        .map((au) => text(au.CollectiveName) || [text(au.LastName), text(au.Initials)].filter(Boolean).join(" "))
        .filter(Boolean),
      journal: text(journal.ISOAbbreviation) || text(journal.Title),
      year,
      pubDate: date,
      volume: text(issue.Volume),
      issue: text(issue.Issue),
      pages: text(art.Pagination?.MedlinePgn),
      pubTypes: arr(art.PublicationTypeList?.PublicationType).map(text),
      mesh: arr(cit.MeshHeadingList?.MeshHeading).map((m) => text(m.DescriptorName)),
      isPreprint: false,
      sources: ["pubmed"],
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    };
  });
}

export async function searchPubmed(topic, from, to) {
  const { pubmed: term } = buildQueries(topic);
  const search = await getJSON(
    `${EUTILS}/esearch.fcgi?${ncbiParams({
      term,
      retmode: "json",
      retmax: String(topic.maxPerRun),
      datetype: "edat",
      mindate: pubmedDate(from),
      maxdate: pubmedDate(to),
    })}`
  );
  if (search.esearchresult?.ERROR) throw new Error(`PubMed: ${search.esearchresult.ERROR}`);
  const ids = search.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const res = await fetch(`${EUTILS}/efetch.fcgi`, {
    method: "POST",
    body: ncbiParams({ id: ids.join(","), retmode: "xml" }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from PubMed efetch`);
  return parsePubmedXml(await res.text());
}

// ------------------------------------------------------------ Europe PMC

function epmcSections(html) {
  if (!html) return [];
  if (!/<h4/i.test(html)) return [{ label: "", text: stripMarkup(html) }];
  const out = [];
  const re = /<h4[^>]*>(.*?)<\/h4>([\s\S]*?)(?=<h4|$)/gi;
  for (const m of html.matchAll(re)) {
    const body = stripMarkup(m[2]);
    if (body) out.push({ label: stripMarkup(m[1]).replace(/:$/, "").toUpperCase(), text: body });
  }
  return out;
}

export function parseEpmcResult(r) {
  const sections = epmcSections(r.abstractText);
  const j = r.journalInfo || {};
  const isPreprint = r.source === "PPR";
  return {
    pmid: r.pmid || null,
    pmcid: r.pmcid || null,
    doi: r.doi?.toLowerCase() || null,
    epmcId: `${r.source}:${r.id}`,
    title: stripMarkup(r.title).replace(/\.$/, ""),
    abstract: sectionsToAbstract(sections),
    abstractSections: sections,
    authors: arr(r.authorList?.author)
      .map((a) => a.collectiveName || [a.lastName, a.initials].filter(Boolean).join(" ") || a.fullName)
      .filter(Boolean),
    journal: j.journal?.isoabbreviation || j.journal?.title || (isPreprint ? r.bookOrReportDetails?.publisher || "Preprint" : ""),
    year: Number(r.pubYear) || null,
    pubDate: r.firstPublicationDate || null,
    volume: j.volume || "",
    issue: j.issue || "",
    pages: r.pageInfo || "",
    pubTypes: arr(r.pubTypeList?.pubType),
    mesh: arr(r.meshHeadingList?.meshHeading).map((m) => m.descriptorName).filter(Boolean),
    isPreprint,
    isOpenAccess: r.isOpenAccess === "Y",
    citedBy: r.citedByCount ?? null,
    sources: ["europepmc"],
    url: `https://europepmc.org/article/${r.source}/${r.id}`,
  };
}

export async function searchEuropePmc(topic, from, to) {
  const query = `${buildQueries(topic).europepmc} AND ${epmcDateRange(from, to)}`;
  const params = new URLSearchParams({
    query,
    format: "json",
    resultType: "core",
    pageSize: String(topic.maxPerRun),
    sort: "P_PDATE_D desc",
  });
  const json = await getJSON(`${EPMC}?${params}`);
  if (json.errCode) throw new Error(`Europe PMC: ${json.errMsg || json.errCode}`);
  return arr(json.resultList?.result).map(parseEpmcResult);
}

// ---------------------------------------------------------------- merge

export const SOURCES = {
  pubmed: { label: "PubMed", search: searchPubmed },
  europepmc: { label: "Europe PMC", search: searchEuropePmc },
};

/** Identity keys used to recognise the same paper across sources. */
export const keysOf = (r) =>
  [r.pmid && `pmid:${r.pmid}`, r.doi && `doi:${r.doi}`, r.epmcId && `epmc:${r.epmcId}`].filter(Boolean);

/** Fold `extra` into `base`, keeping base's values and filling what it lacks. */
export function mergeRecord(base, extra) {
  for (const [k, v] of Object.entries(extra)) {
    if (k === "sources") base.sources = [...new Set([...(base.sources || []), ...v])];
    else if (base[k] == null || base[k] === "" || (Array.isArray(base[k]) && !base[k].length)) base[k] = v;
  }
  return base;
}
