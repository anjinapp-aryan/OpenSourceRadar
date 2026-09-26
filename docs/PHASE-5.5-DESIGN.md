# PHASE 5.5 DESIGN — OpenSource Radar identity

Presentation only. Data contract (`data/public/radar.json`), momentum, tracking and classification are unchanged.

## Concept
"Radar": a dark, technical interface whose recurring motifs are the sweep, concentric rings and blips. The hero radar is drawn from real data: each blip is one of the top-scoring AI repositories; the angle comes from a hash of its id, the distance from its momentum score (closer = higher), green = Rising. It is decorative (hidden from assistive technology) and the sweep stops under `prefers-reduced-motion`.

## Tokens (app/globals.css `:root`)
Surfaces `--bg #070a0f`, `--surface #0d1117`, `--surface-2 #111827`, `--border #1f2937`. Text `--text #f3f4f6`, `--text-2 #b4bcc8`, `--text-3 #8b95a5` (raised from the brief's #6B7280 so muted text passes contrast). Status colours: rising `#34f5a0`, cooling `#ffb04a`, steady `#6aa9ff`, sustained `#c4a1ff`, new `#5eead4`; domains ai `#a78bfa`, engineering `#22d3ee`. Type scale from 13 px captions to a 84 px hero, body 17 px. Spacing xs-2xl, radius sm-xl, subtle elevation and status glow only. 14 category hues are generated deterministically.

## Meaning of visuals (nothing invented)
| Visual | Source field |
|---|---|
| Momentum bar | `score` on the 0-100 scale |
| "Previous 4 wks vs Last 7 days" bars | `priorVelocity`, `velocity7d` |
| Sustained 7/30/90 bars | `velocity7d/30d/90d`, scaled to the largest of the three; `n/a` shown as "not measurable" |
| "Accelerating N×" | `accelerationRatio`, only for Rising cards |
| Trend | text + arrow (↑ Rising, ↓ Cooling, → Steady), never colour alone |
| New · N days old | `ageDays` |
| Category counts | aggregated from `radar.json` (repositories, rising, sustained) |
No sparklines: the public data has no history and none was fabricated.

## Layout
Sticky header (brand mark, AI Radar, Engineering marked "Coming soon" and not a link, Explore, Methodology; no search because none exists). Home: hero + radar, six metric cards, Rising now (large feature cards with rank), Biggest movers (Accelerating and Cooling as two panels), Sustained (purple), New entrants (teal), 14 category cards, transparency panel. Explore: segmented Momentum / Category (horizontal scroll) / Sort controls, all links, URL state unchanged. Repository page: hero, six KPI cards, "Why it's here", signals. Methodology: descriptive-not-predictive banner, pipeline steps, signals, labels, limits.

## Motion
CSS only: fade-up reveal with small stagger on load, bar grow, card hover lift and glow, radar sweep/blip. Disabled entirely by `prefers-reduced-motion`. No continuous number animation, no JS animation library.

## Client JavaScript
Server Components except `NavLinks` (active state via `usePathname`) and the Explore view (`useSearchParams`, unchanged from Phase 5).
