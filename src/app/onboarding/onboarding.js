/* ===========================================================
   FIRST-RUN ONBOARDING MODAL — "Discipline Features" handoff, Feature 4.

   A blocking, full-screen modal shown once, before a trader's first
   session, that locks in: (1) a capital tier, (2) the daily loss limit
   that tier carries — revealed inline the instant a tier is picked,
   not a separate step — and (3) an OPTIONAL personal "stop rule" — a
   note from calm-you to tilted-you that reappears later on the
   Cool-Down Lock screen (Feature 3, not yet built). All three live on
   a single "STEP 1 OF 2" screen; step 2 is Connect broker + Trading
   style (see the next paragraph). Collapsed from an earlier 4-step
   version per the trader's design reference — the loss limit and stop
   rule no longer force their own mandatory screens.

   Per the trader's latest design pass: this modal now absorbs what used
   to be a separate hand-off — the "Set Up Your Profile" page (tier-select)
   — as its own step 2 (Connect your broker + Trading style). Step 1's
   chosen tier is the single source of truth for starting capital; step 2
   calls straight into app-shell.js's real global functions instead of
   re-implementing them: window.connectBroker() for the (mock, optional)
   broker cards, window.selectTraderType() for the trading-style
   multi-select (reuses the real selectedTraderTypes Set + .trader-type-card
   DOM class toggling), and window.setStartingCapitalDirect() +
   window.confirmProfile() on finish to land on the dashboard exactly as
   the old page's "Continue to dashboard" did. The tier-select page/tab
   itself is untouched and still exists as a fallback (Skip for now,
   later "Edit Profile") — onboarding just no longer routes its own
   first-run completion through it.

   Self-contained global overlay, same pattern as product-tour.js: it
   creates its own DOM on load and exposes onbNext/onbBack/etc. on
   window, called from inline onclick handlers in the markup it injects
   itself (no separate .html fragment / lazy-load — this must be able
   to show before any tab component has necessarily finished loading).

   Reuses the real tierRulesMatrix (tier-rules.js) for all tier numbers
   — the 6 curated bands here are a subset of its 12 keys, not new
   hardcoded data — and the shared .setup-cta-btn / .setup-wizard-back-btn
   button classes already used by the tier-select page, so buttons look
   identical to the page this modal hands off into.

   PROTOTYPE NOTE (see README "Production requirements"): the onboarded
   flag, chosen tier, and stop note are persisted to localStorage only.
   In production these must live on the user's server-side record so
   they survive reload / reinstall / re-login — localStorage alone is
   not enough long-term, same caveat already true of this app's other
   client-only state.
   =========================================================== */

