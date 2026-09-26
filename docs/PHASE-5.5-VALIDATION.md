# PHASE 5.5 VALIDATION — premium redesign

Date 2026-09-26. Legend: **MEASURED** (observed in this run) · **ASSUMED** · **UNKNOWN**.

## Status: COMPLETE (with limits in section 8)

## 1. Scope check (MEASURED)
Only presentation files changed: `app/*`, `components/*`, `lib/query.ts` (added aggregation helpers), tests, docs, `scripts/browser-validate.mjs`. Not touched: collection, growth, momentum, classification, tracking, data generation, `data/public/radar.json`. Phase 4 numbers still come from the file at build time (tracked 3,413, measured 3,411, AI 1,685, Rising 25 of the AI scope, new entrants 244, 14 categories); none is hard-coded.

## 2. Automated checks (MEASURED)
- `npm test`: **372 tests, 15 files, all pass** (367 before; +5 for sustained/new/feature cards, category sustained counts and hues, radar dots). No test was deleted; three explorer assertions were updated for the new results markup.
- `npx tsc --noEmit`: clean. `npm run build`: passes, 1,692 static pages.

## 3. Real-browser validation (MEASURED)
Tool: `node scripts/browser-validate.mjs` (playwright-core driving the installed Google Chrome, headless; static export served locally). Pages: home, explore, explore with `?category=ai-agents&filter=rising&sort=growth7d`, a repository page, methodology. Widths **1440, 1280, 1024, 768, 390, 375** = 30 page loads, run once with normal motion and once with `prefers-reduced-motion: reduce`.

