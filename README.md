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

**Running locally:** serve the project **root** with a static server (e.g.
VS Code Live Server) so that `../website/...` and `../app/...` relative
paths resolve correctly — don't serve `website/` and `app/` as separate
roots, and don't open files via `file://`.
