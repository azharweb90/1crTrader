# 1CrTrader — Full Build Session Summary (July 2026)

## Project
Frontend-only prototype for Indian retail F&O traders. Discipline enforcement app — not signals. Root: `/home/claude/work/`. Two folders: `website/` (landing/auth) and `app/` (gated app shell).

## Stack
Vanilla HTML + CSS + JS. No build tools. No frameworks. Served via local HTTP server. All state in-memory (resets on reload — biggest known gap).

## Key Files
- `app/index.html` — shell, sidebar nav, tab content slots
- `app/dashboard.js` — ALL shared state, tier rules, business logic (~2672 lines)
- `app/dashboard.css` — all styles (~5968 lines, 874 balanced braces)
- `app/dark-theme.css` — dark mode overrides (~1172 lines, 253 balanced braces), scoped entirely under `body.dark-mode`
- `app/product-tour.css` / `product-tour.js` / `tour-content.js` — spotlight tour engine
- `app/components/*.html` + `*.js` — lazy-loaded per tab

## Brand / Theme
- Sidebar: `linear-gradient(180deg, #0D1E28 0%, #070A0F 100%)`
- Gold accent: `#D4A828`, dark gold: `#B6890F`
- ₹ symbol everywhere (not "Rs.")
- Dark mode: `body.dark-mode` class toggled, persisted `localStorage.darkModeEnabled`
- Font size: CSS `zoom` on `#app-shell`, 5 steps (85/92/100/108/116%), persisted `localStorage.fontSizeStep`

## Tabs (11 total, all lazy-loaded)
| Tab ID | Component | Notes |
|--------|-----------|-------|
| tab-select | tier-select.html | 4-step onboarding wizard |
| tab-dashboard | dashboard-home.html | Separated card layout |
| tab-calculator | calculator.html/js | Daily Limits Tool |
| tab-trade-manager | trade-manager.html/js | Live trade tracker |
| tab-roadmap | roadmap.html/js | Goal simulator + Challenge |
| tab-journal | journal.html/js | Trading Journal |
| tab-education | education.html/js | Static content |
| tab-books | books.html/js | Static content |
| tab-strategies | strategies.html/js | Strategy cards |
| tab-suggestions | suggestions.html/js | List + right-side panel |
| tab-settings | settings.html/js | Account page |
| tab-subs | pricing.html | Subscription pricing |

## Capital Tier & Risk Rules (Single Source of Truth)
- `tierRulesMatrix` in `dashboard.js`, keyed `"small-1"` through `"pro-3"` (12 sub-tiers)
- `getOfficialSubLevelKey()` — sole reader of sub-tier
- `getPerLotMaxLossRupees(lotsUsed)` = `(rule.loss / rule.maxLots) * lotsUsed`
- `getCurrentMaxLossRupees()`, `getMaxAllowedLots()`, `getRiskSummary()` all on window
- Ratchet: `highestOfficialSubLevelNum` / `highestOfficialSubLevelTier` — one-way unlock only
- Points SL = perLotBudget / (qty × lots) — NOT flat tier loss (critical, was a bug, now fixed)

## Dashboard (dashboard-home.html/js)
- Uses `dash-home-wrap` + `dash-section-card` pattern (separated boxes, not one merged white box)
- 4 stat cards (`dash-stat-grid`), risk rules card (`dash-risk-wrap`), Jump Back In, Recent Activity
- Jump Back In: Daily Limits Tool → Trade Manager → Roadmap → Trading Journal (Account removed)
- Quicklink icons: SVG line icons with gold tint bg (`rgba(212,168,40,0.15)` in dark mode)

## Profile Setup (tier-select.html)
- 4-step wizard: Broker → Trading style → Instruments → Confirm
- "← Back to broker selection" link added (calls `showBrokerSetup()`)
- Footer note has `padding: 16px 32px 20px` (no longer touches the box)
- Dark mode: stepper dots/bars, broker tiles, instrument picker, security note all covered

## Daily Limits Tool (calculator.html/js)
- Two collapsed reference sections (instrument SL table, tier reference table)
- Broker calendar: no default range, real weekday-aligned 7-col grid
- **"Import This Day" now opens a RIGHT-SIDE PANEL** (`.suggestions-panel-overlay` pattern)
  - `showBrokerDayDetail()` opens `broker-import-panel-overlay`
  - Panel shows scrip table + import confirm inside it
  - `closeBrokerImportPanel()` / `closeBrokerImportPanelIfOutside()` on window
- Trade log: outcome-btn states, profit-decision-card, calc-history all dark-mode covered