(function () {

  const ONB_DONE_KEY = 'onb_done';
  const ONB_TIER_KEY = 'onb_tier';
  const ONB_NOTE_KEY = 'dlt_stop_note';

  const DEFAULT_STOP_NOTE =
    "I stop when I hit my limit because pushing further is how I turn a bad day into a disaster. " +
    "The market is open again tomorrow. My edge is discipline — protecting my capital IS the trade.";

  // Curated 6-band picker for Step 1 — a deliberate subset of the app's
  // real 12-key tierRulesMatrix (tier-rules.js), matching the README's
  // spec exactly (small1/small2/medium1/medium2/large1/pro1) rather than
  // showing all 12 sub-levels in a first-run modal.
  const ONB_TIER_KEYS = ['small-1', 'small-2', 'medium-1', 'medium-2', 'large-1', 'pro-1'];
  const ONB_TIER_LABELS = {
    'small-1': 'Small - Level 1',
    'small-2': 'Small - Level 2',
    'medium-1': 'Medium - Level 1',
    'medium-2': 'Medium - Level 2',
    'large-1': 'Large - Level 1',
    'pro-1': 'Pro - Level 1',
  };

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
  // app-shell.js) with their descriptive copy — step 2's cards use the
  // real .trader-type-card class + data-trader-type attribute + the real
  // window.selectTraderType(), so clicking here updates the SAME
  // selectedTraderTypes Set the rest of the app reads, not a local copy.
  const ONB_TRADER_TYPES = [
    { key: 'option-buyer', name: 'Option Buyer', desc: 'Buys call/put options. Capital required is the option premium.' },
    { key: 'option-seller', name: 'Option Seller', desc: 'Writes (sells) call/put options. Requires margin, similar to futures.' },
    { key: 'futures-trader', name: 'Futures Trader', desc: 'Trades futures contracts directly. Requires the highest margin.' },
    { key: 'hedged-seller', name: 'Hedged Seller', desc: 'Sells futures and buys an option for hedging to limit downside.' },
    { key: 'equity-trader', name: 'Equity / Cash Trader', desc: 'Buys and sells stocks directly, no derivatives. Full share value.' },
    { key: 'spread-trader', name: 'Spread Trader', desc: 'Combines option legs (verticals, iron condors) for defined, capped risk.' },
    { key: 'scalper', name: 'Scalper', desc: 'Very short holding periods — seconds to minutes, small frequent gains.' },
    { key: 'swing-trader', name: 'Swing Trader', desc: 'Holds positions for days to weeks, riding a broader move.' },
  ];

  let onbStep = 0;      // 0 = welcome, 1 = tier + inline loss reveal + optional stop rule, 2 = broker + trading style, 3 = summary/finish
  let onbTier = '';     // e.g. 'medium-1' — '' until picked
  let onbNote = DEFAULT_STOP_NOTE;
  let onbStopOpen = false; // has the trader expanded the optional "Add a personal stop rule" row?

  // Step 2 broker state — deliberately separate from app-shell.js's own
  // connectedBrokerName. Connecting a broker here is optional/cosmetic
  // (just calls the real window.connectBroker() mock so the dashboard's
  // broker-sync UI reflects it later); it must NEVER touch capital/tier,
  // since those are locked in from step 1 already. This is why step 2
  // calls window.connectBroker() directly rather than the page's own
  // window.startSetupBrokerConnect(), which derives a brand new mock
  // fetched balance and would silently overwrite the trader's chosen tier.
  let onbBrokerConnecting = '';
  let onbConnectedBroker = '';

  function hasOnboarded() {
    return localStorage.getItem(ONB_DONE_KEY) === '1';
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
            </div>
            <div class="onb-step-eyebrow">STEP <span id="onb-step-num">1</span> OF 3</div>
          </div>
          <div id="onb-step-body"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  // Syncs the left-panel checklist to what's actually been decided so
  // far — all three items now live on the same step 1 screen, so this
  // reads live tier/stop-rule state rather than just the step number.
  // Step 2 (the done screen) marks everything complete.
  function updateChecklist() {
    const items = document.querySelectorAll('#onb-checklist .onb-check-item');
    items.forEach(item => {
      const n = parseInt(item.dataset.check, 10);
      item.classList.remove('onb-check-item-active', 'onb-check-item-done');
      if (onbStep >= 2) {
        item.classList.add('onb-check-item-done');
        return;
      }
      if (onbStep !== 1) return;
      if (n === 1) {
        item.classList.add(onbTier ? 'onb-check-item-done' : 'onb-check-item-active');
      } else if (n === 2) {
        // The daily loss cap is derived the instant a tier is picked —
        // there's no separate "accept the limit" step anymore.
        if (onbTier) item.classList.add('onb-check-item-done');
      } else if (n === 3) {
        // Optional — only ever reads as "active" while the trader has
        // the accordion open, never forced to "done".
        if (onbStopOpen) item.classList.add('onb-check-item-active');
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
    onbTier = '';
    onbNote = DEFAULT_STOP_NOTE;
    onbStopOpen = false;
    onbBrokerConnecting = '';
    onbConnectedBroker = '';
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
    if (onbStep === 1 && onbStopOpen) {
      const noteEl = document.getElementById('onb-note-input');
      if (noteEl) noteEl.value = onbNote;
    }
  }

  function stepHtml() {
    if (onbStep === 0) return step0Html();
    if (onbStep === 1) return step1Html();
    if (onbStep === 2) return step2Html();
    return step3Html();
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

  // Tier + daily loss limit + optional stop rule, all on one screen —
  // the loss box reveals inline the instant a tier is picked (no
  // separate "accept the limit" step), and the stop rule is an
  // optional collapsible row rather than a mandatory step.
  function step1Html() {
    const cards = ONB_TIER_KEYS.map(key => {
      const t = getTierData(key);
      if (!t) return '';
      const selected = onbTier === key;
      return `
        <button type="button" class="onb-tier-row ${selected ? 'onb-tier-row-selected' : ''}" onclick="onbPickTier('${key}')">
          <span class="onb-tier-radio ${selected ? 'onb-tier-radio-selected' : ''}"></span>
          <span class="onb-tier-row-text">
            <span class="onb-tier-name">${ONB_TIER_LABELS[key]}</span>
            <span class="onb-tier-meta">Daily loss limit ₹${fmt(t.loss)} · up to ${t.maxLots} lot${t.maxLots > 1 ? 's' : ''}</span>
          </span>
        </button>
      `;
    }).join('');

    const t = onbTier ? getTierData(onbTier) : null;
    const lossHtml = t ? `
      <div class="onb-loss-callout onb-loss-callout-inline">
        <div class="onb-loss-label">Max loss per day</div>
        <div class="onb-loss-value">₹${fmt(t.loss)}</div>
        <div class="onb-loss-sub">${Number(t.pct).toFixed(2)}% of your capital · up to ${t.maxLots} lots per trade. Hit it and 1CrTraders locks you out for the rest of the day — no exceptions.</div>
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
        <h2 class="onb-heading onb-heading-left">What are you trading with?</h2>
        <p class="onb-sub">Pick your capital band. This sets your tier — your maximum lot size and daily loss limit. Changeable later in Account.</p>
        <div class="onb-card">
          <div class="onb-tier-list">${cards}</div>
          ${lossHtml}
          ${stopRuleHtml}
        </div>
        <div class="onb-footer">
          <div class="onb-footer-inner">
            <button type="button" class="setup-wizard-back-btn" onclick="onbBack()">Back</button>
            <button type="button" class="setup-cta-btn" style="width:auto;flex:1;" ${onbTier ? '' : 'disabled'} onclick="onbNext()">Continue</button>
          </div>
        </div>
      </div>
    `;
  }

  // Step 2 — Connect broker (optional, mock) + Trading style (required,
  // multi-select). Hands off to step 3's summary screen rather than
  // finishing directly — Tier/loss are already locked from step 1
  // (shown in the banner up top, never re-derived here — see
  // onbConnectBroker()'s comment for why broker connection must not
  // touch them).
  function step2Html() {
    const key = onbTier || 'medium-1';
    const t = getTierData(key) || { loss: 0, maxLots: 0 };
    const selected = (typeof window.getSelectedTraderTypes === 'function') ? window.getSelectedTraderTypes() : [];

    const brokerCards = ONB_BROKERS.map(b => {
      const isConnecting = onbBrokerConnecting === b.name;
      const isConnected = onbConnectedBroker === b.name;
      return `
        <button type="button" class="setup-broker-card onb-broker-card ${isConnected ? 'onb-broker-card-connected' : ''}" ${isConnecting ? 'disabled' : ''} onclick="onbConnectBroker('${b.name}')">
          <span class="setup-broker-icon ${b.colorClass}">${isConnected ? '&#10003;' : b.initial}</span>
          <span style="min-width:0;">
            <div class="setup-broker-card-name">${b.name}</div>
            <div class="setup-broker-card-tag">${isConnecting ? 'Connecting…' : (isConnected ? 'Connected' : b.tag)}</div>
          </span>
        </button>
      `;
    }).join('');

    const styleCards = ONB_TRADER_TYPES.map(st => {
      const isSelected = selected.indexOf(st.key) !== -1;
      return `
        <button type="button" class="trader-type-card ${isSelected ? 'selected' : ''}" data-trader-type="${st.key}" onclick="onbToggleStyle('${st.key}')">
          <div class="trader-type-name">${st.name}</div>
          <div class="trader-type-desc">${st.desc}</div>
        </button>
      `;
    }).join('');

    return `
      <div class="onb-step onb-step2">
        <div class="onb-locked-banner">
          <span class="onb-locked-icon">&#10003;</span>
          <span>Rules locked in — <strong>${ONB_TIER_LABELS[key] || 'Medium - Level 1'}</strong> tier, ₹${fmt(t.loss)} daily limit, ${onbStopOpen ? 'stop rule' : 'default stop rule'} saved</span>
        </div>

        <div class="onb-card">
          <h2 class="onb-heading onb-heading-left">Connect your broker</h2>
          <p class="onb-sub">Read-only — we fetch your balance and tier automatically, never place trades or move funds.</p>
          <div class="broker-grid onb-broker-grid">${brokerCards}</div>
          <p class="onb-broker-more-note">+ 6 more brokers coming soon</p>
        </div>

        <div class="onb-card">
          <div class="onb-style-header">
            <h2 class="onb-heading onb-heading-left onb-style-heading">Trading style</h2>
            <button type="button" class="onb-select-all-link" onclick="onbSelectAllStyles()">Select all</button>
          </div>
          <div class="trader-type-grid onb-style-grid">${styleCards}</div>
        </div>

        <div class="onb-footer">
          <div class="onb-footer-inner">
            <button type="button" class="setup-wizard-back-btn" onclick="onbBack()">Back</button>
            <button type="button" id="onb-step2-continue-btn" class="setup-cta-btn" style="width:auto;flex:1;" ${selected.length ? '' : 'disabled'} onclick="onbNext()">Continue</button>
          </div>
        </div>
      </div>
    `;
  }

  // Step 3 — Summary/finish. Restates what steps 1 & 2 locked in, plus
  // two rows those steps didn't show on their own: the balance that
  // will be seeded (same ₹ figure setStartingCapitalDirect() actually
  // sets — see onbFinishSetup() — labeled per whether a broker was
  // connected, since that's optional) and which trading styles were
  // picked. "View dashboard" is the actual finish action.
  function step3Html() {
    const key = onbTier || 'medium-1';
    const t = getTierData(key) || { loss: 0, maxLots: 0, cap: 0 };
    const selected = (typeof window.getSelectedTraderTypes === 'function') ? window.getSelectedTraderTypes() : [];
    const styleNames = selected
      .map(k => { const st = ONB_TRADER_TYPES.find(x => x.key === k); return st ? st.name : null; })
      .filter(Boolean)
      .join(', ');

    const balanceRow = onbConnectedBroker
      ? `₹${fmt(t.cap)} balance synced from ${onbConnectedBroker}`
      : `₹${fmt(t.cap)} starting capital set`;

    return `
      <div class="onb-step onb-step-done">
        <div class="onb-done-check">✓</div>
        <h2 class="onb-heading">You're set up to trade with discipline</h2>
        <div class="onb-summary-list">
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> ${ONB_TIER_LABELS[key] || 'Medium - Level 1'} tier · up to ${t.maxLots} lots</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> ₹${fmt(t.loss)} daily loss limit · hard lock-out</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> ${balanceRow}</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> Trading style: ${styleNames || 'None selected'}</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> Max 2 trades/day · 30-min cooldown</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> ${onbStopOpen ? 'Personal stop rule saved' : 'Default stop rule saved — editable in Account'}</div>
        </div>
        <button type="button" class="setup-cta-btn" onclick="onbFinishSetup()">View dashboard</button>
      </div>
    `;
  }

  // ---------- Step behavior ----------

  function onbNext() {
    if (onbStep === 1 && !onbTier) return;
    if (onbStep === 2) {
      const count = (typeof window.getSelectedTraderTypes === 'function') ? window.getSelectedTraderTypes().length : 0;
      if (count === 0) return;
    }
    if (onbStep < 3) onbStep++;
    renderStep();
  }

  function onbBack() {
    if (onbStep === 0) return;
    onbStep--;
    renderStep();
  }

  function onbPickTier(key) {
    onbTier = key;
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
    markOnboarded();
    closeOnboarding();
  }

  // ---------- Step 2 behavior ----------

  function onbToggleStyle(key) {
    if (typeof window.selectTraderType === 'function') window.selectTraderType(key);
    onbUpdateStep2Continue();
  }

  function onbSelectAllStyles() {
    ONB_TRADER_TYPES.forEach(st => {
      const card = document.querySelector('.trader-type-card[data-trader-type="' + st.key + '"]');
      if (card && !card.classList.contains('selected') && typeof window.selectTraderType === 'function') {
        window.selectTraderType(st.key);
      }
    });
    onbUpdateStep2Continue();
  }

  // Keeps the "Continue to dashboard" button's disabled state in sync
  // with real selection state — window.selectTraderType() only knows
  // about the OLD page's #setup-cta-btn (which doesn't exist here, so it
  // safely no-ops), so this step has to drive its own button directly.
  function onbUpdateStep2Continue() {
    const btn = document.getElementById('onb-step2-continue-btn');
    if (!btn) return;
    const count = (typeof window.getSelectedTraderTypes === 'function') ? window.getSelectedTraderTypes().length : 0;
    btn.disabled = count === 0;
  }

  // Mock-connects a broker for step 2's own display purposes only — calls
  // the real window.connectBroker() (sets connectedBrokerName so the
  // dashboard's broker-sync UI reflects it later) but deliberately NOT
  // window.startSetupBrokerConnect(), which derives a brand new mock
  // fetched balance/tier and would silently overwrite the tier the
  // trader already locked in on step 1.
  function onbConnectBroker(name) {
    if (onbBrokerConnecting || onbConnectedBroker === name) return;
    onbBrokerConnecting = name;
    renderStep();
    const onDone = () => {
      onbBrokerConnecting = '';
      onbConnectedBroker = name;
      renderStep();
    };
    if (typeof window.connectBroker === 'function') {
      window.connectBroker(name, onDone);
    } else {
      setTimeout(onDone, 1400);
    }
  }

  // Final "Continue to dashboard" action — sets the locked-in tier's
  // capital directly (see setStartingCapitalDirect()'s comment in
  // app-shell.js for why this no longer routes through the tier-select
  // page's manual-capital input), then hands off to the real
  // confirmProfile(), which marks the profile complete and switches into
  // the Dashboard tab exactly as the old standalone page's own
  // "Continue to dashboard" button did.
  function onbFinishSetup() {
    const key = onbTier || 'medium-1';
    const t = getTierData(key);
    markOnboarded();
    localStorage.setItem(ONB_TIER_KEY, key);
    localStorage.setItem(ONB_NOTE_KEY, onbNote || DEFAULT_STOP_NOTE);

    if (t && typeof window.setStartingCapitalDirect === 'function') {
      window.setStartingCapitalDirect(t.cap);
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
  window.onbPickTier = onbPickTier;
  window.onbToggleStopRule = onbToggleStopRule;
  window.onbNoteInput = onbNoteInput;
  window.onbSkip = onbSkip;
  window.onbToggleStyle = onbToggleStyle;
  window.onbSelectAllStyles = onbSelectAllStyles;
  window.onbConnectBroker = onbConnectBroker;
  window.onbFinishSetup = onbFinishSetup;

})();