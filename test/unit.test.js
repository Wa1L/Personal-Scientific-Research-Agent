import test from "node:test";
import assert from "node:assert/strict";
import { PUBMED_XML, EPMC_JSON } from "./mock-fetch.js";
import { parsePubmedXml, parseEpmcResult, keysOf, mergeRecord } from "../server/sources.js";
import { buildQueries } from "../server/filters.js";
import { heuristicExtract, heuristicGaps } from "../server/heuristics.js";

test("parses PubMed XML", () => {
  const [a, , , , e] = parsePubmedXml(PUBMED_XML);
  assert.equal(a.pmid, "90000001");
  assert.equal(a.doi, "10.5555/fixture.001");
  assert.deepEqual(a.authors.slice(0, 2), ["Okafor N", "Lindqvist S"]);
  assert.equal(a.pubDate, "2026-10-01");
  assert.equal(a.abstractSections.length, 4);
  assert.match(a.abstract, /RESULTS: .*P<0\.001/);
  assert.equal(e.title, "Tirzepatide improves diastolic function in a murine model of cardiometabolic heart failure");
});

test("parses Europe PMC results and merges duplicates by DOI/PMID", () => {
  const recs = EPMC_JSON.resultList.result.map(parseEpmcResult);
  assert.equal(recs[2].isPreprint, true);
  assert.equal(recs[2].journal, "medRxiv");
  assert.equal(recs[2].abstractSections[1].label, "METHODS");
  const pm = parsePubmedXml(PUBMED_XML)[0];
  assert.ok(keysOf(pm).some((k) => keysOf(recs[0]).includes(k)));
  const merged = mergeRecord(pm, recs[0]);
  assert.deepEqual(merged.sources, ["pubmed", "europepmc"]);
  assert.equal(merged.pmcid, "PMC0000001");
  assert.equal(merged.journal, "Fixture J Cardiol");
});

test("builds source queries from filters", () => {
  const q = buildQueries({ query: "semaglutide AND heart failure", domains: ["cardiology"], studyTypes: ["rct", "meta"], englishOnly: true, humansOnly: true, includePreprints: false });
  assert.equal(q.pubmed, '(semaglutide AND heart failure) AND ("Cardiovascular Diseases"[MeSH Terms]) AND ("Randomized Controlled Trial"[Publication Type] OR "Meta-Analysis"[Publication Type]) AND english[Language] AND "Humans"[MeSH Terms]');
  assert.match(q.europepmc, /PUB_TYPE:"Meta-Analysis"\) AND LANG:"eng" AND \(SRC:MED OR SRC:PMC\)$/);
});

test("heuristic extraction finds design, sample size and results", () => {
  const papers = parsePubmedXml(PUBMED_XML);
  const ex = papers.map(heuristicExtract);
  assert.deepEqual(ex.map((e) => e.sampleSize), [529, 48210, 64, 21460, 36]);
  assert.deepEqual(ex.map((e) => e.studyDesign), ["Randomized controlled trial", "Cohort study", "Randomized controlled trial", "Meta-analysis", "Animal study"]);
  assert.match(ex[1].keyResults[0].effect, /HR 0\.84/);
  assert.match(ex[0].conclusion, /improved exercise capacity/);
  papers.forEach((p, i) => (p.extraction = ex[i]));
  assert.ok(heuristicGaps(papers).gaps.some((g) => g.title === "Pediatric populations"));
});
