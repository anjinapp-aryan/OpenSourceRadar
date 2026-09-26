# PHASE 6 REUSE AUDIT — production automation

Date 2026-09-26. Stars/licence/last-push come from the GitHub API (unauthenticated; the API budget ran out partway, so rows marked "not fetched" were **not** verified and were **not** used). Decision keys: REUSE · ADAPT · COMPOSE · REFERENCE · REJECT. No code was copied from any project; the workflow is our own composition of first-party actions and the `gh` CLI.

| Candidate | URL | Licence | Stars | Last push | Capability | Decision | Reason |
|---|---|---|---|---|---|---|---|
| actions/checkout | github.com/actions/checkout | MIT | 8,907 | 2026-09-21 | Checkout | **REUSE** (v4) | First-party |
| actions/setup-node | github.com/actions/setup-node | MIT | 4,971 | 2026-09-25 | Node + npm cache | **REUSE** (v4) | First-party; replaces hand-written npm caching |
| actions/cache | github.com/actions/cache | MIT | 5,559 | 2026-07-15 | Cache with key/restore-keys, 7-day eviction, 10 GB per repo | **REUSE** (v4) | Only for the same-day star-history resume cache (see CACHE-STRATEGY) |
| actions/upload-artifact | github.com/actions/upload-artifact | MIT | 4,200 | 2026-04-14 | Artifacts with retention | **REUSE** (v4) | Diagnostics of failed runs, 7-day retention |
| Actions `concurrency`, `permissions`, `workflow_dispatch`, `schedule` | docs.github.com (platform features) | n/a | n/a | n/a | Single-flight runs, least privilege, manual and daily triggers | **REUSE** | Built in; no custom locking |
| GitHub CLI (`gh`) on runners | github.com/cli/cli | MIT per GitHub docs (repo not fetched) | not fetched | not fetched | Release download/upload for the state asset | **REUSE** | Preinstalled on GitHub runners; authenticates with the workflow token |
| GitHub Releases as a data store | platform feature | n/a | n/a | n/a | One overwritten asset (`data-state`), no Git history growth, free | **REUSE** | Chosen over committing 46 MB daily |
| Vercel Git integration | vercel.com docs | n/a | n/a | n/a | Deploy on push to main, immutable deployments, instant rollback | **REUSE** | Already connected (Phase 5.5.1); no second deploy path |
| Vercel CLI (`vercel deploy --prebuilt`) | github.com/vercel/vercel | Apache-2.0 | 16,303 | 2026-09-25 | Deploy from Actions | **REJECT (for now)** | Would need `VERCEL_TOKEN`, org and project ids as secrets and a second deployment mechanism next to the Git integration. Only needed if the integration cannot be used |
| vercel/actions | github.com/vercel/actions | not reported | 16 | 2021-07-12 | Old Vercel action | **REJECT** | Unmaintained since 2021 |
| Git-scraping pattern (commit scheduled data back) | idea only | not audited | not fetched | not fetched | Data committed by a schedule | **REFERENCE (adapted)** | We commit only the small public file, not internal data |
| git-auto-commit-action, add-and-commit, actions-gh-pages, github-pages-deploy-action | various | not fetched | not fetched | not fetched | Commit/publish helpers | **REJECT (not verified)** | Five lines of `git commit && git push` do the same; unverified third-party actions with write access are a supply-chain cost |
| Zod / Ajv | npm | MIT (general knowledge, not fetched) | n/a | n/a | Schema validation | **REJECT** | New dependency for one structural check; the gate also compares against the previous dataset, which schemas do not do. Pure functions with tests instead |
| Atomic publish (temp file then rename) | existing `writeJsonAtomic` pattern | n/a | n/a | n/a | Write temp, verify, rename | **REUSE** (existing pattern) | Same technique used for every dataset |

## Dependencies added
None (runtime or dev). The workflow uses only first-party actions; `package.json` gained script entries only.

## Not verified
Marketplace actions were not enumerated exhaustively. Latest patch versions of first-party actions were not looked up (major tags v4 used). Stars for `cli/cli` and the commit helpers could not be fetched (unauthenticated API limit reached).
