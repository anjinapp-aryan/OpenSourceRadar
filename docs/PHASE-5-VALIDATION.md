# PHASE 5 VALIDATION — AI Radar dashboard

Date 2026-09-26. Legend: **MEASURED** · **CONFIGURED** · **ASSUMED** · **UNKNOWN**.

## Status: COMPLETE for the defined scope, with the limits listed in section 12

## 1. Reuse audit
[PHASE-5-REUSE-AUDIT.md](PHASE-5-REUSE-AUDIT.md). Added only next, react, react-dom (MIT) and their type packages. Charts, table, CSS-framework and fetching libraries were considered and rejected with reasons. The audit used npm registry metadata; a GitHub-wide template search was **not** run (stated in the audit).

## 2. Data contract
[PHASE-5-DATA-CONTRACT.md](PHASE-5-DATA-CONTRACT.md). Real file inspected. `schemaVersion` stays 1. Additive fields only: `growth90d, velocity90d, growthPercent7d, priorVelocity, accelerationRatio, velocityDelta, ageDays, explanation[], tier?`, top-level `categories`, `stats`. No algorithm changed: Momentum v1, tracking, classification, due schedule, GraphQL fallback and star-history provider are untouched. Phase 4 counts after regenerating the file are identical (MEASURED): RISING 35, COOLING 195, STEADY 3,316, movers 123, sustained 164, new entrants 293, 3,546 records.

## 3. Routes (static export, `output: 'export'`)
| Route | Content |
|---|---|
| `/` | Hero, freshness, metric tiles (Tracked, Measured, AI repositories, Rising, New entrants, Categories), Rising now, Biggest movers (UP and DOWN separate), Sustained, New entrants, 14 AI categories, "How to read this" |
| `/explore/?category=&filter=&sort=&n=` | Trend filter (All, Rising, Cooling, Steady, New Entrants, Sustained), category filter (All AI + 14), sort (Momentum default, 7d growth, Stars/day, 30d growth, Total stars), Show more. All state in the URL, so views are shareable and survive refresh |
| `/repo/{owner}/{name}/` | 1,685 pages: description, GitHub link, trend, categories, "Why it's here" (summary + engine explanation lines), evidence (stars; 7/30/90d growth; stars/day 7/30/90; previous velocity; acceleration; score; age; tier) |
| `/methodology/` | Signals, labels, limits, non-predictive statement |
| `/sitemap.xml`, `/robots.txt`, not-found page | generated |

Filters are links (no JS state); the Explore page is the only client component (reads `useSearchParams`, inside Suspense). Ranking is never computed in the browser: it filters and sorts the pre-scored fields.

## 4. Components / code
`lib/radar.ts` (loader + contract check), `lib/query.ts` (scope, filter, sort, summaries, formatting), `components/parts.tsx` (TrendBadge, Section, RepoCard, MoverTable, EmptyState, ErrorPanel), `app/*`. About 770 lines.

## 5. Dependencies
next 16.3.6, react and react-dom 19.3.0 (MIT); dev @types/react, @types/react-dom. No LLM, database, GitHub client or chart library in the frontend.

## 6. Tests (MEASURED)
`npm test`: **367 tests pass in 15 files** (344 existing + 23 UI: loading, malformed/missing/invalid data, AI scope, list order, movers up/down, category summaries, filters, sorting including null-last and tie determinism, no mutation, card rendering incl. "n/a" not 0, mover table, error panel, URL-driven explorer defaults/filters/empty/unknown values/aria-current/pagination, freshness). `npx tsc --noEmit` clean. `npm run build` passes (1,692 static pages). Existing Phase 4 tests still pass after one expected update (public key list and size ratio, since fields were added). Not done: browser-level interaction tests and automated mobile-layout tests (UNKNOWN beyond CSS review).

