/* ===========================================================
   FIRST-RUN ONBOARDING MODAL — "Discipline Features" handoff, Feature 4.

   A blocking, full-screen modal shown once, before a trader's first
   session, that locks in, one screen at a time: (1) Connect a broker or
   enter capital manually — step 1; (2) trading style, split into
   Discipline Mode / Risk Dashboard Mode panels — step 2; (3) the tier/
   daily loss limit/drawdown limit that step 1's capital DERIVES, plus an
   OPTIONAL personal "stop rule" — a note from calm-you to tilted-you
   that reappears later on the Cool-Down Lock screen (Feature 3, not yet
   built) — step 3; (4) a summary/finish screen — step 4. Steps 1 and 2
   used to be one combined screen; split apart per explicit direction to
   cut down how much a trader has to take in on one screen — see
   step1Html()/step2Html() below.

   Re-ordered per earlier explicit direction: connecting a broker is what
   fetches the real balance, so it has to come BEFORE the tier/limits
   screen that depends on it, not after (the tier used to be a manual
   6-card pick on step 1, with broker connect + trading style on step 2
   as a purely cosmetic add-on that deliberately never touched capital —
   see git history / onbConnectBroker()'s old comment for that earlier
   design). Manual capital entry is kept as an explicit fallback for
   someone who won't connect a broker — the trade-off being every trade
   then has to be logged by hand in the Daily Limits Tool instead of
   syncing automatically, which its own hint copy says outright.

   Step 1 calls straight into app-shell.js's real global functions
   instead of re-implementing them: window.connectBroker() +
   window.generateMockFetchedBalance() for the (mock) broker fetch,
   window.selectTraderType() for the trading-style multi-select (reuses
   the real selectedTraderTypes Set + .trader-type-card DOM class
   toggling), and window.setStartingCapitalDirect() + window.confirmProfile()
   on finish to land on the dashboard exactly as the old page's
   "Continue to dashboard" did. The tier-select page/tab itself is
   untouched and still exists as a fallback (Skip for now, later "Edit
   Profile") — onboarding just no longer routes its own first-run
   completion through it.

   Self-contained global overlay, same pattern as product-tour.js: it
   creates its own DOM on load and exposes onbNext/onbBack/etc. on
   window, called from inline onclick handlers in the markup it injects
   itself (no separate .html fragment / lazy-load — this must be able
   to show before any tab component has necessarily finished loading).

   Reuses the real tierRulesMatrix (tier-rules.js) for all tier numbers —
   now derived across all 12 real keys via deriveTierKeyFromCapital(),
   not a curated 6-card picker like before, since the fetched/entered
   capital can land anywhere in that range — and the shared
   .setup-cta-btn / .setup-wizard-back-btn button classes already used
   by the tier-select page, so buttons look identical to the page this
   modal hands off into.

   PROTOTYPE NOTE (see README "Production requirements"): the onboarded
   flag, chosen tier, and stop note are persisted to localStorage only.
   In production these must live on the user's server-side record so
   they survive reload / reinstall / re-login — localStorage alone is
   not enough long-term, same caveat already true of this app's other
   client-only state.
   =========================================================== */

