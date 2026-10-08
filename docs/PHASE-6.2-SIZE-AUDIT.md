# PHASE 6.2 SIZE AUDIT

Date 2026-10-08. Evidence labels: **FACT** (measured today with `npm run pipeline size`, `git`, or read from the cited page) · **INFERENCE** (linear projection, labelled as such) · **UNKNOWN**. Vercel facts come from https://vercel.com/docs/limits (page last updated 2026-09-16), read on 2026-10-08.

## 1. The static export, independently measured (FACT)
Production build with `NEXT_PUBLIC_SITE_URL` set, Next.js 16.3.6 `output: 'export'`, on the data of 2026-10-07 (3,471 published records, 1,735 AI-scope repositories).

| Item | Measured |
|---|---|
| HTML pages (`index.html`) | **1,740** (1,735 repository pages plus home, explore, methodology and the not-found page; a separate `404.html` makes 1,741 HTML files) |
| Files in `out/` | **8,715** |
| Total bytes | **139,505,602** (133.0 MiB). The "148 MB" quoted in Phase 6.1 came from `du`, which rounds every file up to disk blocks; the logical size is 140 MB |
| `.txt` files | 6,957 files, 78.7 MB (56.4%): Next's per-page payload files for client navigation and prefetch (four per page) |
| `.html` | 1,741 files, 59.9 MB (43.0%), 34.4 KB per page on average |
| `.js` | 13 files, 0.6 MB; `.css` 18 KB; `sitemap.xml` 241 KB |
| Per repository page | about **79.6 KB** (34.4 KB HTML plus four payload files of 11.3 KB on average) |
| Build time | **16.4 s** (13.5 s for the same build in Phase 6.1; 23 s for the cold build at the start of Phase 6.1) |

Public data (3,471 records): `radar.json` 3,695,992 bytes, 582,413 gzip, 369,044 brotli (1,065 B per record raw, 106 B brotli). `history.json` (1,735 entries) 366,183 bytes, 97,869 gzip, 84,545 brotli (211 B per entry raw). The explore page HTML is 1.49 MB (247 KB gzip) because it embeds every AI repository (857 B each).

## 2. Vercel's documented limits, applied to this project (FACT, Hobby plan)
| Limit | Documented value | This project |
|---|---|---|
| Build time per deployment | 45 minutes | 16 s |
| Deployments per day | 100 | 1 per day (2 were made on Mondays before Phase 6.1) |
| Build container disk | 32 GB | 140 MB output |
| Output files | "no upper limit"; many thousands lengthen builds, "100,000 or more" are expected to be slow; the page recommends ISR for large page counts | 8,715 files |
| Static file uploads | 100 MB, but this applies to **CLI uploads of source files**; deployments here come from the Git integration | not applicable |
| CLI source files | 15,000 | not applicable |
| **Routes created per deployment** | **2,048**; counts `vercel.json` rewrites, redirects and headers and the Build Output API routes; "Next.js will create a set of Routes corresponding to your use of dynamic routes, redirects, rewrites and custom headers" | **UNKNOWN whether the 1,740 static pages count** (see below) |

**The routes limit is the one real unknown.** The site has one dynamic route (`/repo/[owner]/[name]`) pre-rendered to 1,735 static files and no rewrites, redirects or custom headers. The documentation defines routes as configuration items and says Next.js creates routes for dynamic routes; it does not say whether each pre-generated static page becomes one. A search result suggested static pages are separate from the limit, but that is a secondary summary, not the documentation, and is treated as **unverified**. 1,740 is below 2,048, so the production deployment gives no evidence either way. **RECOMMENDATION:** before the AI scope reaches about 1,900 repositories (the number grows by roughly 90 new candidates per ten days before filtering), verify by deploying a preview with about 2,300 synthetic pages. If pages do count, the cheap mitigations are to pre-render only the top N repositories and serve the rest through a single client-side route backed by sharded JSON, or to use ISR.

## 3. Projections (INFERENCE: linear in the measured per-page and per-record sizes)
Pages are per AI-scope repository; JSON files are per published record. Records and AI repositories are assumed to grow together.