## 7. Performance (MEASURED, production build)
| Page | raw | gzip |
|---|---|---|
| `/` | 99.9 KB | 14.0 KB |
| `/explore/` | 1.39 MB | 238 KB (embeds the 1,685 AI repositories, descriptions cut to 100 chars, explanations removed) |
| `/methodology/` | 12.4 KB | 3.0 KB |
| a repository page | 15.6 KB | 3.4 KB |
JS/CSS assets 615 KB total on disk (`_next/static`). Whole export 94 MB (1,692 HTML files plus Next payload files). Build compile 2.5 s, page generation 3.2 s. No runtime API calls (grep of the output found no `api.github.com` and no token pattern). The Explore payload is the largest item; it is acceptable now but would need pagination by category files if the AI set grows several times (ASSUMED threshold).

## 8. Accessibility (CONFIGURED, reviewed in markup; not audited with a screen reader)
Skip link, `lang`, one `h1` per page with ordered headings, landmarks (`header`, `nav` with labels, `main`, `footer`), visible 3 px focus outline, current filter marked with `aria-current` and a filled style, tables with `scope` and a screen-reader caption, status messages with `role="status"`, errors with `role="alert"`. Trend is always an arrow plus a word, never colour alone. Colours follow light/dark preference; contrast ratios were **not** measured with a tool (UNKNOWN).

## 9. SEO
Title template, description, canonical per page, OpenGraph basics, robots, sitemap of 1,688 URLs, per-repository titles and descriptions from real data. Base URL comes from the public variable `NEXT_PUBLIC_SITE_URL` (default `http://localhost:3000`); **it must be set for production** (no domain exists yet).

## 10. Security
No token or secret is read by the frontend; the only environment variable used is the non-secret `NEXT_PUBLIC_SITE_URL`. Output was searched for `GITHUB_TOKEN` and `ghp_`: none. No browser call to GitHub. `.env`, `.next`, `out` are ignored. The directory is not a git repository in this workspace, so a `git diff` review was **not possible**; files changed/added are listed here instead: `src/momentum/dataset.ts`, `scripts/momentum/index.ts`, `tests/momentum.test.ts`, `package.json`, `tsconfig.json` (Next.js adjusted it), `.gitignore`, new `app/ components/ lib/ next.config.mjs tests/ui.test.tsx docs/PHASE-5-*.md`.

## 11. Manual review (MEASURED from data and markup; a real browser was not used, so no screenshots)
- AI scope: 1,685 repositories; 25 Rising, 131 Cooling, 244 new entrants, 114 sustained. Top Rising: hindsight (77.4), rocketride-server (77.1), ai-infra-book (70.2), failproofai (68.9), hypit (68.5), cc-switch (67.2). Categories on the home page show counts and top rising.
- Awesome-selfhosted (Rising, classified UNKNOWN) correctly absent from AI Radar; the homepage "Rising" count (25) differs from Phase 4's 35 because 10 are not AI (expected, and worth explaining to readers).
- Observation: `bojieli/ai-infra-book` (a book repository) ranks third. It is classified AI and has high growth, so the rules place it there; educational repositories are not excluded from momentum. Not tuned.
- Layout: single column under 600 px, tables scroll horizontally in their own container.

## 12. Known limitations
- No star-history chart (not in the public contract; deliberately not added).
- Freshness is computed at build time; a static site cannot show "stale" later without a rebuild.
- Explore ships all AI repositories to the browser (238 KB gzip).
- Tier in the public file is an operational detail and is shown only on the detail page.
- Screenshots, contrast measurements, screen-reader tests and cross-browser checks were not done.
- Vercel deployment and the production URL are not configured (out of scope for this phase).
- Momentum caveats from Phase 4 apply (star inflation, educational repositories, DOWN-dominated movers).

## 13. Phase 6 recommendation
Deploy to Vercel with `NEXT_PUBLIC_SITE_URL`, add a scheduled GitHub Actions run (collect, track, momentum, build) so `generatedAt` advances, then decide on Engineering Radar and on a star-history series for charts. Not started.
