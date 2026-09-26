# LICENSE AUDIT — PHASE 1.5

Audit date 2026-09-24. "Read" = LICENSE file opened from a local clone. Not legal advice. Transitive dependency licenses were **not** audited for any candidate; a license scan (e.g. `license-checker` for npm, `go-licenses` for Go) is required before copying anything larger than a snippet.

| Candidate | (1) LICENSE file | (2) License | (3) Reuse permitted | (4) Attribution required | (5) Dependency risk | (6) Preserve notices when copying |
|---|---|---|---|---|---|---|
| patrick-creates/rising-repos-tracker | Yes, read | MIT, (c) 2026 patrick-creates | Yes | Yes (notice in copies) | Node scripts use no npm deps (built-in fetch/fs); dashboard loads Chart.js from a CDN (MIT). Not audited further | Yes — MIT text + copyright in copied files |
| emanuelef/daily-stars-explorer | Yes, read | MIT, (c) 2024 Emanuele Fumagalli | Yes | Yes | Go modules and React deps **not audited** | Yes. A TS port that closely follows structure -> list in THIRD_PARTY.md |
| star-history/star-history | Yes, read | MIT, (c) 2025 Star History | Yes | Yes | d3-*, dayjs, lodash, axios, Next 14 (MIT/ISC/BSD) — expected fine, **not scanned** | Yes |
| SahirVhora/trending-repo | Yes, read | MIT, (c) 2026 Sahir Vhora | Yes | Yes | Python/Flask deps not audited | Yes |
| bonfy/github-trending | Yes, read | MIT, (c) 2022 Kai Chen | Yes | Yes | pyquery, requests | Yes |
| Marcos66236/github-stars-history | Yes, read | MIT, (c) 2026 Marcos66236 | Yes | Yes | Python stdlib/requests | Yes. **Reputational concern** (promotes a star-selling site) — not copying |
| FayezBast/repometeor | Yes, read; NOTICE read | **Apache-2.0** | Yes | Yes: keep LICENSE, copyright and NOTICE attribution; state changes on modified files | Go/npm deps not audited; PostgreSQL is a runtime service, not linked | Yes. Patent grant included; trademark use not granted |
| HalcyonVector/GitHub-Trending-Intelligence- | Yes, read | MIT, (c) 2026 Sagnik (@halcyon-vector) | Yes | Yes | Python/npm deps not audited | Yes — for the category seed lists we copy |
| caarlos0/starcharts | **No LICENSE file in the tree** (`git ls-files`) | **Unresolved** (README not checked) | **No — unresolved** | n/a | n/a | **Copy nothing** |
| vitalets/github-trending-repos (Phase 0) | No | None -> all rights reserved | No | n/a | n/a | Copy nothing |
| isboyjc/github-trending-api (Phase 0) | **Not seen** (checkout failed on Windows-invalid filenames) | MIT per GitHub API metadata only | Not until file confirmed | Yes | n/a | Verify via raw URL first |
| bowjoww/repotide (Phase 0) | Yes, read | MIT, (c) 2026 Joow Labs | Yes | Yes | cheerio (MIT) | Yes |
| pingcap/ossinsight (Phase 0) | Yes, fetched | Apache-2.0 | Yes (code); **API data has no stated license** | Yes | n/a — we call its API only | n/a |

## Rules we will follow
1. **Never copy code from an unresolved license** (starcharts, vitalets, isboyjc until confirmed).
2. **THIRD_PARTY.md** lists every adapted item: source repo, commit SHA, license, what was taken, what was changed.
3. **Apache-2.0 (RepoMeteor):** we intend to reuse the *design* (formula structure, collections). The formula description is an idea; a close translation of Go code or verbatim doc text is derivative. If any code or doc text is ported, include the Apache-2.0 notice, mark modifications, and reproduce NOTICE attribution. Mixing MIT (our code) and Apache-2.0 parts is compatible when notices are preserved.
4. **Data:** GitHub API data (`stargazers/history`) is public aggregate data; attribute GitHub. Category seed lists from Trending-Intelligence are MIT-licensed data — keep the notice.
5. **Dependencies:** run a license scan on the Phase 2 lockfile; reject GPL/AGPL/SSPL.
6. **Reputation check:** do not link, credit or depend on the buygithub.com-promoting repo.

## Summary
No license blocks the recommended plan. Two Apache-2.0/MIT obligations (RepoMeteor, Trending-Intelligence seed data) require notices; three repos are unusable for copying (starcharts, vitalets, isboyjc-until-verified).
