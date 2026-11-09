# Research Agent

A personal scientific research assistant that keeps watching the literature for you.

- **Monitors PubMed and Europe PMC** on a schedule, with filters for domain (oncology, cardiology, neurology, …), study type, language, humans-only and preprints.
- **Finds newly published papers** and de-duplicates them across both sources by PMID and DOI.
- **Extracts** study design, population, sample size, intervention, comparator, outcomes, key results (with the reported statistics), conclusion and limitations from each abstract.
- **Builds an evidence table** you can sort and export as CSV.
- **Compares findings** across studies: agreements, conflicts with likely explanations, methodological differences.
- **Identifies research gaps**, prioritised, each with a study that would close it.
- **Writes structured literature reviews** with numbered references and an evidence table, exportable as Markdown.

## Run it

Requires Node.js 22 or newer.

```bash
npm install
cp .env.example .env   # then add your ANTHROPIC_API_KEY
npm start
```

Open http://localhost:3000, create a topic, and the first search starts immediately.

Without an `ANTHROPIC_API_KEY` the app still runs in **heuristic mode**: rule-based extraction (design, sample size, result sentences) and template summaries, clearly labelled in the UI. Extraction, comparison, gap analysis and reviews are far better with Claude connected.

To try the interface offline with synthetic fixture papers instead of live sources:

```bash
npm run demo
```

## Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables Claude extraction and synthesis |
| `ANTHROPIC_MODEL` | Model to use (default `claude-opus-5-5`) |
| `ANTHROPIC_REFUSAL_FALLBACK` | `off` disables server-side refusal fallbacks (on by default, so a declined biomedical abstract is retried on a fallback model rather than failing) |
| `NCBI_API_KEY`, `NCBI_EMAIL` | Optional; raise the PubMed rate limit and identify you to NCBI |
| `PORT`, `DATA_DIR` | Server port (3000) and data folder (`./data`) |

## How it works

```
server/
  index.js       HTTP API + static front end
  filters.js     domain / study-type filters → PubMed and Europe PMC query syntax
  sources.js     E-utilities and Europe PMC clients, normalised records, de-duplication
  monitor.js     scheduler, extraction queue, analyses, CSV / Markdown export
  ai.js          Claude prompts and structured-output schemas
  heuristics.js  rule-based fallbacks used without an API key
  store.js       JSON-file datastore (data/db.json)
public/          single-page UI (no build step)
test/            unit tests and offline fixtures
```

Design choices worth knowing:

- **References cannot be invented.** Reference numbers are assigned by the server before the model is called, and the reference list is generated from stored records, never by the model.
- **Abstracts only.** Extraction and synthesis read titles and abstracts, not full text. Treat the output as a first pass to verify, not a finished systematic review.
- **Each check re-scans a two-day overlap** so late-indexed papers are not missed; duplicates are dropped.
- Data stays on your machine in `data/db.json`. Abstracts are sent to the Anthropic API only when a key is configured.

## Tests

```bash
npm test
```

Covers the PubMed XML and Europe PMC parsers, query building, heuristic extraction, and the Claude request path against a local API stub.
