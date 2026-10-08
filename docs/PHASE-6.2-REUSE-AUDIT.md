# PHASE 6.2 REUSE AUDIT

Date 2026-10-08. Licence, stars and last push were read from the GitHub API on that date (unauthenticated). Vercel limits were read from https://vercel.com/docs/limits (page last updated 2026-09-16). Decision keys: REUSE · ADAPT · COMPOSE · REFERENCE · REJECT · BUILD. No code was copied from any project.

| # | Capability | Candidate | Licence | Stars | Last push | Relevance and what can / cannot be reused | Decision |
|---|---|---|---|---|---|---|---|
| 1 | Backtesting frameworks | zipline-reloaded (zipline-reloaded/zipline-reloaded) | repository not found under that name at audit time | n/a | n/a | Finance event-driven simulators; not verified | **REJECT** (cannot verify) |
| 1 | Backtesting frameworks | backtrader (mementum/backtrader) | GPL-3.0 | 23.4k | 2024-08-19 | Trading engine, GPL, unmaintained for two years | **REJECT** |
| 1 | Backtesting frameworks | vectorbt (polakowo/vectorbt) | NOASSERTION (custom licence) | 9.3k | 2026-09-26 | Vectorised trading backtests; licence not an OSI licence | **REJECT** |
| 1 | Time-series evaluation | sktime (sktime/sktime) | BSD-3-Clause | 10.1k | 2026-10-04 | Python. Its expanding-window / "as of cutoff" splitters are the textbook form of what we need (fit on data up to a cutoff only). Python, heavy, and our need is one slice | **REFERENCE** (the principle: a cutoff splitter that never reads past the cutoff) |
| 2 | Historical ranking systems | OSS Insight (pingcap/ossinsight) | Apache-2.0 | 2.5k | 2026-09-08 | Rankings need its event firehose, unavailable since 2026-03-01 (see COMPETITIVE-AUDIT.md); nothing to reuse for point-in-time evaluation | **REFERENCE** |
| 3 | GitHub repository tracking | github/linguist | MIT | 13.7k | 2026-09-29 | Language detection from file contents, not needed; `language` already comes from the API | **REJECT** |
| 4 | Star history analysis | star-history (star-history/star-history) | MIT | 9.6k | 2026-09-12 | Charts of star curves from the same endpoint we use; no ranking, no point-in-time evaluation | **REFERENCE** |
| 4 | Star history analysis | daily-stars-explorer (emanuelef/daily-stars-explorer) | MIT | 406 | 2026-10-04 | Daily star series client; we already store daily gains | **REFERENCE** |
| 5 | Discovery persistence (frontier / revisit) | Scrapy (scrapy/scrapy) | BSD-3-Clause | 64.6k | 2026-10-07 | Scheduler and dupe-filter concepts; far heavier than a 4,500-entry registry, Python | **REFERENCE** (frontier and revisit-policy ideas) |
| 5 | Discovery persistence | Crawlee (apify/crawlee) | Apache-2.0 | 26.0k | 2026-10-08 | Request queue with retry/skip states; a framework, our state is one JSON file | **REFERENCE** |
| 5 | Discovery persistence | Frontera (scrapinghub/frontera) | BSD-3-Clause | 1.3k | 2025-06-06 | Crawl frontier with revisit scheduling; unmaintained for a year | **REFERENCE** |
| 6 | Anomaly detection | PyOD (yzhao062/pyod) | BSD-2-Clause | 10.0k | 2026-10-04 | Outlier-detection models; Python, statistical, not explainable per repository. The Phase 6.1 pattern model needs to stay deterministic and explainable | **REJECT** |
| 6 | Anomaly detection | NAB (numenta/NAB) | MIT | 2.1k | 2024-12-03 | Benchmark for streaming anomaly detectors; useful as a reference for evaluating detectors | **REFERENCE** |
| 6 | Statistics in JS | simple-statistics | ISC | 3.5k | 2026-10-01 | Median, standard deviation; our metrics use a handful of one-line functions | **REJECT** (no dependency for a median) |
| 7 | Static data compression | Node `zlib` (gzip, brotli) | Node (MIT) | n/a | n/a | Already in the runtime; Vercel serves brotli/gzip transparently. Used to measure compressed sizes | **REUSE** |
| 7 | Static data compression | pako (nodeca/pako) | MIT | 6.1k | 2026-10-03 | In-browser gzip; not needed (browsers decompress natively) | **REJECT** |
| 7 | Static data compression | fflate (101arrowz/fflate) | MIT | 3.0k | 2026-05-16 | Same | **REJECT** |
| 7 | Columnar / analytic storage | DuckDB-Wasm (duckdb/duckdb-wasm) | MIT | 2.1k | 2026-09-29 | Querying Parquet in the browser; the site needs 90 numbers per page, not a query engine | **REJECT** for now (trigger documented in SIZE-AUDIT.md) |
| 7 | Columnar storage | parquet-wasm (kylebarron/parquet-wasm) | Apache-2.0 | 672 | 2026-09-29 | Parquet in the browser | **REJECT** for now |
| 8 | Static-site history visualisation | Existing inline SVG (Phase 6.1) | n/a | n/a | n/a | One bar chart, 12 lines of SVG, no JavaScript library | **REUSE** |
| 8 | Static-site history visualisation | uPlot (leeoniya/uPlot) | MIT | 10.5k | 2026-10-05 | Fast time-series charts; needed only for multi-series interactive charts | **REFERENCE** |
| 8 | Static-site history visualisation | Observable Plot (observablehq/plot) | ISC | 5.4k | 2026-09-01 | Declarative charts, needs D3 | **REFERENCE** |
| 8 | Static-site history visualisation | D3 (d3/d3) | ISC | 113.8k | 2026-05-28 | Scales and shapes; not needed for bars | **REFERENCE** |
| 9 | GitHub metadata retention | (candidate registry in `src/coverage`) | this repository | n/a | n/a | No maintained library keeps "previously discovered GitHub repositories" under a bounded policy; the registry is 90 lines of pure functions with the policy in configuration | **BUILD (small)** |
| 10 | Classification / taxonomy | github/explore (aliases) | CC-BY-4.0 | 4.9k | 2026-10-07 | Already used (attribution in THIRD_PARTY.md) | **REUSE** |
| 10 | Classification / taxonomy | oss-taxonomy (ecosyste-ms/oss-taxonomy) | CC0-1.0 | 43 | 2026-09-07 | Education/documentation vocabulary, used as a design influence in Phase 3 | **REFERENCE** |
| 10 | Classification | OSS Insight collections | Apache-2.0 (code), data licence unverified | n/a | n/a | 138 curated collections as a cross-check for missing categories | **REFERENCE** |
| 10 | Classification | ML text classifiers (scikit-learn etc.) | BSD | n/a | n/a | A learned model would trade explainability for recall, and the rules forbid an ML ranking; the experiment stays rule based | **REJECT** |
| 11 | Platform limits | Vercel Limits (vercel.com/docs/limits) | n/a | n/a | page updated 2026-09-16 | Authoritative source for the size audit | **REUSE** (as documentation) |
| 12 | Build output audit | Existing `pipeline size` command (this phase) | this repository | n/a | n/a | Walks `out/` and reports files, bytes, by extension, with brotli/gzip for the public data | **BUILD (small)** |

## Dependencies added
None (runtime or dev). New code uses Node built-ins only (`zlib`).

## Honest limits of this audit
Existence and licence of each repository were checked through the API on the date above; maintenance was judged from the last push and stars, not from reading the code. `zipline-reloaded` could not be found under the name searched, so no claim is made about it. Alternatives for steps 1, 6 and 9 were not surveyed beyond the entries listed; the build decisions rest on the requirement to remain deterministic, explainable and dependency-free, not on a market survey.
