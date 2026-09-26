# PHASE 5 REUSE AUDIT — AI Radar dashboard

Date 2026-09-26. Method: npm registry metadata queried live (`npm view`: version, license, last-modified date) for every candidate below. Candidates were chosen from well-known mature packages in each capability; **no GitHub-wide repository search was run in this session** (no web-search tool was used), so this audit does not claim to have surveyed every dashboard template. No code was copied from any repository.

Decisions: REUSE (use as a dependency) · ADAPT · COMPOSE · REFERENCE (idea only) · REJECT.

| Candidate | Source / license | Capability | Decision | Reason |
|---|---|---|---|---|
| **next** 16.3.6 | npm, MIT, modified 2026-09-26 | Routing, static export (`output: 'export'`), metadata, sitemap/robots, `generateStaticParams` | **REUSE** (added) | Spec requires Next.js + Vercel; static export gives no server, no runtime API. Provides SEO, sitemap and robots natively, so none of it is hand-built |
| **react / react-dom** 19.3.0 | npm, MIT, modified 2026-09-23 | UI runtime | **REUSE** (added) | Peer requirement of Next.js |
| @types/react, @types/react-dom | DefinitelyTyped, MIT | Types | **REUSE** (dev, added) | TypeScript strict build |
| Vitest (already installed) + `react-dom/server` `renderToStaticMarkup` | existing / part of react-dom | Component tests | **REUSE** (no new dependency) | Renders components to HTML strings; enough to test cards, filters, empty states |
| @testing-library/react 16.3.3 | npm, MIT | DOM interaction tests | **REJECT** for now | Needs jsdom and a new dependency; filters are URL-driven links, so server rendering with different `URLSearchParams` tests the same behaviour |
| recharts 3.10.1 | npm, MIT, modified 2026-09-21 | Charts | **REJECT (not needed)** | The public dataset has no daily star series, and the spec forbids widening Phase 4 just for a chart. Detail page shows the growth windows as numbers. If a chart is added later, recharts (or uPlot 1.6.32, MIT, smaller) is the candidate; do not build SVG charts by hand |
| @tanstack/react-table 9.2.4 | npm, MIT | Sortable tables | **REJECT** | Sorting is 5 fixed keys applied to pre-ranked data by URL; a table library adds weight for nothing |
| tailwindcss 4.3.3 | npm, MIT | Utility CSS | **REJECT** | ~250 lines of plain CSS with variables and `prefers-color-scheme`; a CSS framework adds a build step and dependency |
| swr / react-query | npm, MIT | Client data fetching | **REJECT** | No runtime fetching by design (static JSON at build time) |
| shadcn/ui, Radix | MIT | Accessible components | **REJECT** | Only links, buttons, headings and tables are used; native semantic HTML gives keyboard and focus behaviour |
| Existing Phase 4 code (`derivePublic`, momentum explanations) | this repository | Explanations, lists, scores | **REUSE** | The UI shows the Phase 4 `summary` and `explanation` verbatim; nothing is recomputed in the UI |

## Dependencies added
Runtime: `next`, `react`, `react-dom` (all MIT). Dev: `@types/react`, `@types/react-dom`. Nothing else. Existing dependencies unchanged.

## Not verified
- Whether an open-source "GitHub trending dashboard" template could replace part of the UI: not searched. The UI here is small (about 700 lines, 8 routes) and specific to our data contract, so the expected saving is low.
- A formal license scan of the lockfile is still open (also noted in THIRD_PARTY.md).
- `npm audit` reports a moderate advisory on vitest/vite (dev tooling only, pre-existing, fix requires a major upgrade); no advisory affects the shipped static output.