## Trade Manager (trade-manager.html/js)
**Setup panel (two-column layout):**
- Left col (inputs, ~65%): CE/PUT type pills only (Future/Equity removed), scrip name, entry/SL/target, lots stepper with max-lots warning, R:R quick-pick pills (1:1–1:10, selected pill stays highlighted), price hints ("30 pts risk")
- Right col (metrics, 300px sticky): Risk (₹ + % of balance), Reward (₹ + % of balance), Est. Margin — all update live as user types
- **"Import Trade" opens a RIGHT-SIDE PANEL** (same pattern as suggestions), not a modal
  - Panel has: scrip, buy price, qty, execution time, CE/PE selector
  - `applyBrokerImport()` pre-fills the form and guesses lots from qty
  - `closeTmImportPanel()` / `closeTmImportPanelIfOutside()` on window

**Active tracking (two-column):**
- Left: chart (SVG, real price axis, candles, level pills on right edge)
- Right: result card ALWAYS visible (not below chart) — shows pts in favor, unrealized ₹, trailing SL
- Current price field is INLINE next to the direction badge (top of active card, not below)
- Direction badge: "▲ Long — Call (CE)" / "▼ Short — Put (PE)"
- "End this trade" is a styled secondary button with × icon (not a plain link)
- Trailing SL: `computeTrailingSl(riskPoints, pointsInFavor)` in dashboard.js
- Result cards: target hit (🎉), stopped-locked (🛡️), stopped-neutral (↩️), open (live)

## Roadmap (roadmap.html/js) — Rebuilt
**3 sections + Challenge:**
1. Balance card + tier track (separated)
2. Goal Simulator: gold slider ₹10L–₹1Cr + custom input box. Shows metric cards (Trades Needed, Est. Days, Win Rate, Gap). When NOT REACHABLE → shows red status + two what-if sliders (Win Rate + Avg Profit) that update metrics live
3. Personal Challenge: "Set Challenge" gold button opens `rm-challenge-modal-overlay` (center modal). Sets target ₹ + date + name. Shows progress bar, days remaining, daily ₹ needed, gained so far
4. Daily Log History table

## Suggestions (suggestions.html/js)
- Compact title-only list, click opens right-side slide-in panel (420px)
- `FLAT_ITEMS` index for Previous/Next across category boundaries
- 3 categories × 4 items = 12 total

## Trading Journal (journal.html) — Rebuilt
- Uses `dash-home-wrap` + `dash-section-card` for separation
- Sections: Rule Adherence Analysis, Stats bar, Filter row, Trade list, Entry form

## Product Tour
- **Engine**: `product-tour.js` — generic spotlight (4 dim panels + gold border + tooltip)
- **Content**: `tour-content.js` — 11 tabs, 2–4 steps each, `window.TOUR_CONTENT`
- **Trigger**: `startTabTourIfNeeded(tabId)` in `switchTab().then()` with 300ms delay
- **Seen-state**: `localStorage` key `tourSeen:tab-XXX`
- **Resource Hub**: permanent `?` FAB (bottom-right, gold gradient)
  - `toggleResourceHubPanel()` — opens panel with "Replay this page's tour" + all tours list
  - `replayTourFromHub(tabId)` — switches tab if needed, then starts tour
  - `closeBrokerImportPanel` / `closeResourceHubPanel` on window

## Dark Mode Architecture
- `dark-theme.css` — SEPARATE FILE, every rule scoped under `body.dark-mode`
- Never edit `dashboard.css` for dark mode colors
- Cross-check: every class in dark-theme.css must exist in dashboard.css (script catches stale refs)
- Key colors: page bg `#0F1115`, card bg `#1A1D23`, inner panel `#20232A`, border `#2A2E36`
- Quicklink icons: `rgba(212,168,40,0.15)` bg + `#D4A828` stroke in dark mode

## Right-Side Panel Pattern (used across app)
Reuse `.suggestions-panel-overlay` + `.suggestions-panel` for ALL right-side panels:
- Daily Limits broker import: `broker-import-panel-overlay`
- Trade Manager import: `tm-import-panel-overlay`
- Suggestions: `suggestions-panel-overlay`
- Overlay background: `rgba(20,35,61,0.32)`, panel 420–480px wide, slides in from right

## localStorage Keys
- `darkModeEnabled` — dark mode preference
- `fontSizeStep` — font size step 0–4
- `tourSeen:tab-XXX` — per-tab tour seen state
- `REFERENCE_COLLAPSE_STORAGE_PREFIX` + sectionId — collapsible section state
- `1crtrader_session`, `1crtrader_accounts` — mock auth

## Known Platform Gaps (unchanged)
- All state in-memory — resets on page reload
- No real broker API — mock `generateMockBrokerPnlHistory()`
- No payment gateway
- `auth.js` is a mock session layer
- Cooldown in `calculator.js` should be `30 * 60 * 1000` for prod (not `10 * 1000`)

## Working Style
- Direct corrections, "don't ask questions, just do it" for straightforward changes
- CSS: never add class to dark-theme.css without verifying it exists in dashboard.css
- Iterate: ship → review in context → correct/revert based on real usage
- Pattern: `dash-home-wrap` + `dash-section-card` for separated-box layouts across ALL tabs
- ALL ₹ symbols used (145+ replacements done, no "Rs." remains)