(function () {

  const ONB_DONE_KEY = 'onb_done';
  const ONB_SKIPPED_KEY = 'onb_skipped'; // set only by onbSkip() — see hasOnboarded()
  const ONB_TIER_KEY = 'onb_tier';
  const ONB_NOTE_KEY = 'dlt_stop_note';

  const DEFAULT_STOP_NOTE =
    "I stop when I hit my limit because pushing further is how I turn a bad day into a disaster. " +
    "The market is open again tomorrow. My edge is discipline — protecting my capital IS the trade.";

  // All 12 real tierRulesMatrix keys now need labels (not just a curated
  // 6), since the tier is derived from whatever capital gets fetched or
  // entered, not picked from a shortlist — see deriveTierKeyFromCapital().
  const ONB_TIER_LABELS = {
    'small-1': 'Small - Level 1',
    'small-2': 'Small - Level 2',
    'small-3': 'Small - Level 3',
    'medium-1': 'Medium - Level 1',
    'medium-2': 'Medium - Level 2',
    'medium-3': 'Medium - Level 3',
    'large-1': 'Large - Level 1',
    'large-2': 'Large - Level 2',
    'large-3': 'Large - Level 3',
    'pro-1': 'Pro - Level 1',
    'pro-2': 'Pro - Level 2',
    'pro-3': 'Pro - Level 3',
  };

  // Picks the highest tierRulesMatrix key whose nominal capital band the
  // given amount qualifies for — same "highest band the balance clears"
  // logic as app-shell.js's own tierForBalance(), just at the full
  // 12-key granularity that function doesn't expose (it only returns
  // the broad small/medium/large/pro tier).
  function deriveTierKeyFromCapital(amount) {
    const matrix = window.tierRulesMatrix || {};
    const keys = Object.keys(matrix).sort((a, b) => matrix[a].cap - matrix[b].cap);
    let best = keys[0] || null;
    keys.forEach((k) => {
      if (matrix[k].cap <= amount) best = k;
    });
    return best;
  }

  // The 4 featured brokers, matching app-shell.js's own BROKERS array
  // (name/initial/colorClass) and SETUP_BROKER_TAGS copy exactly, kept
  // as a small local copy rather than reaching into that closure-private
  // array — step 2's broker cards are intentionally a separate, simpler
  // UI (see the state comment above for why they can't reuse the page's
  // own broker-picker wiring wholesale).
  const ONB_BROKERS = [
    { name: 'Zerodha', initial: 'Z', colorClass: 'broker-chip-orange', tag: "India's #1 broker" },
    { name: 'Groww', initial: 'G', colorClass: 'broker-chip-teal', tag: 'Fast onboarding' },
    { name: 'Angel One', initial: 'A', colorClass: 'broker-chip-red', tag: 'Full-service' },
    { name: 'Upstox', initial: 'U', colorClass: 'broker-chip-purple', tag: 'Low brokerage' },
  ];

  // Same 8 trading styles as the tier-select page (TRADER_TYPE_LABELS in
  // app-shell.js) with their descriptive copy — step 1's cards use the
  // real .trader-type-card class + data-trader-type attribute + the real
  // window.selectTraderType(), so clicking here updates the SAME
  // selectedTraderTypes Set the rest of the app reads, not a local copy.
  //
  // `mode` is new: "Discipline Mode" (Option Buyer/Scalper/Equity/Swing)
  // keeps the old max-2-trades/day + cooldown + 75%/100% soft-block/hard-
  // stop shape; "Risk Dashboard Mode" (Option Seller/Hedged Seller/
  // Spread Trader/Futures Trader) drops the trade-count cap entirely —
  // each combined multi-leg position counts as ONE entry, with a single
  // circuit breaker on total loss/drawdown instead. Grouped into two
  // panels below (see step1Html()) rather than 8 flat cards, since which
  // mode a style belongs to is now load-bearing information, not
  // decoration. Actual ENFORCEMENT of these two modes (Daily Limits
  // Tool submission flow, circuit breaker, etc.) is a separate, much
  // larger follow-up — this pass only covers the onboarding picker.
  const ONB_TRADER_TYPES = [
    { key: 'option-buyer', name: 'Option Buyer', desc: 'Buys call/put options. Capital required is the option premium.', mode: 'discipline' },
    { key: 'equity-trader', name: 'Equity / Cash Trader', desc: 'Buys and sells stocks directly, no derivatives. Full share value.', mode: 'discipline' },
    { key: 'scalper', name: 'Scalper', desc: 'Very short holding periods — seconds to minutes, small frequent gains.', mode: 'discipline' },
    { key: 'swing-trader', name: 'Swing Trader', desc: 'Holds positions for days to weeks, riding a broader move.', mode: 'discipline' },
    { key: 'option-seller', name: 'Option Seller', desc: 'Writes (sells) call/put options. Requires margin, similar to futures.', mode: 'risk-dashboard' },
    { key: 'futures-trader', name: 'Futures Trader', desc: 'Trades futures contracts directly. Requires the highest margin.', mode: 'risk-dashboard' },
    { key: 'hedged-seller', name: 'Hedged Seller', desc: 'Sells futures and buys an option for hedging to limit downside.', mode: 'risk-dashboard' },
    { key: 'spread-trader', name: 'Spread Trader', desc: 'Combines option legs (verticals, iron condors) for defined, capped risk.', mode: 'risk-dashboard' },
  ];

  const ONB_MODE_INFO = {
    discipline: {
      label: 'Discipline Mode',
      summary: 'Max 2 trades/day, with a soft-block at 75% loss and a hard stop at 100% (Scalper skips the 75% block — only the full max-loss hit ends the day).',
    },
    'risk-dashboard': {
      label: 'Risk Dashboard Mode',
      summary: 'No trade-count cap — log each combined position (e.g. hedge or spread) as ONE entry. A single circuit breaker on total loss and drawdown ends the day instead.',
    },
  };

  let onbStep = 0;       // 0 = welcome, 1 = broker connect (or manual), 2 = trading style, 3 = derived tier/loss/drawdown + optional stop rule, 4 = summary/finish
  let onbCapital = null; // rupees — the real fetched-or-entered amount driving onbTier; null until step 1 sets it
  let onbTier = '';      // e.g. 'medium-1' — DERIVED from onbCapital via deriveTierKeyFromCapital(), never picked directly
  let onbNote = DEFAULT_STOP_NOTE;
  let onbStopOpen = false; // has the trader expanded the optional "Add a personal stop rule" row?

  // Step 1 broker state. Connecting a broker now DOES set capital/tier
  // (via onbCapital, above) — a deliberate reversal of the old design,
  // where step 2's broker connect was cosmetic-only so it couldn't
  // clobber a tier already picked on step 1. Now that broker connect
  // IS step 1's primary purpose, calling window.connectBroker() +
  // window.generateMockFetchedBalance() directly (rather than the page's
  // own window.startSetupBrokerConnect()) is still the right call — that
  // function also touches selectedInstruments, which onboarding
  // deliberately doesn't manage (instruments step was cut earlier).
  let onbBrokerConnecting = '';
  let onbConnectedBroker = '';
  let onbActiveTab = 'broker'; // 'broker' | 'manual' — which of the two equal-billing tabs is showing


  // Bug: onb_done persists across reloads, but app-shell.js's actual
  // profile state (tier/capital/etc.) is in-memory only and resets on
  // every reload — a documented prototype limitation (see app-shell.js's
  // own confirmProfile()/DOMContentLoaded comments; real persistence is
  // a separate, larger change). That mismatch meant a returning user
  // with onb_done='1' but no live tier saw the overlay skip itself
  // (hasOnboarded() true) while app-shell.js still fell back to loading
  // the old raw tab-select "Set up your profile" page with nothing
  // covering it — instead of either page reflecting a real completed
  // setup. Requiring real state too makes onb_done alone insufficient,
  // so a fresh reload correctly re-opens this overlay (the intended
  // "once per session" flow) instead of exposing that page.
  function hasOnboarded() {
    // Explicit "Skip for now" (step 0 only) is its own permanent choice —
    // never force this overlay back on someone who deliberately opted
    // into the old tab-select fallback instead, even though that fallback
    // has no tier/capital of its own to check for.
    if (localStorage.getItem(ONB_SKIPPED_KEY) === '1') return true;
    if (localStorage.getItem(ONB_DONE_KEY) !== '1') return false;
    const state = typeof window.getProfileState === 'function' ? window.getProfileState() : null;
    return !!(state && state.tier && state.startingCapital !== null);
  }

  function markOnboarded() {
    localStorage.setItem(ONB_DONE_KEY, '1');
  }

  function getTierData(key) {
    const matrix = window.tierRulesMatrix || {};
    return matrix[key] || null;
  }

  // ---------- Overlay lifecycle ----------

  // Left-panel checklist copy — maps onto the single combined step
  // (tier -> loss limit -> optional stop rule) so the promo panel and
  // the form panel visibly track the same journey instead of the left
  // side being static decoration. See updateChecklist().
  const ONB_CHECKLIST = [
    { n: 1, text: 'A capital tier that sets your real max lot size — not a guess.' },
    { n: 2, text: "A hard daily loss cap you can't override in the heat of the moment." },
    { n: 3, text: 'An optional personal stop rule, from calm-you, for the day you need it most.' },
  ];

  function ensureOverlayExists() {
    if (document.getElementById('onb-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'onb-overlay';
    overlay.className = 'onb-overlay hidden';

    const checklistHtml = ONB_CHECKLIST.map(item => `
      <div class="onb-check-item" data-check="${item.n}">
        <span class="onb-check-icon"></span>
        <span class="onb-check-text">${item.text}</span>
      </div>
    `).join('');

    overlay.innerHTML = `
      <div class="onb-left">
        <div class="onb-logo-row">
          <img src="/assets/images/logos/1crtraders-icon.png" alt="" class="onb-logo-icon">
          <div>
            <div class="onb-logo-name">1Cr Traders</div>
            <div class="onb-logo-tag">REWARD ABOVE RISK</div>
          </div>
        </div>
        <div class="onb-left-mid">
          <div class="onb-eyebrow">Before your first trade</div>
          <h2 class="onb-headline">Every rule here exists because a trader broke it once.</h2>
          <p class="onb-left-sub">Sixty seconds now buys you the discipline most traders only learn after losing real money. Here's what you're setting up:</p>
          <div class="onb-checklist" id="onb-checklist">${checklistHtml}</div>
          <div class="onb-left-quote">"The goal isn't to win every trade. It's to still be trading next year." That's the whole reason 1CrTraders exists.</div>
        </div>
        <div class="onb-left-bottom">
          <div class="onb-avatars">
            <img src="/assets/images/avatars/deepika-trading-femme.png" alt="" class="onb-avatar">
            <img src="/assets/images/avatars/gautham-jha.png" alt="" class="onb-avatar">
            <img src="/assets/images/avatars/mayank-raj-traderoom.png" alt="" class="onb-avatar">
          </div>
          <div class="onb-social-text">Join 12,000+ disciplined traders</div>
        </div>
      </div>
      <div class="onb-right">
        <div class="onb-right-inner">
          <div id="onb-progress" class="onb-progress hidden">
            <div class="onb-progress-bar" id="onb-progress-bar">
              <span class="onb-progress-seg" data-seg="1"></span>
              <span class="onb-progress-seg" data-seg="2"></span>
              <span class="onb-progress-seg" data-seg="3"></span>
              <span class="onb-progress-seg" data-seg="4"></span>
            </div>
            <div class="onb-step-eyebrow">STEP <span id="onb-step-num">1</span> OF 4</div>
          </div>
          <div id="onb-step-body"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  // Syncs the left-panel checklist to what's actually been decided so
  // far. Item 1 (tier) and item 2 (daily loss cap) both track onbCapital
  // now, since connecting a broker or entering capital manually on step
  // 1 derives both at once — there's no separate "accept the limit"
  // step. Step 2 (trading style) doesn't have its own checklist item, so
  // items 1/2 just stay done there. Item 3 (stop rule) lives on step 3
  // now, alongside the derived tier/loss/drawdown display. Step 4 (the
  // done screen) marks everything complete.
  function updateChecklist() {
    const items = document.querySelectorAll('#onb-checklist .onb-check-item');
    items.forEach(item => {
      const n = parseInt(item.dataset.check, 10);
      item.classList.remove('onb-check-item-active', 'onb-check-item-done');
      if (onbStep >= 4) {
        item.classList.add('onb-check-item-done');
        return;
      }
      if (onbStep === 1) {
        if (n === 1) item.classList.add(onbCapital ? 'onb-check-item-done' : 'onb-check-item-active');
        else if (n === 2 && onbCapital) item.classList.add('onb-check-item-done');
        return;
      }
      if (onbStep === 2) {
        if (n === 1 || n === 2) item.classList.add('onb-check-item-done');
        return;
      }
      if (onbStep === 3) {
        if (n === 1 || n === 2) {
          item.classList.add('onb-check-item-done');
        } else if (n === 3 && onbStopOpen) {
          // Optional — only ever reads as "active" while the trader has
          // the accordion open, never forced to "done".
          item.classList.add('onb-check-item-active');
        }
      }
    });
  }

  // Set by plan-confirmed-page.js's setUpRules() right before it
  // redirects here — that page already served step 0's "welcome,
  // let's set up your rules" purpose (with its own "You're all set"
  // messaging), so starting this overlay on ANOTHER welcome screen
  // would be redundant. Read once and cleared immediately so it can
  // never leak into a later, unrelated onboarding run.
  const ONB_START_STEP_KEY = 'onb_start_step';

  function openOnboarding() {
    ensureOverlayExists();
    const requestedStep = localStorage.getItem(ONB_START_STEP_KEY);
    localStorage.removeItem(ONB_START_STEP_KEY);
    onbStep = requestedStep === '1' ? 1 : 0;
    onbCapital = null;
    onbTier = '';
    onbNote = DEFAULT_STOP_NOTE;
    onbStopOpen = false;
    onbBrokerConnecting = '';
    onbConnectedBroker = '';
    onbActiveTab = 'broker';
    const overlay = document.getElementById('onb-overlay');
    if (overlay) overlay.classList.remove('hidden');
    renderStep();
  }

  function closeOnboarding() {
    const overlay = document.getElementById('onb-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  // ---------- Step rendering ----------

  function renderStep() {
    const progress = document.getElementById('onb-progress');
    const body = document.getElementById('onb-step-body');
    if (!progress || !body) return;

    if (onbStep === 0) {
      progress.classList.add('hidden');
    } else {
      progress.classList.remove('hidden');
      const stepNumEl = document.getElementById('onb-step-num');
      if (stepNumEl) stepNumEl.innerText = String(onbStep);
      progress.querySelectorAll('.onb-progress-seg').forEach(seg => {
        const n = parseInt(seg.dataset.seg, 10);
        seg.classList.toggle('onb-progress-seg-done', n <= onbStep);
      });
    }

    updateChecklist();

    body.innerHTML = stepHtml();

    // Textarea value is set via the DOM (not templated into innerHTML)
    // so the stop-note text never has to be HTML-escaped. Only present
    // at all once the optional stop-rule accordion is expanded.
    if (onbStep === 3 && onbStopOpen) {
      const noteEl = document.getElementById('onb-note-input');
      if (noteEl) noteEl.value = onbNote;
    }

    // Back/Continue always sit inline at the end of the card content, not
    // as a fixed bar floating over the viewport — per explicit direction,
    // even on a taller step like Trading style where content can exceed
    // the viewport (a fixed bar was tried first here; rejected for
    // covering content / sitting over the OS taskbar with dead space
    // below it on shorter steps). See .onb-footer-inline /
    // .onb-right-static-footer in onboarding.css — .onb-footer's own
    // fixed/hidden-by-default rules are unused now but left in place
    // rather than deleted, same reasoning as this file's other dead-CSS
    // notes.
    const footer = body.querySelector('.onb-footer');
    if (footer) footer.classList.add('onb-footer-inline', 'onb-footer-visible');
    const right = document.querySelector('#onb-overlay .onb-right');
    if (right) right.classList.add('onb-right-static-footer');
  }

  function stepHtml() {
    if (onbStep === 0) return step0Html();
    if (onbStep === 1) return step1Html();
    if (onbStep === 2) return step2Html();
    if (onbStep === 3) return step3Html();
    return step4Html();
  }

  function step0Html() {
    return `
      <div class="onb-step onb-step0">
        <img src="/assets/images/logos/1crtraders-icon.png" alt="" class="onb-icon">
        <h2 class="onb-heading">Welcome to 1Cr Traders</h2>
        <p class="onb-body">Before your first trade, let's lock in the rules that protect you. It takes 60 seconds — and it's the reason traders here don't blow up.</p>
        <button type="button" class="setup-cta-btn" onclick="onbNext()">Set up my rules</button>
        <button type="button" class="onb-skip-link" onclick="onbSkip()">Skip for now</button>
      </div>
    `;
  }

  // Step 1 — Broker Sync (primary; fetches balance, derives tier — see
  // onbConnectBroker()) or Manual Entry (equal-billing tab now, not a
  // tucked-away link — the product decision is that manual-only trading
  // is a first-class supported path, same as the rest of the app already
  // treats it: Daily Limits Tool logs trades by hand, Trading Hours has
  // its own honest empty state for manual accounts, etc.). Split out from
  // trading style (now its own step2Html()) per explicit direction to cut
  // how much a trader has to take in on one screen — kept as its own
  // step rather than merging back, even though both used to share a
  // screen. Gated on just onbCapital being set; style selection happens
  // next.
  function step1Html() {
    // Card grid only ever renders while nothing's connected yet — once a
    // broker IS connected, the grid gives way entirely to
    // onb-broker-connected-card below (see brokerPane), so isConnected
    // never actually applies to a rendered card here; kept simple rather
    // than carrying dead per-card "connected" styling for a state this
    // grid can no longer be in.
    const brokerCards = ONB_BROKERS.map(b => {
      const isConnecting = onbBrokerConnecting === b.name;
      return `
        <button type="button" class="setup-broker-card onb-broker-card" ${isConnecting ? 'disabled' : ''} onclick="onbConnectBroker('${b.name}')">
          <span class="setup-broker-icon ${b.colorClass}">${b.initial}</span>
          <span style="min-width:0;">
            <div class="setup-broker-card-name">${b.name}</div>
            <div class="setup-broker-card-tag">${isConnecting ? 'Connecting…' : b.tag}</div>
          </span>
        </button>
      `;
    }).join('');

    // Broker Sync pane: the pick-a-broker grid until connected, then a
    // dedicated connected-state card instead of the grid (not alongside
    // it) — shows the fetched balance/tier plainly instead of burying
    // them in a one-line banner, plus "Change" (pick a different broker)
    // and an explicit "Disconnect" action, since a trader should be able
    // to walk this back fully, not just switch. Both currently do the
    // same full reset (onbDisconnectBroker()) — "Change" reopens the
    // grid to pick again, "Disconnect" is the same action framed for
    // someone who wants Broker Sync off entirely (e.g. to switch to
    // Manual Entry, which this also unlocks).
    const connectedBrokerInfo = ONB_BROKERS.find(b => b.name === onbConnectedBroker);
    const brokerPane = onbConnectedBroker ? `
      <div class="onb-broker-connected-card">
        <div class="onb-broker-connected-head">
          <span class="setup-broker-icon ${connectedBrokerInfo ? connectedBrokerInfo.colorClass : ''}">${connectedBrokerInfo ? connectedBrokerInfo.initial : onbConnectedBroker.charAt(0)}</span>
          <div class="onb-broker-connected-info">
            <div class="onb-broker-connected-title-row">
              <span class="onb-broker-connected-title">Connected to ${onbConnectedBroker}</span>
              <span class="onb-broker-live-badge"><span class="onb-broker-live-dot"></span>Live</span>
            </div>
            <div class="onb-broker-connected-sub">Read-only · balance and positions synced</div>
          </div>
          <div class="onb-broker-connected-actions">
            <button type="button" class="onb-broker-change-link" onclick="onbDisconnectBroker()">Change</button>
            <button type="button" class="onb-broker-disconnect-link" onclick="onbDisconnectBroker()">Disconnect</button>
          </div>
        </div>
        <div class="onb-broker-stat-row">
          <div class="onb-broker-stat">
            <div class="onb-broker-stat-label">Fetched balance</div>
            <div class="onb-broker-stat-value">₹${fmt(onbCapital)}</div>
          </div>
          <div class="onb-broker-stat">
            <div class="onb-broker-stat-label">Tier</div>
            <div class="onb-broker-stat-value onb-broker-stat-value-accent">${ONB_TIER_LABELS[onbTier] || onbTier}</div>
          </div>
        </div>
      </div>
    ` : `
      <div class="broker-grid onb-broker-grid">${brokerCards}</div>
      <p class="onb-broker-more-note">+ 6 more brokers coming soon</p>
    `;

    // Manual Entry pane: input form until confirmed, then a "selected"
    // summary card (mirrors a connected broker card) with an edit link
    // and an explicit reminder that Broker Sync is still one tab away —
    // switching later (from Account) starts syncing going forward, it
    // doesn't retroactively reconcile whatever was logged by hand.
    const manualConfirmed = onbCapital && !onbConnectedBroker;
    const manualPane = manualConfirmed ? `
      <div class="onb-manual-selected-card">
        <span class="onb-manual-selected-icon">₹</span>
        <span>
          <div class="onb-manual-selected-title">Manual Entry selected</div>
          <div class="onb-manual-selected-desc">No broker needed — you'll log each trade yourself, starting from a ₹${fmt(onbCapital)} balance. <button type="button" class="onb-manual-edit-link" onclick="onbEditManualCapital()">Change amount</button></div>
        </span>
      </div>
      <p class="onb-manual-switch-note">Switch to Broker Sync anytime from Account — trades already logged by hand won't be reconciled automatically.</p>
    ` : `
      <div class="onb-manual-box">
        <label class="onb-manual-label" for="onb-manual-input">Starting capital (₹)</label>
        <div class="onb-manual-input-row">
          <input id="onb-manual-input" type="number" min="1" step="1" class="onb-manual-input" placeholder="e.g. 100000">
          <button type="button" class="onb-manual-use-btn" onclick="onbUseManualCapital()">Use this</button>
        </div>
        <p class="onb-manual-hint">Every trade you take will need to be logged by hand in the Daily Limits Tool. You can switch to Broker Sync anytime from Account to start syncing automatically instead.</p>
      </div>
    `;

    // A connected broker always wins the pane, regardless of which tab
    // was last clicked — Manual Entry is locked while a broker is
    // connected (disconnect first) rather than letting both sources be
    // "selected" at once, which is what onbSwitchTab()'s own guard
    // enforces on the click side too.
    const manualLocked = !!onbConnectedBroker;
    const activeTab = manualLocked ? 'broker' : onbActiveTab;
    const canContinue = !!onbCapital;

    return `
      <div class="onb-step onb-step2">
        <div class="onb-card">
          <h2 class="onb-heading onb-heading-left">Connect your broker</h2>
          <p class="onb-sub">Broker Sync is read-only — we fetch your balance and set your tier automatically, never place trades or move funds. No broker to connect? Use Manual Entry instead and log trades yourself.</p>

          <div class="onb-source-toggle">
            <button type="button" class="onb-source-tab ${activeTab === 'broker' ? 'onb-source-tab-active' : ''}" onclick="onbSwitchTab('broker')">Broker Sync</button>
            <button type="button" class="onb-source-tab ${activeTab === 'manual' ? 'onb-source-tab-active' : ''} ${manualLocked ? 'onb-source-tab-disabled' : ''}" ${manualLocked ? 'disabled title="Disconnect your broker to use Manual Entry"' : ''} onclick="onbSwitchTab('manual')">Manual Entry</button>
          </div>

          ${activeTab === 'broker' ? brokerPane : manualPane}
        </div>

        <div class="onb-footer">
          <div class="onb-footer-inner">
            <button type="button" class="setup-wizard-back-btn" onclick="onbBack()">Back</button>
            <button type="button" id="onb-step1-continue-btn" class="setup-cta-btn" style="width:auto;flex:1;" ${canContinue ? '' : 'disabled'} onclick="onbNext()">Continue</button>
          </div>
        </div>
      </div>
    `;
  }

  // Step 2 — Trading style, split out from step 1's broker/manual screen
  // (see step1Html()'s comment) so a trader isn't asked to absorb broker
  // connection AND style selection on one screen.
  //
  // Went through a couple other layouts before landing back here, per
  // explicit direction each time: briefly rebuilt as a Broker-Sync/
  // Manual-Entry-style tab toggle showing one mode at a time — reverted
  // because tabs read as "pick one," but a trader can select styles from
  // BOTH modes at once (that's what the mixed-mode note below is for),
  // which doesn't fit a single-select tab metaphor. Landed on: two
  // stacked panels, always both visible, header-only tint (see
  // .onb-mode-panel / .onb-mode-panel-header in onboarding.css — the
  // card grid below each header sits on white, not the tinted panel
  // background). Gated on at least one style picked across EITHER panel;
  // onbCapital was already locked in by step 1.
  function step2Html() {
    const selected = (typeof window.getSelectedTraderTypes === 'function') ? window.getSelectedTraderTypes() : [];

    function renderModePanel(mode) {
      const info = ONB_MODE_INFO[mode];
      const cards = ONB_TRADER_TYPES.filter(st => st.mode === mode).map(st => {
        const isSelected = selected.indexOf(st.key) !== -1;
        return `
          <button type="button" class="trader-type-card ${isSelected ? 'selected' : ''}" data-trader-type="${st.key}" onclick="onbToggleStyle('${st.key}')">
            <div class="trader-type-name">${st.name}</div>
            <div class="trader-type-desc">${st.desc}</div>
          </button>
        `;
      }).join('');
      return `
        <div class="onb-mode-panel onb-mode-panel-${mode}">
          <div class="onb-mode-panel-header">
            <div class="onb-mode-panel-label">${info.label}</div>
            <p class="onb-mode-panel-summary">${info.summary}</p>
          </div>
          <div class="trader-type-grid onb-style-grid onb-mode-panel-grid">${cards}</div>
        </div>
      `;
    }

    // Picking from BOTH panels makes Risk Dashboard Mode apply to the
    // whole account, not a blended/parallel system (flagged in the spec
    // as a possible follow-up, not final) — the note just makes that
    // override visible instead of silent.
    const hasDiscipline = selected.some(k => { const st = ONB_TRADER_TYPES.find(x => x.key === k); return st && st.mode === 'discipline'; });
    const hasRiskDashboard = selected.some(k => { const st = ONB_TRADER_TYPES.find(x => x.key === k); return st && st.mode === 'risk-dashboard'; });
    const mixedNote = (hasDiscipline && hasRiskDashboard) ? `
      <div class="onb-mixed-note">
        <span class="onb-mixed-note-icon">&#128161;</span>
        <span>You've selected both Discipline-style and Risk Dashboard-style trading. Risk Dashboard Mode will apply — no trade-count cap, tracked instead on total loss and drawdown — since it's active for any seller or hedging style you pick.</span>
      </div>
    ` : '';

    const canContinue = selected.length > 0;

    return `
      <div class="onb-step onb-step2">
        <div class="onb-card">
          <div class="onb-style-header">
            <h2 class="onb-heading onb-heading-left onb-style-heading">Trading style</h2>
            <button type="button" class="onb-select-all-link" onclick="onbSelectAllStyles()">Select all</button>
          </div>
          ${renderModePanel('discipline')}
          ${renderModePanel('risk-dashboard')}
          ${mixedNote}
        </div>

        <div class="onb-footer">
          <div class="onb-footer-inner">
            <button type="button" class="setup-wizard-back-btn" onclick="onbBack()">Back</button>
            <button type="button" id="onb-step2-continue-btn" class="setup-cta-btn" style="width:auto;flex:1;" ${canContinue ? '' : 'disabled'} onclick="onbNext()">Continue</button>
          </div>
        </div>
      </div>
    `;
  }

  // Step 3 — the tier/daily loss limit/drawdown limit that step 1's
  // fetched-or-entered capital derived, displayed read-only (no picker
  // — "Changeable later in Account" if they want a different tier), plus
  // the optional stop rule. A recap banner up top (connection/capital +
  // trading style) makes this screen self-contained — the trader
  // shouldn't have to remember steps 1 & 2's choices to trust these
  // numbers.
  function step3Html() {
    const t = onbTier ? getTierData(onbTier) : null;
    const tierLabel = ONB_TIER_LABELS[onbTier] || 'your';
    const selected = (typeof window.getSelectedTraderTypes === 'function') ? window.getSelectedTraderTypes() : [];
    const styleNames = selected
      .map(k => { const st = ONB_TRADER_TYPES.find(x => x.key === k); return st ? st.name : null; })
      .filter(Boolean)
      .join(', ');

    // "Up to N lots" is a BUYER sizing concept — a fixed number of
    // contracts you hold. It doesn't describe a seller/hedge/spread
    // position, which is margin-sized and (per the Discipline vs Risk
    // Dashboard Mode spec) logged as ONE combined entry with no
    // trade-count cap at all. getEnforcementMode() (app-shell.js) already
    // resolves this the same way the mixed-mode note on step 2 does —
    // any risk-dashboard style selected wins for the whole account — so
    // reusing it here keeps this copy correct for a seller instead of
    // quoting a lot ceiling that was never how their risk is measured.
    const mode = (typeof window.getEnforcementMode === 'function') ? window.getEnforcementMode() : null;
    const isRiskDashboard = mode === 'risk-dashboard';

    const recapBanner = `
      <div class="onb-locked-banner">
        <span class="onb-locked-icon">&#10003;</span>
        <span>${onbConnectedBroker ? `Connected to <strong>${onbConnectedBroker}</strong>` : `₹${fmt(onbCapital)} starting capital set manually`} — trading style: <strong>${styleNames || 'None selected'}</strong></span>
      </div>
    `;

    const sourceText = onbConnectedBroker
      ? `We read ₹${fmt(onbCapital)} from ${onbConnectedBroker} and matched it to the ${tierLabel} tier`
      : `You entered ₹${fmt(onbCapital)}, matched to the ${tierLabel} tier`;

    // Two guardrails shown side by side: the existing per-day loss cap
    // (resets every day) and the total drawdown cap (cumulative across
    // days, doesn't reset) — see drawdownPct/drawdown's comment in
    // tier-rules.js for the 3x-daily formula and what's supposed to
    // happen when it's hit.
    const lossSub = isRiskDashboard
      ? `${Number(t && t.pct).toFixed(2)}% of capital · no trade-count cap — each position counts as one entry · locks out on hit`
      : `${Number(t && t.pct).toFixed(2)}% of capital · up to ${t && t.maxLots} lots · locks out on hit`;
    const lossHtml = t ? `
      <div class="onb-guardrail-grid">
        <div class="onb-loss-callout onb-loss-callout-inline">
          <div class="onb-loss-label">Max loss per day</div>
          <div class="onb-loss-value">₹${fmt(t.loss)}</div>
          <div class="onb-loss-sub">${lossSub}</div>
        </div>
        <div class="onb-drawdown-callout">
          <div class="onb-drawdown-label">Max drawdown limit</div>
          <div class="onb-drawdown-value">₹${fmt(t.drawdown)}</div>
          <div class="onb-drawdown-sub">${Number(t.drawdownPct).toFixed(0)}% of capital, total · stops losses from stacking</div>
        </div>
      </div>
    ` : '';

    const stopRuleHtml = `
      <div class="onb-stoprule ${onbStopOpen ? 'onb-stoprule-open' : ''}">
        <button type="button" class="onb-stoprule-toggle" onclick="onbToggleStopRule()">
          <span class="onb-stoprule-plus">${onbStopOpen ? '−' : '+'}</span>
          <span>Add a personal stop rule (optional)</span>
        </button>
        ${onbStopOpen ? `
          <div class="onb-stoprule-body">
            <p class="onb-stoprule-hint">A message from calm-you to tilted-you — shown back to you if you ever hit your limit.</p>
            <textarea id="onb-note-input" class="onb-note-textarea" oninput="onbNoteInput()"></textarea>
          </div>
        ` : ''}
      </div>
    `;

    return `
      <div class="onb-step">
        ${recapBanner}
        <h2 class="onb-heading onb-heading-left">Your rules, set from your balance</h2>
        <p class="onb-sub">${sourceText} — your ${isRiskDashboard ? 'daily loss and drawdown limits' : 'maximum lot size and daily loss limit'}. Changeable later in Account.</p>
        <div class="onb-card">
          ${lossHtml}
          ${stopRuleHtml}
        </div>
        <div class="onb-footer">
          <div class="onb-footer-inner">
            <button type="button" class="setup-wizard-back-btn" onclick="onbBack()">Back</button>
            <button type="button" class="setup-cta-btn" style="width:auto;flex:1;" onclick="onbNext()">Continue</button>
          </div>
        </div>
      </div>
    `;
  }

  // Step 4 — Summary/finish. Restates what steps 1-3 locked in, plus
  // two rows those steps didn't show on their own: the balance that
  // will be seeded (same ₹ figure setStartingCapitalDirect() actually
  // sets — see onbFinishSetup() — labeled per whether a broker was
  // connected, since that's optional) and which trading styles were
  // picked. "View dashboard" is the actual finish action.
  function step4Html() {
    const key = onbTier || 'medium-1';
    const t = getTierData(key) || { loss: 0, maxLots: 0, cap: 0, drawdown: 0 };
    const selected = (typeof window.getSelectedTraderTypes === 'function') ? window.getSelectedTraderTypes() : [];
    const styleNames = selected
      .map(k => { const st = ONB_TRADER_TYPES.find(x => x.key === k); return st ? st.name : null; })
      .filter(Boolean)
      .join(', ');

    const balanceRow = onbConnectedBroker
      ? `₹${fmt(onbCapital)} balance synced from ${onbConnectedBroker}`
      : `₹${fmt(onbCapital)} starting capital set manually`;

    // Same mode-aware split as step3Html()'s lossSub — "up to N lots" and
    // "max 2 trades/day" are both Discipline (buyer-side) concepts; a
    // Risk Dashboard trader (any seller/hedge/spread/futures style) has
    // no lot ceiling or trade-count cap at all, tracked instead on total
    // loss/drawdown via a single circuit breaker.
    const mode = (typeof window.getEnforcementMode === 'function') ? window.getEnforcementMode() : null;
    const isRiskDashboard = mode === 'risk-dashboard';
    const tierRow = isRiskDashboard
      ? `${ONB_TIER_LABELS[key] || 'Medium - Level 1'} tier`
      : `${ONB_TIER_LABELS[key] || 'Medium - Level 1'} tier · up to ${t.maxLots} lots`;
    const tradeRuleRow = isRiskDashboard
      ? 'No trade-count cap · combined positions count as one entry · single circuit breaker'
      : 'Max 2 trades/day · 30-min cooldown';

    return `
      <div class="onb-step onb-step-done">
        <div class="onb-done-check">✓</div>
        <h2 class="onb-heading">You're set up to trade with discipline</h2>
        <div class="onb-summary-list">
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> ${tierRow}</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> ₹${fmt(t.loss)} daily loss limit · hard lock-out</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> ₹${fmt(t.drawdown)} max drawdown limit · total, doesn't reset daily</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> ${balanceRow}</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> Trading style: ${styleNames || 'None selected'}</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> ${tradeRuleRow}</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> ${onbStopOpen ? 'Personal stop rule saved' : 'Default stop rule saved — editable in Account'}</div>
        </div>
        <button type="button" class="setup-cta-btn" onclick="onbFinishSetup()">View dashboard</button>
      </div>
    `;
  }

  // ---------- Step behavior ----------

  function onbNext() {
    if (onbStep === 1 && !onbCapital) return;
    if (onbStep === 2) {
      const count = (typeof window.getSelectedTraderTypes === 'function') ? window.getSelectedTraderTypes().length : 0;
      if (count === 0) return;
    }
    if (onbStep < 4) onbStep++;
    renderStep();
  }

  function onbBack() {
    if (onbStep === 0) return;
    onbStep--;
    renderStep();
  }

  function onbToggleStopRule() {
    onbStopOpen = !onbStopOpen;
    renderStep();
    if (onbStopOpen) {
      const noteEl = document.getElementById('onb-note-input');
      if (noteEl) noteEl.focus();
    }
  }

  function onbNoteInput() {
    const el = document.getElementById('onb-note-input');
    if (el) onbNote = el.value;
  }

  function onbSkip() {
    // Step 0 only, per spec — persists the seen flag but sets no tier;
    // the app falls back to whatever default the setup page itself uses.
    // Uses its own key (not just markOnboarded()'s onb_done) so
    // hasOnboarded() can tell "deliberately skipped" apart from
    // "completed but state reset on reload" — see hasOnboarded().
    markOnboarded();
    localStorage.setItem(ONB_SKIPPED_KEY, '1');
    closeOnboarding();
  }

  // ---------- Step 1 behavior (broker / manual / trading style) ----------

  // Full re-render (not just a button-state patch) on every toggle, since
  // a single card flipping can also flip the mixed-mode note's
  // visibility — a lighter button-only update (what this used to do
  // before the mode-panel split) would leave that note stale until the
  // next full render.
  function onbToggleStyle(key) {
    if (typeof window.selectTraderType === 'function') window.selectTraderType(key);
    renderStep();
  }

  // Selects every style across BOTH panels — both are always visible on
  // this step (see step2Html()), so unlike a per-tab "select all" there's
  // only one sensible scope here: everything.
  function onbSelectAllStyles() {
    ONB_TRADER_TYPES.forEach(st => {
      const card = document.querySelector('.trader-type-card[data-trader-type="' + st.key + '"]');
      if (card && !card.classList.contains('selected') && typeof window.selectTraderType === 'function') {
        window.selectTraderType(st.key);
      }
    });
    renderStep();
  }

  // Mock-connects a broker and — unlike the old design — this now DOES
  // fetch a balance and derive the tier from it (window.connectBroker()
  // for the connection itself, window.generateMockFetchedBalance() +
  // deriveTierKeyFromCapital() for what it fetches). Deliberately still
  // not window.startSetupBrokerConnect()/applyFetchedBrokerProfile(),
  // since that also sets selectedInstruments — onboarding dropped the
  // instruments step earlier and shouldn't reach into that.
  function onbConnectBroker(name) {
    if (onbBrokerConnecting || onbConnectedBroker === name) return;
    onbBrokerConnecting = name;
    renderStep();
    const onDone = () => {
      onbBrokerConnecting = '';
      onbConnectedBroker = name;
      const balance = (typeof window.generateMockFetchedBalance === 'function') ? window.generateMockFetchedBalance() : 100000;
      onbCapital = balance;
      onbTier = deriveTierKeyFromCapital(balance);
      renderStep();
    };
    if (typeof window.connectBroker === 'function') {
      window.connectBroker(name, onDone);
    } else {
      setTimeout(onDone, 1400);
    }
  }

  // Full control over a broker connection — reachable from the connected
  // card's own "tap to disconnect" tag and from the fetched-balance
  // banner's explicit Disconnect button (step1Html()). Clears the fetched
  // capital/tier along with the connection itself, since both were
  // derived from it; the trader lands back on an empty Broker Sync pane
  // (or can switch to Manual Entry, now unlocked again) rather than
  // keeping a stale balance around with nothing backing it.
  function onbDisconnectBroker() {
    onbConnectedBroker = '';
    onbBrokerConnecting = '';
    onbCapital = null;
    onbTier = '';
    renderStep();
  }

  // Switches between the two equal-billing tabs. Deliberately does NOT
  // clear onbCapital/onbConnectedBroker just from previewing the other
  // tab — capital only changes when an action actually completes
  // (onbConnectBroker()'s onDone, or onbUseManualCapital() below), so
  // tapping back and forth doesn't lose what was already set. Manual
  // Entry is locked out entirely while a broker is connected — see
  // step1Html()'s manualLocked — so this just refuses that switch rather
  // than trusting the (normally disabled) button not to fire.
  function onbSwitchTab(tab) {
    if (tab === 'manual' && onbConnectedBroker) return;
    onbActiveTab = tab;
    renderStep();
    if (tab === 'manual' && !(onbCapital && !onbConnectedBroker)) {
      const el = document.getElementById('onb-manual-input');
      if (el) el.focus();
    }
  }

  // Manual Entry fallback — sets onbCapital/onbTier directly from the
  // typed amount, same derivation a broker fetch would use. Clears any
  // prior broker connection so the "selected" card and step 3's summary
  // don't claim a sync that isn't real anymore.
  function onbUseManualCapital() {
    const el = document.getElementById('onb-manual-input');
    const amount = el ? parseFloat(el.value) : NaN;
    if (!amount || amount <= 0) return;
    onbConnectedBroker = '';
    onbCapital = amount;
    onbTier = deriveTierKeyFromCapital(amount);
    renderStep();
  }

  // "Change amount" on the confirmed Manual Entry card — clears the
  // manually-set capital so the input form reappears instead of the
  // summary card. Only ever reachable when capital came from manual
  // entry in the first place (see manualConfirmed in step1Html()).
  function onbEditManualCapital() {
    onbCapital = null;
    onbTier = '';
    renderStep();
    const el = document.getElementById('onb-manual-input');
    if (el) el.focus();
  }

  // Final "Continue to dashboard" action — sets the real fetched-or-
  // entered capital directly (see setStartingCapitalDirect()'s comment
  // in app-shell.js), then hands off to the real confirmProfile(), which
  // marks the profile complete and switches into the Dashboard tab
  // exactly as the old standalone page's own "Continue to dashboard"
  // button did.
  function onbFinishSetup() {
    const key = onbTier || 'medium-1';
    markOnboarded();
    localStorage.setItem(ONB_TIER_KEY, key);
    localStorage.setItem(ONB_NOTE_KEY, onbNote || DEFAULT_STOP_NOTE);

    if (onbCapital && typeof window.setStartingCapitalDirect === 'function') {
      window.setStartingCapitalDirect(onbCapital);
    }
    if (typeof window.confirmProfile === 'function') {
      window.confirmProfile();
    }
    closeOnboarding();
  }

  // ---------- Boot ----------

  function initOnboarding() {
    if (hasOnboarded()) return;
    // Now that a real auth gate exists (auth-service.js), app-shell.js's
    // own DOMContentLoaded handler redirects an un-authed visitor to
    // /src/marketing/pages/auth/auth-page.html — but that redirect isn't
    // instant, and this listener fires on the same DOMContentLoaded
    // event. Without this check, the modal could flash open for a
    // moment before the redirect kicks in. If Auth isn't loaded at all
    // (auth-service.js missing), fall back to the old behavior of just
    // showing the modal, matching app-shell.js's own fallback.
    if (typeof window.Auth !== 'undefined' && !window.Auth.getSession()) return;
    openOnboarding();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOnboarding);
  } else {
    initOnboarding();
  }

  window.onbNext = onbNext;
  window.onbBack = onbBack;
  window.onbToggleStopRule = onbToggleStopRule;
  window.onbNoteInput = onbNoteInput;
  window.onbSkip = onbSkip;
  window.onbToggleStyle = onbToggleStyle;
  window.onbSelectAllStyles = onbSelectAllStyles;
  window.onbConnectBroker = onbConnectBroker;
  window.onbDisconnectBroker = onbDisconnectBroker;
  window.onbSwitchTab = onbSwitchTab;
  window.onbUseManualCapital = onbUseManualCapital;
  window.onbEditManualCapital = onbEditManualCapital;
  window.onbFinishSetup = onbFinishSetup;

})();