| | Now | 5,000 | 10,000 | 20,000 |
|---|---:|---:|---:|---:|
| Repository pages (AI scope) | 1,735 | 5,000 | 10,000 | 20,000 |
| Static export | 140 MB | 398 MB | 796 MB | 1.59 GB |
| Output files | 8,715 | 25,000 | 50,000 | 100,000 |
| Build time at 9 workers | 16 s | 47 s | 94 s | 189 s |
| `radar.json` raw (published records) | 3.7 MB | 5.3 MB | 10.6 MB | 21.3 MB |
| `radar.json` brotli | 0.37 MB | 0.53 MB | 1.06 MB | 2.1 MB |
| `history.json` raw (AI entries) | 0.37 MB | 1.06 MB | 2.1 MB | 4.2 MB |
| Explore page HTML (gzip) | 247 KB | 710 KB | 1.4 MB | 2.8 MB |
| Git, per daily data commit (packed) | 171 KB mean | 0.25 MB | 0.5 MB | 1.0 MB |
| Git, per year at one commit a day | 62 MB | 90 MB | 180 MB | 360 MB |

**Constraints in the order they would bind:**
1. **The explore page payload (user-visible).** It embeds every AI repository; 500 KB gzip is reached at about 3,500 AI repositories. This is a client download and parse cost, not a Vercel limit.
2. **The history gate cap** (`history.maxBytes` 3 MB, a guard in `config/pipeline.json`) is reached at about 14,000 entries; raise it deliberately or shard.
3. **The `radar.json` warning level** (8 MB, `gate.warnPublicBytes`) is reached at about 7,500 records; the fail level (25 MB) at about 23,000.
4. **The 2,048-routes question** at about 2,000 pages, if static pages count (UNKNOWN).
5. **File count**: 100,000 output files at about 20,000 pages, where the documentation expects slow builds. Build time stays far below 45 minutes at every size above.
Nothing in the table requires a database at 20,000 repositories; the first three are addressed by pagination or sharding of static files.

## 4. Correction to the Phase 6 and strategic audit estimate (FACT)
The strategic audit estimated Git growth at about 0.83 MB per daily commit (about 300 MB a year). That figure came from comparing `.git` directory sizes of **loose** objects, which overstates real growth. After `git gc`, the whole repository (23 commits, including the original 46 MB of data) is **20.9 MiB** packed. The 14 bot data commits introduced **2.4 MB** of packed objects in total (mean 171 KB, median about 65 KB, largest 0.69 MB, one commit under 1 KB) while `radar.json` is 3.6 to 4.1 MB raw. At one commit a day that is about **60 MB a year** at the current size. The conclusion of the audit (move data out of Git at roughly 6,000 records) was too early on this evidence: on the packed figures the trigger is more like 15,000 to 20,000 records, or a clone time that users notice, whichever comes first. GitHub's repository size guidance was not re-read in this audit.

State backups are separate: 14 dated copies of 3.6 MB each is about 51 MB in the `data-state` release, outside Git.

## 5. Storage options (no database introduced)
| Option | Verdict | Evidence |
|---|---|---|
| A. Current JSON in Git | **Keep** | Packed Git growth is small (section 4); both files are compact before commit |
| B. Compact JSON | Already done | The publish step writes minified JSON; brotli reduces `radar.json` by 90% |
| C. Compressed historical representation | **Not needed** | `history.json` is 85 KB brotli; zero days are 43% of the values, which brotli already exploits. A custom encoding would save kilobytes and cost readability |
| D. Per-repository history files | **Not needed** | A repository page embeds only its own 90 values (about 0.4 KB). One file per repository would add 1,735 files for no saving |
| E. External static object storage | **Not needed** | Nothing is large enough to leave Git; revisit if the data exceeds about 100 MB or Git clone time becomes a user problem |

**Decision: keep the current architecture.** The smallest changes that would be needed first are not storage changes: paginate or shard the explore payload before about 3,500 AI repositories, and resolve the routes question before about 1,900.

## 6. Reproduce
`npm run build` then `npm run pipeline size` (read-only; prints public data sizes with gzip and brotli, the static export by extension, and linear projections). `git gc` then the per-commit loop over `git diff-tree` and `git cat-file --batch-check='%(objectsize:disk)'` gives the Git figures. Sizes are deterministic for a given data set.
