# 1crTrader
This project is for the retail traders how they can become successful with proper roadmap.

## Project structure

**Refactored (July 2026)** to a React-ready layout — see `docs/architecture/` for the full
migration strategy this structure follows. The codebase is still a frontend-only prototype
(no build tools, no frameworks) but every folder below maps 1:1 onto a future `src/` tree once
a bundler is introduced.

```
docs/                 Reference docs — architecture notes, product specs, source PDFs
assets/               Static, unprocessed files — images, logos, fonts. Never imported by JS logic.
public/               Reserved for root-served static files (favicon, robots.txt) once hosted for real.

src/
  marketing/          Public-facing site. No dependency on src/app's code.
    pages/
      landing/          Marketing landing page (was website/index.html)
      auth/             Login / Register / Forgot Password / OTP / Reset Password
    services/
      auth-service.js   Mock auth engine (accounts, session, OTP — localStorage only)

  app/                The actual trading-discipline application. Requires a session.
    app-shell.html      App shell (sidebar, top bar, tab containers)
    app-shell.js        Shared app state, tab switching, broker mocks, auth gate, tier/risk rules
    layout/             Reserved — Sidebar/TopBar/ResourceHub, currently still inline in app-shell.*
    features/           One folder per tab (tier-select, dashboard-home, daily-limits,
                         trade-manager, roadmap, trading-journal, education, books,
                         strategies, suggestions, settings, pricing)
    shared/             Reserved — risk-engine, state, mock-broker, utils will move here
                         out of app-shell.js in a later pass
    styles/
      dashboard.css      All app styles (still one file — see docs/architecture for the
                          planned split into styles/components/*.css)
      themes/
        dark-theme.css   Dark mode overrides, scoped entirely under body.dark-mode
      components/        Reserved — per-feature CSS files, extracted from dashboard.css
    product-tour/
      product-tour.js/css   Spotlight tour engine
      tour-content.js       Per-tab tour step data

_archive/             Dead/unused files kept for reference — not wired into the app. See its README.
```

**How the two talk to each other:** `src/app/app-shell.html` loads
`/src/marketing/services/auth-service.js` so `window.Auth` is available for its session gate.
`src/app/app-shell.js` redirects to `/src/marketing/pages/auth/auth-page.html?view=login` when
there's no session or on logout (the logout handler lives here, not in individual features —
`settings.js` just triggers it).
`src/marketing/pages/auth/auth-page.html` redirects to `/src/app/app-shell.html` after a
successful login/register. That's the entire surface area of coupling — no shared CSS, no
shared component code, no shared state beyond `Auth`.

**Running locally:** serve the project **root** with any static server (VS Code Live Server,
`npx serve`, `python3 -m http.server`, etc.) — all internal links and asset references are
**root-relative** (e.g. `/src/app/styles/dashboard.css`, `/src/marketing/pages/auth/auth-page.html`),
so they resolve correctly regardless of trailing slashes or which static server you use. Don't
open files via `file://`; a real HTTP origin is required either way.

Entry points:
- App: `/src/app/app-shell.html`
- Marketing site: `/src/marketing/pages/landing/landing-page.html`

This also means the project deploys cleanly as-is to any static host (GitHub Pages, Netlify,
Vercel, etc.) as long as it's served from the domain root. If it's ever served from a sub-path
(e.g. `yoursite.com/1crtrader/`), the root-relative paths would need to be updated to include
that prefix.
