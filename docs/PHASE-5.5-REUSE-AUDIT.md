# PHASE 5.5 REUSE AUDIT — premium visual redesign

Date 2026-09-26. Stars, license and last push were read live from the GitHub API (unauthenticated) and the npm registry; for React Bits the LICENSE file itself was read because GitHub reports it as NOASSERTION. No code was copied from any project. Decision keys: REUSE (dependency) · ADAPT · COMPOSE · REFERENCE (idea only) · REJECT.

| Candidate | URL | License (verified) | Stars | Last push | Decision | Reason |
|---|---|---|---|---|---|---|
| shadcn/ui | github.com/shadcn-ui/ui | MIT | 124,605 | 2026-09-24 | **REFERENCE** | Copy-in components built on Tailwind + Radix. We use neither, and need only cards, links and pills; adopting it would add Tailwind, class-variance and Radix for markup we already have in plain CSS |
| Radix UI Primitives | github.com/radix-ui/primitives | MIT | 19,329 | 2026-08-08 | **REJECT** | Value is accessible dialogs, menus, tabs. The site has none (filters are links, no popovers). Native elements give keyboard and focus behaviour |
| React Bits | github.com/DavidHDev/react-bits | **MIT + Commons Clause** (GitHub shows NOASSERTION; LICENSE.md read). Use inside an application or website is allowed, resale of the software itself is not | 48,104 | 2026-09-25 | **REFERENCE** | Licence is compatible with a website but not a plain OSI licence, and its effects are heavy (WebGL/GSAP). Nothing used |
| Magic UI | github.com/magicuidesign/magicui | MIT | 22,394 | 2026-09-20 | **REFERENCE** | Animated marketing components on Tailwind + motion. Our hero needs one SVG radar |
| motion-primitives | github.com/ibelick/motion-primitives | MIT | 6,378 | 2026-09-16 | **REJECT** | Needs `motion`; our motion is CSS keyframes |
| Motion (Framer Motion) | github.com/motiondivision/motion, npm `motion` 13.4.4 | MIT | 33,732 | 2026-09-25 | **REJECT** | Everything needed (fade-up on load, bar grow, hover lift, radar sweep) is CSS, honours `prefers-reduced-motion`, and costs 0 KB of JS. Motion would be ~tens of KB of client JS for the same effects |
| Three.js | github.com/mrdoob/three.js | MIT | 115,911 | 2026-09-26 | **REJECT** | 3D does not improve comprehension of the data. Would add a large lazy bundle and continuous GPU use |
| React Three Fiber | github.com/pmndrs/react-three-fiber | MIT | 32,514 | 2026-09-26 | **REJECT** | Same reason; also pulls three + React reconciler |
| Recharts / uPlot (chart libraries) | npm recharts 3.10.1 (MIT), uplot 1.6.32 (MIT) | MIT | n/a | 2026-09 / 2025-03 | **REJECT for now** | The public dataset has no daily star series and Phase 5.5 forbids widening Phase 4 or faking history. Bars are drawn from real fields with plain divs |
| Kiranism/next-shadcn-dashboard-starter | github.com/Kiranism/next-shadcn-dashboard-starter | MIT | 7,065 | 2026-09-11 | **REFERENCE** | Admin-panel look (exactly what we must not resemble); layout ideas only |
| satnaing/shadcn-admin | github.com/satnaing/shadcn-admin | MIT | 14,309 | 2026-09-10 | **REFERENCE** | Same |
| GitHub-analytics / radar visual components | not found as a reusable component | n/a | n/a | n/a | **BUILD (small)** | No maintained, licensed, React-compatible "radar of repositories" component was found in this search. Built as one SVG file (about 40 lines) whose blips are real repositories |
| axe-core | github.com/dequelabs/axe-core | MPL-2.0 (file-level copyleft; used unmodified as a dev tool, not shipped) | 7,557 | 2026-09-23 | **REUSE (dev)** | Accessibility audit engine; no need to write checks |
| playwright-core | github.com/microsoft/playwright | Apache-2.0 | 96,685 | 2026-09-26 | **REUSE (dev)** | Drives the already-installed Chrome (no browser download) for validation and screenshots |

## Dependencies added
Dev only: `playwright-core` (Apache-2.0, ~1.63), `axe-core` (MPL-2.0). Nothing added to the shipped bundle: JS is still next + react only (632 KB of static assets, unchanged class of size).

## Limits of this audit
It compared the listed candidates; it is not an exhaustive survey of all dashboard templates. Licences were read for React Bits (file) and taken from GitHub/npm metadata for the rest.
