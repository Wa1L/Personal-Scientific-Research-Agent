# Research Agent

A personal scientific research assistant that keeps watching the literature for you.

- **Monitors PubMed and Europe PMC** on a schedule, with filters for domain (oncology, cardiology, neurology, …), study type, language, humans-only and preprints.
- **Finds newly published papers** and de-duplicates them across both sources by PMID and DOI.
- **Extracts** study design, population, sample size, intervention, comparator, outcomes, key results (with the reported statistics), conclusion and limitations from each abstract.
- **Builds an evidence table** you can sort and export as CSV.
- **Compares findings** across studies: agreements, conflicts with likely explanations, methodological differences.
- **Identifies research gaps**, prioritised, each with a study that would close it.
- **Writes structured literature reviews** with numbered references and an evidence table, exportable as Markdown.

## Download

Get the latest build from the [Releases page](https://github.com/Wa1L/Personal-Scientific-Research-Agent/releases/latest). Nothing else needs to be installed.

| System | File | How to start |
|---|---|---|
| Windows | `ResearchAgent-Setup-<version>.exe` | Run the installer, then open **Research Agent** from the Start menu |
| Windows (portable) | `research-agent-<version>-windows-x64.exe` | Double-click |
| macOS (Apple Silicon) | `research-agent-<version>-macos-arm64.tar.gz` | Unpack, then run the file from Terminal |
| Linux | `research-agent-<version>-linux-x64.tar.gz` | Unpack, then run the file |

The app opens in your browser and a small console window stays open while it runs; close that window to quit. Your data is kept in `%APPDATA%\Research Agent` (Windows), `~/Library/Application Support/Research Agent` (macOS) or `~/.local/share/research-agent` (Linux).

The builds are not code-signed. Windows SmartScreen will warn on first run (**More info → Run anyway**). On macOS, clear the download quarantine first: `xattr -d com.apple.quarantine research-agent-*`.

## Connect an AI model

Click the model box at the bottom of the sidebar, pick a provider, paste your key and choose a model. **Test connection** checks it before you save.

| Provider | Notes |
|---|---|
| Anthropic (Claude) | Defaults to `claude-opus-5-5` |
| OpenAI | |
| Google Gemini | Uses Gemini's OpenAI-compatible endpoint |
| OpenRouter | One key for many models |
| Ollama | Local models, no key |
| Custom | Any server that implements the OpenAI chat completions API: enter its base URL |

For every provider except Anthropic you choose the model yourself; **Load list** fetches the names your key can use.

Without a model the app still runs in **heuristic mode**: rule-based extraction (design, sample size, result sentences) and template summaries, clearly labelled in the UI. Once you connect a model, the evidence table offers to re-extract those papers.

## Run from source

Requires Node.js 22 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. `npm run demo` starts it offline with synthetic fixture papers instead of the live sources, and `npm run build` produces a standalone executable for your platform in `dist/`.

Providers can also be set through environment variables (see `.env.example`); settings saved in the app take priority.

| Variable | Purpose |
|---|---|
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` | Provider (`anthropic`, `openai`, `gemini`, `openrouter`, `ollama`, `custom`), key, model and base URL |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Shortcut for Anthropic |
| `NCBI_API_KEY`, `NCBI_EMAIL` | Optional; raise the PubMed rate limit and identify you to NCBI |
| `PORT`, `DATA_DIR` | Server port (3000) and data folder (`./data`) |

## Releasing

Pushing a tag such as `v1.2.0` runs `.github/workflows/release.yml`, which tests, builds the executables on Windows, macOS and Linux, builds the Windows installer, and attaches everything to a GitHub release.

## How it works

```
server/
  index.js       HTTP API + static front end
  filters.js     domain / study-type filters → PubMed and Europe PMC query syntax
  sources.js     E-utilities and Europe PMC clients, normalised records, de-duplication
  monitor.js     scheduler, extraction queue, analyses, CSV / Markdown export
  ai.js          prompts, schemas, Anthropic and OpenAI-compatible clients
  settings.js    AI provider settings
  heuristics.js  rule-based fallbacks used without a model
  store.js       JSON-file datastore (db.json in the data folder)
public/          single-page UI (no build step)
scripts/         executable build
installer/       Windows installer script
test/            unit tests and offline fixtures
```

Design choices worth knowing:

- **References cannot be invented.** Reference numbers are assigned by the server before the model is called, and the reference list is generated from stored records, never by the model.
- **Abstracts only.** Extraction and synthesis read titles and abstracts, not full text. Treat the output as a first pass to verify, not a finished systematic review.
- **Each check re-scans a two-day overlap** so late-indexed papers are not missed; duplicates are dropped.
- Data stays on your machine. Abstracts are sent only to the AI provider you connect, and the API key is stored locally in `settings.json` in the data folder.

## Tests

```bash
npm test
```

Covers the PubMed XML and Europe PMC parsers, query building, heuristic extraction, and both the Anthropic and OpenAI-compatible request paths against local API stubs.
