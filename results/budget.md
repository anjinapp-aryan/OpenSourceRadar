# Generated API budget

Generated 2026-09-24T16:21:03.516Z from scripts/smoke/results/*.json

**UNKNOWN** - no graphql smoke results found. Run `npm run smoke` with GITHUB_TOKEN set, then `npm run budget`.

## MEASURED: GET /repos/{owner}/{repo}/stargazers/history (first page = 30 weeks)

| repo | HTTP | page-1 bytes | page-1 ms | pages to full history | oldest week |
|---|---:|---:|---:|---:|---|
| vercel/next.js | 200 | 1860 | 433 | 18 | 2016-10-02 |
| torvalds/linux | 200 | 2058 | 339 | 27 | 2011-09-04 |
| encoreshao/github-trending | 200 | 1593 | 321 | 4 | 2024-07-21 |
| patrick-creates/rising-repos-tracker | 200 | 1061 | 353 | 1 | 2026-05-10 |

Average page-1 response: 1643 bytes, 362 ms (MEASURED over 4 repositories, sequential, one network location).

## ESTIMATED: one 30-week refresh per repository (1 request each)

| repos | requests | download | sequential time at measured latency | vs 60/h anonymous | vs 1,000/h Actions token | vs 5,000/h PAT |
|---:|---:|---:|---:|---|---|---|
| 100 | 100 | 160 KiB | 36 s | does not fit | fits | fits |
| 500 | 500 | 802 KiB | 181 s | does not fit | fits | fits |
| 1000 | 1000 | 1604 KiB | 362 s | does not fit | does not fit | fits |

Limits 1,000/h and 5,000/h are DOCUMENTED, not measured; 60/h anonymous is MEASURED. A full-history fetch costs "pages to full history" requests per repository (MEASURED for the sampled repositories only).