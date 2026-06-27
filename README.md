# 1crTrader
This project is for the retail traders how they can become successful with proper roadmap .

## Project structure

The codebase is split into two independent folders that share no code —
only the `Auth` data layer (`website/auth.js`, backed by `localStorage`)
crosses the boundary, and only as a runtime dependency, not a build-time one.

```
website/        Public-facing site. No dependency on the app folder's code.
  index.html      Marketing landing page (was landing.html)
  auth.html       Login / Register / Forgot Password / OTP / Reset Password
  auth.js         Mock auth engine (accounts, session, OTP — localStorage only)

app/            The actual trading-discipline application. Requires a session.
  index.html      App shell (sidebar, top bar, tab containers)
  dashboard.js    Shared app state, tab switching, broker mocks, auth gate
  dashboard.css   All app styles
  components/     Lazy-loaded tab fragments (journal, calculator, roadmap, ...)
```

**How the two talk to each other:** `app/index.html` loads
`../website/auth.js` so `window.Auth` is available for its session gate.
`app/dashboard.js` and `app/components/settings.js` redirect to
`../website/auth.html?view=login` when there's no session or on logout.
`website/auth.html` redirects to `../app/index.html` after a successful
login/register. That's the entire surface area of coupling — no shared
CSS, no shared component code, no shared state beyond `Auth`.

**Removed during the split:** `dashboard-index.html` and `webpage.html`
were abandoned drafts (a duplicate app shell and a pre-auth version of the
landing page, respectively) and have been deleted.

**Running locally:** serve the project **root** with any static server (VS
Code Live Server, `npx serve`, `python3 -m http.server`, etc.) — all
internal links and asset references are **root-relative** (e.g.
`/app/dashboard.css`, `/website/auth.html`), so they resolve correctly
regardless of trailing slashes or which static server you use. Don't open
files via `file://`; a real HTTP origin is required either way.

This also means the project deploys cleanly as-is to any static host
(GitHub Pages, Netlify, Vercel, etc.) as long as it's served from the
domain root. If it's ever served from a sub-path (e.g.
`yoursite.com/1crtrader/`), the root-relative paths would need to be
updated to include that prefix.