| Check | Result |
|---|---|
| Horizontal overflow (scrollWidth > clientWidth) | none in 60 loads |
| Cards/metrics/panels clipped outside the viewport | 0 |
| Console errors / failed requests | 0 (after adding an icon and mirroring Next's segment-file rewrite in the test server, see 8) |
| Requests to any non-local host (GitHub etc.) | 0 |
| Text smaller than 12 px | 0 |
| Touch targets (pills, buttons, nav) under 44 px high | 0 |
| Default theme | dark (`data-theme="dark"`, body background computed dark) |
| Keyboard | Tab order: Skip link, brand, AI Radar, Explore, Methodology, first card link; every focused element shows a 3 px solid outline |
| Interaction | clicking Rising on Explore changes the URL to `?filter=rising` and shows 25 repositories; clicking MCP gives `?category=mcp&filter=rising`, 3 repositories; a reload keeps both; active controls carry `aria-current` |

## 4. Accessibility (MEASURED with axe-core 4.13, rules wcag2a, wcag2aa, wcag21aa, best-practice)
Run on all 5 pages at 1440 and 390 px. First run found 1 violation class: heading order on Explore (h3 cards after h1); fixed with a visually hidden "Results" h2. Final run: **0 violations** on every page and both widths, including colour contrast. This is automated coverage only; a screen reader and forced-colours mode were **not** tested. Trend is conveyed by arrow plus word. Reduced motion verified by the reduced-motion run (no errors, layout identical); animation being stopped is by CSS rule, and was not separately measured with a frame profiler.

## 5. Screenshots (MEASURED, in `results/phase5.5/shots/`)
Full-page `home|explore|explore-filtered|repo|methodology-{width}.png` (full-page at 1440 and 390, viewport at other widths) and crops `crop-home-top-1440`, `crop-rising-1440`, `crop-repo-1440`, `crop-home-390`, `crop-explore-390`. Reviewed by eye: readable 17 px body text, 36 px metrics, large repository names, radar with real blips, Rising cards visually dominant (green tint, rank, comparison bars), Movers split into green and amber panels, Sustained purple with window bars, New teal with age badge, category cards with per-category accent, mobile single column with a wrapping nav. Raw evidence JSON: `results/phase5.5/validation-*.json`.

## 6. Performance (MEASURED, production build)
| Page | raw | gzip |
|---|---|---|
| `/` | 163 KB | 20.4 KB (was 14.0 KB) |
| `/explore/` | 1.39 MB | 238 KB (unchanged) |
| `/methodology/` | 20.5 KB | 4.8 KB |
| repository page | 23.7 KB | 4.9 KB |
Static JS/CSS 632 KB on disk (was 615 KB). No animation library, no 3D. Server components except `NavLinks` and the Explore view. CPU/GPU cost of the radar sweep was **not** profiled (UNKNOWN); it is one rotating SVG group.

## 7. Checklist
Dark default yes · larger type yes · hero identity and radar yes · subtle motion, reduced-motion respected yes · Rising dominant yes · Movers split yes · Sustained and New distinct yes · category cards with rising and sustained counts yes · Explore redesigned, deep links intact yes · repository page redesigned yes · methodology with "descriptive, not predictive" banner yes · no fake data (no sparklines, no search box, Engineering marked coming soon) yes · no algorithm or API change yes · no token in output (no `api.github.com` or token patterns requested or found; 0 external requests) yes.

## 8. Known limitations
- Next 16's static export asks for `__next.<route>.__PAGE__.txt` prefetch files but writes them in nested folders. Hosts such as Vercel translate this; a plain static server does not, and would log 404s for link prefetches (navigation still works). The validation server mirrors the rewrite. Not verified on Vercel (Phase 6).
- No history sparklines (not in the public contract, deliberately).
- Screen reader, forced-colours and real-device testing not done; only Chrome was used (no Firefox/Safari).
- Explore still ships all AI repositories (238 KB gzip).
- `bojieli/ai-infra-book` (a book) still ranks third in Rising; unchanged Phase 4 behaviour.
- Screenshots were not diffed against the pre-redesign UI (the earlier screenshots supplied by the user were not available to this session).

---

## Addendum: production review (Phase 5.5.1, 2026-09-26, MEASURED against https://opensourceradar-kappa.vercel.app/)

Chrome (playwright-core) against the live site, deployment of commit dcc51e9 (GitHub deployment status `success`).
- **Explore works in production.** `/explore/` renders 30 cards immediately (1,685 repositories), no "Loading…" text remains after hydration. Clicking Rising gives 25, adding MCP gives 3, sorting by Total stars updates the URL to `?category=mcp&filter=rising&sort=stars`; a reload preserves the URL and the result; the deep link `?category=ai-agents&filter=sustained&sort=growth7d` shows 46 repositories with Sustained, AI Agents and 7d growth marked current. The earlier "Loading…" observation was the static HTML before hydration (Suspense fallback), not a defect. Explore was not changed.
- **Prefetch / Next 16:** navigation to Methodology, Explore and repository pages works on Vercel; the four page loads produced no console errors and no failed requests. **Verified on Vercel; no production issue.** (One single 404 console message appeared once in a longer click session and could not be reproduced in four clean loads; the only 404 found is `/favicon.ico`, while the icon is served as `/icon.svg` through a `<link>`.)
- **Real defect found and fixed:** the live canonical link, sitemap and robots pointed to `http://localhost:3000` because `NEXT_PUBLIC_SITE_URL` is not set on Vercel. Fix: `lib/site.ts` uses `NEXT_PUBLIC_SITE_URL`, else Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, else localhost (unit-tested). Verified locally with the variable simulated: canonical, sitemap and robots use the production domain. To be re-verified on the live site after deployment.
- **bojieli/ai-infra-book:** live page shows +716 in 7 days, 5,297 in 30 days, 5,299 stars, momentum 70.2, "Meets the Rising criteria", identical to `radar.json` (Rising, not accelerating: acceleration ratio null). Left as is; a domain-policy question (educational/book repositories) for a future phase.
- **Performance sanity (live, Chrome, desktop):** DOMContentLoaded 51 ms, load 71 ms (cached); 20 scroll steps used 0.36 s of main-thread task time and 0.01 s of script; idle with the radar sweep running: 0.078 s of main-thread time per 5 s (about 1.6%); JS heap 9 MB. Acceptable. GPU cost not measured. Mobile 390 px: no horizontal overflow, 30 cards on Explore. Reduced motion: the sweep animation is `none`.
- **Local re-validation after the fix:** 373 tests pass, `tsc` clean, build passes, `browser-validate.mjs` 30 loads with 0 problems in normal and reduced-motion runs, axe 0 violations (as before).
- Screen reader validation not performed.
