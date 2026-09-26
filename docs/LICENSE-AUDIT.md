# LICENSE AUDIT

Audit date 2026-09-24. "Read" = LICENSE file opened from a local clone. "Fetched" = raw file fetched from GitHub. Not legal advice.

| Project | Declared | File checked | Copyright line | Obligation if code copied | Verdict |
|---|---|---|---|---|---|
| patrick-creates/rising-repos-tracker | MIT | Read | 2026 patrick-creates | Keep copyright + MIT text in copied files | OK to adapt |
| bowjoww/repotide | MIT | Read | 2026 Joow Labs | Same | OK to adapt |
| isboyjc/github-trending-api | MIT (GitHub API) | **Not seen** — checkout failed (Windows-invalid filenames `f*.json`) | ? | Re-verify via raw URL before any copying | Consume as data only until verified |
| huchenme/github-trending-api | MIT | Present | — | Same | Reference only (stale) |
| encoreshao/github-trending | MIT | Read | 2026 Encore Shao | Same | Reference |
| LokeshNanda/oss-radar-ai | MIT | Read | 2026 Lokesh Nanda | Same | Reference |
| tianpai/dailyRepo | MIT | Read | 2025 Tianpai | Same | Rejected (tech) |
| EvanLi/Github-Ranking | MIT | Read | 2018 Evan Li | Same | Reference |
| mshibanami/GitHubTrendingRSS | MIT | Read | 2018 Manabu Nakazawa | Same | Reference |
| ai-martin-lau/github-trending-radar | MIT | Read | 2026 ai-martin-lau | Same | Reference |
| star-history/star-history | MIT | Fetched | 2025 Star History | Same | Reference |
| pingcap/ossinsight | Apache-2.0 | Fetched | — | Notice of changes, NOTICE/attribution, patent grant; no trademark use | Not used as code |
| **vitalets/github-trending-repos** | **none** | **No LICENSE file** | — | No grant → all rights reserved | **Do not copy** |

## Concerns

1. **vitalets: no license.** Reference concept only; writing our own implementation of the idea (not code) is fine.
2. **isboyjc: unconfirmed file.** Metadata says MIT; verify `https://raw.githubusercontent.com/isboyjc/github-trending-api/main/LICENSE` before copying code. Consuming its published JSON is a data-source question (see DATA-SOURCE-AUDIT).
3. **Young repos (0 stars, single maintainer).** MIT is valid regardless of popularity, but the license can be changed on future commits. Pin the commit SHA we copy from and record it in a `NOTICE`/`THIRD_PARTY.md`.
4. **Attribution mechanics.** For any adapted file keep the original MIT notice in a header comment and list it in `THIRD_PARTY.md` with repo, commit SHA, license.
5. **Scraping github.com/trending.** Not a license issue for the code, but a Terms-of-Service / stability issue. `github.com/robots.txt` was checked (grep for "trending" returned no rule; the file has a `User-agent: *` block). GitHub's ToS restrict excessive automated access; keep to a few requests per run with a descriptive User-Agent. Treated as a **risk**, mitigated by design (trending is optional input, own snapshots are primary).
6. **GitHub API data.** Repo metadata (names, stars, descriptions) is factual; descriptions are authored by repo owners. Display with links back; do not mirror README bodies. Avatars: hot-link `avatars.githubusercontent.com`, do not re-host.
7. **OSS Insight API.** No stated data license, beta, rate-limited. Use only for non-critical enrichment, cache derived numbers, attribute.
8. **Dependencies.** Verify each npm dependency license at install (`license-checker`); prefer MIT/Apache/ISC. None chosen yet.
9. **Cost-bearing LLM APIs.** None in the plan; any addition must stay free-tier and optional.

## Net result
All code we intend to adapt (repotide, rising-repos-tracker) is MIT with verified LICENSE files. No copyleft (GPL/AGPL) encountered. Zero blockers, one do-not-copy (vitalets), one to re-verify (isboyjc).
