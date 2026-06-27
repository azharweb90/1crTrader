/* ===========================================================
   DASHBOARD SHELL LOADER
   Responsibilities:
     - Manage global profile state: selected tier, starting capital,
       running balance, trader type, and trade history
     - Switch between tabs
     - Fetch each component's HTML fragment on first visit
     - Cache fetched fragments so re-visits don't re-fetch
     - Lazy-load a component's own JS file once, only when needed
     - Apply tier highlighting to each component after it loads
     - Detect tier-crossing balance changes and show a congratulations banner
   =========================================================== */

(function () {

  // Unique per page-load, used to cache-bust fetches for HTML fragments and
  // their JS files (see loadComponent below) — guarantees a hard refresh
  // always gets the latest files even on dev servers that cache aggressively.
  const PAGE_LOAD_ID = Date.now();

  // Map of tab id -> { html, js (optional) }
  const COMPONENTS = {
    "tab-select": {
      html: "/app/components/tier-select.html",
    },
    "tab-dashboard": {
      html: "/app/components/dashboard-home.html",
      js: "/app/components/dashboard-home.js",
    },
    "tab-calculator": {
      html: "/app/components/calculator.html",
      js: "/app/components/calculator.js",
    },
    "tab-roadmap": {
      html: "/app/components/roadmap.html",
      js: "/app/components/roadmap.js",
    },
    "tab-journal": {
      html: "/app/components/journal.html",
      js: "/app/components/journal.js",
    },
    "tab-education": {
      html: "/app/components/education.html",
      js: "/app/components/education.js",
    },
    "tab-books": {
      html: "/app/components/books.html",
      js: "/app/components/books.js",
    },
    "tab-strategies": {
      html: "/app/components/strategies.html",
      js: "/app/components/strategies.js",
    },
    "tab-settings": {
      html: "/app/components/settings.html",
      js: "/app/components/settings.js",
    },
    "tab-subs": {
      html: "/app/components/pricing.html",
    },
  };

  // Maps each tab id to the page title shown in the top bar, and to its
  // sidebar link's data-tab attribute for active-state highlighting.
  const PAGE_TITLES = {
    "tab-select": "Set Up Your Profile",
    "tab-dashboard": "Dashboard",
    "tab-calculator": "Daily Limits Tool",
    "tab-roadmap": "Roadmap",
    "tab-journal": "Trading Journal",
    "tab-education": "Education",
    "tab-books": "Books",
    "tab-strategies": "Strategies",
    "tab-settings": "Account",
    "tab-subs": "Subscription Pricing",
  };

  // First sub-level key used to pre-select the calculator dropdown per tier.
  const TIER_FIRST_SUBLEVEL = {
    small: "small-1",
    medium: "medium-1",
    large: "large-1",
    pro: "pro-1",
  };

  const TIER_ORDER = ['small', 'medium', 'large', 'pro'];

  const TIER_LABELS = {
    small: "Small",
    medium: "Medium",
    large: "Large",
    pro: "Pro",
  };

  // Min/max capital range per tier, used to validate the entered amount
  // and to detect when a running balance crosses into a new tier.
  const TIER_RANGES = {
    small:  { min: 25000,    max: 75000 },
    medium: { min: 100000,   max: 500000 },
    large:  { min: 500000,   max: 1000000 },
    pro:    { min: 1000000,  max: 2000000 },
  };

  // Single source of truth for max daily loss by tier+sub-level. Lives here
  // (not in components/calculator.js) because dashboard.js is always loaded
  // and other screens — the Dashboard's risk summary, for one — need this
  // data without depending on the Daily Limits Tool having ever been
  // visited this session. calculator.js reads this via window.tierRulesMatrix
  // instead of keeping its own separate copy.
  //
  // maxLots: how many lots a trader at this sub-tier may trade. This is a
  // property of CAPITAL, not of risk — note that loss does NOT multiply by
  // maxLots (e.g. medium-1/2/3 all sit near 4-5% loss regardless of having
  // 4/6/8 lots available; an extra lot is about spreading/flexibility, not
  // a bigger risk budget). See getMaxAllowedLots() below for how a trader's
  // ENTRY sub-tier (from their base/starting capital) and subsequent +50%
  // BALANCE GROWTH (from originalStartingCapital, compounding) combine to
  // determine their actual current lot allowance.
  const tierRulesMatrix = {
    "small-1":  { cap: 25000,    pct: 7.00, loss: 1750,  maxLots: 1 },
    "small-2":  { cap: 50000,    pct: 6.00, loss: 3000,  maxLots: 2 },
    "small-3":  { cap: 75000,    pct: 5.00, loss: 3750,  maxLots: 3 },
    "medium-1": { cap: 100000,   pct: 4.00,  loss: 4000,  maxLots: 4 },
    "medium-2": { cap: 300000,   pct: 2.00,  loss: 6000,  maxLots: 6 },
    "medium-3": { cap: 400000,   pct: 2.00,  loss: 8000,  maxLots: 8 },
    "large-1":  { cap: 500000,   pct: 2.00, loss: 10000, maxLots: 8 },
    "large-2":  { cap: 700000,   pct: 2.00, loss: 14000, maxLots: 16 },
    "large-3":  { cap: 900000,   pct: 2.00, loss: 18000, maxLots: 24 },
    "pro-1":    { cap: 1000000,  pct: 2.00, loss: 20000, maxLots: 16 },
    "pro-2":    { cap: 1500000,  pct: 2.00, loss: 30000, maxLots: 32 },
    "pro-3":    { cap: 1900000,  pct: 2.00, loss: 38000, maxLots: 48 },
  };

  // Given a broad tier ('small'..'pro') and a rupee balance, finds which
  // sub-level (1/2/3) that balance falls into, by comparing against each
  // sub-level's cap within that tier — used so the Dashboard's risk summary
  // reflects the trader's CURRENT balance, not always sub-level 1.
  function subLevelForBalance(tier, balance) {
    const subLevels = ['1', '2', '3'].map(n => `${tier}-${n}`).filter(key => tierRulesMatrix[key]);
    if (subLevels.length === 0) return null;

    let chosen = subLevels[0];
    for (const key of subLevels) {
      if (balance >= tierRulesMatrix[key].cap) chosen = key;
    }
    return chosen;
  }

  const TRADER_TYPE_LABELS = {
    "option-buyer": "Option Buyer",
    "option-seller": "Option Seller",
    "futures-trader": "Futures Trader",
    "hedged-seller": "Hedged Seller",
    "equity-trader": "Equity / Cash Trader",
    "spread-trader": "Spread Trader",
    "scalper": "Scalper",
    "swing-trader": "Swing Trader",
  };

  // Lot quantity per instrument (NSE/BSE F&O contracts). Indices first
  // (always available), then a set of popular stock F&O — this is also
  // the mock "broker instrument master" returned by
  // getMockBrokerTradableInstruments() below, standing in for what a real
  // broker's scrip/contract master API would return once connected.
  const INSTRUMENT_INFO = {
    nifty:      { label: "Nifty",      qty: 65,  category: "index" },
    banknifty:  { label: "Bank Nifty", qty: 30,  category: "index" },
    finnifty:   { label: "FinNifty",   qty: 60,  category: "index" },
    sensex:     { label: "Sensex",     qty: 20,  category: "index" },
    reliance:   { label: "Reliance",   qty: 250, category: "stock" },
    tcs:        { label: "TCS",        qty: 125, category: "stock" },
    hdfcbank:   { label: "HDFC Bank",  qty: 550, category: "stock" },
    infy:       { label: "Infosys",    qty: 300, category: "stock" },
    icicibank:  { label: "ICICI Bank", qty: 700, category: "stock" },
    sbin:       { label: "SBI",        qty: 1500, category: "stock" },
    tatamotors: { label: "Tata Motors", qty: 1400, category: "stock" },
    adanient:   { label: "Adani Enterprises", qty: 300, category: "stock" },
  };

  // Returns the mock "broker instrument master" — standing in for what a
  // real broker's contract/scrip master API would return once connected.
  // PROTOTYPE ONLY: this is just the same INSTRUMENT_INFO list above,
  // reshaped into an array. Swap this implementation for a real API call
  // when the backend exists; nothing else needs to change, since the
  // shape (value/label/qty/category) is exactly what the setup screen
  // already expects.
  function getMockBrokerTradableInstruments() {
    return Object.keys(INSTRUMENT_INFO).map(key => ({
      value: key,
      label: INSTRUMENT_INFO[key].label,
      qty: INSTRUMENT_INFO[key].qty,
      category: INSTRUMENT_INFO[key].category,
    }));
  }

  const fragmentCache = {};
  const scriptLoaded = {};

  // ---------- Global profile state ----------
  let selectedTier = null;        // 'small' | 'medium' | 'large' | 'pro' | null
  let selectedTraderTypes = new Set();  // multi-select: any combination of keys from TRADER_TYPE_LABELS above
  let startingCapital = null;     // rupees, entered by the user, validated against tier range
  let currentBalance = null;      // rupees, running balance — starts equal to startingCapital,
                                   // then shifts as trade P&L is applied (hook for the calculator)
  let profileConfirmed = false;   // true once "Continue to Dashboard" has been clicked at least once
  let tradeHistory = [];          // [{ id, date, netResult, balanceAfter }], one entry per submitted trade
  let journalEntries = {};        // { [tradeId]: { tradeDetails, execution, logic, psychology, score, grade } }
  let lastTierForBalance = null;  // tracks which tier bucket the balance was in, to detect crossings
  let pendingCongrats = null;     // { fromTier, toTier } queued until the roadmap screen can show it
  let selectedInstruments = {};   // { nifty: { lots: 1 }, banknifty: { lots: 2 }, ... } — only selected ones are keys
  let customStocks = [];          // ['Reliance', 'TCS', ...] — user's own stock names, freeform
  let joinDate = null;             // YYYY-MM-DD, set once on first profile confirmation — earliest selectable log date
  let originalStartingCapital = null; // rupees, set ONCE on first profile confirmation — never changes again, even
                                       // if startingCapital is later edited via Change Tier. This is the fixed
                                       // baseline the lot-unlock thresholds below are measured against.
  let highestOfficialSubLevelNum = null; // 1/2/3 (or null until profile confirmed) — the highest official
                                          // sub-tier EVER reached via entry-capital + growth. A ratchet, not a
                                          // live computation: a losing day that drops currentBalance below the
                                          // growth threshold must NOT undo a lot/loss tier already earned. See
                                          // getOfficialSubLevelKey() below, the only place this is written to.
  let highestOfficialSubLevelTier = null; // which broad tier highestOfficialSubLevelNum was reached under —
                                           // if selectedTier changes (Change Tier to a different broad tier),
                                           // the ratchet resets, since "sub-tier 3" means something different
                                           // in Small vs. Medium and shouldn't carry across.

  // ---------- Mock broker connection (PROTOTYPE ONLY — no real broker API calls) ----------
  // This entire block simulates what a real Kite Connect / SmartAPI integration would feel
  // like, using fake data generated client-side. Nothing here talks to a real broker. When the
  // real backend exists, this is the seam where actual OAuth + tradebook fetch would replace it.
  let brokerConnected = false;     // true once a mock broker is "connected"
  let connectedBrokerName = null;  // 'Zerodha' | 'Angel One' | 'Upstox' | null
  let lastSyncedAt = null;         // timestamp (ms) of the last successful mock sync, or null

  // (Lot-unlock-by-growth multiplier logic now lives directly in
  // getMaxAllowedLots()/getNextLotUnlockInfo() below, reading maxLots from
  // tierRulesMatrix per sub-tier — see the comment on tierRulesMatrix above
  // for why lot count and risk amount are no longer the same axis.)

  function fmt(n) {
    return Math.round(n).toLocaleString('en-IN');
  }

  function tierForBalance(balance) {
    for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
      const t = TIER_ORDER[i];
      if (balance >= TIER_RANGES[t].min) return t;
    }
    return 'small';
  }

  // ---------- Component loading ----------
  async function loadComponent(tabId) {
    const config = COMPONENTS[tabId];
    const container = document.getElementById(tabId);
    if (!config || !container) return;

    if (fragmentCache[tabId]) {
      applyTierHighlight(tabId);
      return;
    }

    container.innerHTML = '<div class="component-loading">Loading…</div>';

    // Cache-bust both the HTML fragment and its script with a per-pageload
    // timestamp. Static dev servers (e.g. VS Code Live Server) can otherwise
    // serve a stale cached .js for dynamically-injected <script src> tags
    // even after a hard refresh, since the browser doesn't always treat
    // them the same as the initial page's own resources.
    const cacheBust = `v=${PAGE_LOAD_ID}`;
    const htmlUrl = config.html.includes('?') ? `${config.html}&${cacheBust}` : `${config.html}?${cacheBust}`;

    try {
      const res = await fetch(htmlUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      fragmentCache[tabId] = html;
      container.innerHTML = html;

      if (config.js && !scriptLoaded[config.js]) {
        await loadScript(config.js, cacheBust);
        scriptLoaded[config.js] = true;
      }

      applyTierHighlight(tabId);
    } catch (err) {
      container.innerHTML = `<div class="component-error">Could not load this section. (${err.message})</div>`;
    }
  }

  function loadScript(src, cacheBust) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = cacheBust ? (src.includes('?') ? `${src}&${cacheBust}` : `${src}?${cacheBust}`) : src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(script);
    });
  }

  // ---------- Tab switching ----------
  function switchTab(event, tabId) {
    // While still on the very first profile setup (sidebar nav is visually
    // inert, see .sidebar-setup-mode), block navigation away from it via
    // sidebar clicks — there's no profile/balance yet for other tabs to
    // render meaningfully. showTierSelect()/confirmProfile() are unaffected
    // since they call switchTab-adjacent logic directly, not through here
    // with a sidebar-originated event.
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('sidebar-setup-mode') && tabId !== 'tab-select') {
      return;
    }

    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.sidebar-link').forEach(link => link.classList.remove('active'));

    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.add('active');

    const sidebarLink = document.querySelector(`.sidebar-link[data-tab="${tabId}"]`);
    if (sidebarLink) sidebarLink.classList.add('active');
    else if (event && event.currentTarget) {
      event.currentTarget.classList.add('active');
    }

    const titleEl = document.getElementById('top-bar-page-title');
    if (titleEl && PAGE_TITLES[tabId]) {
      titleEl.innerText = PAGE_TITLES[tabId];
    }

    loadComponent(tabId).then(() => {
      if (tabId === 'tab-roadmap') {
        renderPendingCongratsIfReady();
        if (typeof window.renderRoadmap === 'function') {
          window.renderRoadmap();
        }
      }
      if (tabId === 'tab-dashboard' && typeof window.renderDashboardHome === 'function') {
        window.renderDashboardHome();
      }
    });
  }

  // ---------- Profile selection flow (tier + capital + trader type) ----------
  function selectTier(tier) {
    selectedTier = tier;

    document.querySelectorAll('.tier-select-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.tier === tier);
    });

    // Reveal the capital-amount field now that a tier is chosen, and
    // show its valid range as a hint. Re-validate any amount already typed.
    const wrap = document.getElementById('capital-amount-wrap');
    const hint = document.getElementById('capital-amount-hint');
    if (wrap) wrap.classList.remove('hidden');
    if (hint) {
      const range = TIER_RANGES[tier];
      hint.innerText = `Enter an amount between Rs. ${fmt(range.min)} and Rs. ${fmt(range.max)} for the ${TIER_LABELS[tier]} tier.`;
    }
    validateCapitalAmount();

    if (profileConfirmed) {
      refreshHeaderBadge();
      Object.keys(COMPONENTS).forEach(applyTierHighlight);
    }
  }

  function onCapitalAmountInput() {
    validateCapitalAmount();
    if (profileConfirmed && startingCapital !== null) {
      refreshHeaderBadge();
    }
  }

  function validateCapitalAmount() {
    const input = document.getElementById('capital-amount-input');
    const row = input ? input.closest('.capital-amount-input-row') : null;
    const errorEl = document.getElementById('capital-amount-error');
    if (!input || !errorEl) return false;

    const raw = input.value.trim();
    if (raw === '') {
      startingCapital = null;
      row.classList.remove('input-error');
      errorEl.classList.add('hidden');
      errorEl.innerText = '';
      updateContinueButtonState();
      return false;
    }

    const amount = parseFloat(raw);
    const range = selectedTier ? TIER_RANGES[selectedTier] : null;

    if (isNaN(amount) || amount <= 0) {
      startingCapital = null;
      row.classList.add('input-error');
      errorEl.classList.remove('hidden');
      errorEl.innerText = 'Enter a valid positive amount.';
      updateContinueButtonState();
      return false;
    }

    if (range && (amount < range.min || amount > range.max)) {
      startingCapital = null;
      row.classList.add('input-error');
      errorEl.classList.remove('hidden');
      errorEl.innerText = `Amount must be between Rs. ${fmt(range.min)} and Rs. ${fmt(range.max)} for the ${TIER_LABELS[selectedTier]} tier.`;
      updateContinueButtonState();
      return false;
    }

    // Valid amount.
    startingCapital = amount;
    // Whenever the user (re-)enters their starting capital — whether on first
    // setup or via "Change Tier" later — treat it as the new source of truth
    // for their running balance too, not just on the very first entry.
    currentBalance = amount;
    lastTierForBalance = tierForBalance(currentBalance);
    row.classList.remove('input-error');
    errorEl.classList.add('hidden');
    errorEl.innerText = '';
    updateContinueButtonState();
    return true;
  }

  function selectTraderType(traderType) {
    if (selectedTraderTypes.has(traderType)) {
      selectedTraderTypes.delete(traderType);
    } else {
      selectedTraderTypes.add(traderType);
    }

    document.querySelectorAll('.trader-type-card').forEach(card => {
      card.classList.toggle('selected', selectedTraderTypes.has(card.dataset.traderType));
    });

    updateContinueButtonState();

    if (profileConfirmed) {
      refreshHeaderBadge();
    }
  }

  // ---------- Instrument multi-select (Nifty / Bank Nifty / FinNifty / Sensex) ----------
  // Lots are no longer chosen at setup time — every selected instrument
  // defaults to 1 lot here, and the actual lot count is edited live on the
  // Daily Limits Tool's points-SL table (see renderInstrumentSlTable).
  function toggleInstrument(key) {
    if (selectedInstruments[key]) {
      delete selectedInstruments[key];
    } else {
      selectedInstruments[key] = { lots: 1 };
    }

    updateContinueButtonState();
    if (document.getElementById('manual-instrument-picker')) {
      renderManualInstrumentGrid();
    }

    if (profileConfirmed) {
      renderInstrumentSlTable();
    }
  }

  // Replaces the old single global "Select All" — selecting every one of a
  // real broker's 50-200+ instruments at once is rarely the intent, but
  // selecting all instruments WITHIN one category (e.g. all 4 indices) is
  // a reasonable, common action, so it's offered per-category instead.
  function toggleSelectAllInCategory(containerId, category, instrumentListFn, onToggleFn) {
    const instrumentList = instrumentListFn();
    const rowsInCategory = instrumentList.filter(i => (i.category || 'other') === category);
    const allSelected = rowsInCategory.every(i => selectedInstruments[i.value]);

    rowsInCategory.forEach(inst => {
      if (allSelected) {
        delete selectedInstruments[inst.value];
        if (containerId === 'setup-fetched-instrument-picker') {
          const idx = setupFetchedInstrumentKeys.indexOf(inst.value);
          if (idx !== -1) setupFetchedInstrumentKeys.splice(idx, 1);
        }
      } else {
        if (!selectedInstruments[inst.value]) selectedInstruments[inst.value] = { lots: 1 };
        if (containerId === 'setup-fetched-instrument-picker' && !setupFetchedInstrumentKeys.includes(inst.value)) {
          setupFetchedInstrumentKeys.push(inst.value);
        }
      }
    });

    if (containerId === 'setup-fetched-instrument-picker') {
      regenerateBrokerPnlForCurrentInstruments();
    }
    updateContinueButtonState();
    renderInstrumentPicker(containerId, instrumentList, onToggleFn);

    if (profileConfirmed) {
      renderInstrumentSlTable();
    }
  }

  function toggleSelectAllInManualCategory(category) {
    toggleSelectAllInCategory('manual-instrument-picker', category, getMockBrokerTradableInstruments, toggleInstrument);
  }

  function toggleSelectAllInFetchedCategory(category) {
    toggleSelectAllInCategory('setup-fetched-instrument-picker', category, getMockBrokerTradableInstruments, toggleSetupFetchedInstrument);
  }

  // ---------- Custom stocks (freeform, for stock option buyers/sellers) ----------
  function addCustomStock() {
    const input = document.getElementById('custom-stock-input');
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;

    // Support comma-separated entry too (e.g. "Reliance, TCS")
    const names = raw.split(',').map(s => s.trim()).filter(Boolean);
    names.forEach(name => {
      const alreadyExists = customStocks.some(s => s.toLowerCase() === name.toLowerCase());
      if (!alreadyExists) customStocks.push(name);
    });

    input.value = '';
    renderCustomStockChips();
    updateContinueButtonState();
  }

  function onCustomStockKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addCustomStock();
    }
  }

  function removeCustomStock(name) {
    customStocks = customStocks.filter(s => s !== name);
    renderCustomStockChips();
    updateContinueButtonState();
  }

  function renderCustomStockChips() {
    const container = document.getElementById('custom-stock-chips');
    if (!container) return;
    container.innerHTML = customStocks.map(name => `
      <span class="custom-stock-chip">
        ${name}
        <button type="button" class="custom-stock-chip-remove" onclick="removeCustomStock('${name.replace(/'/g, "\\'")}')">&times;</button>
      </span>
    `).join('');
  }

  function updateContinueButtonState() {
    const btn = document.getElementById('profile-continue-btn');
    if (!btn) return;
    const instrumentsOk = Object.keys(selectedInstruments).length > 0 || customStocks.length > 0;
    btn.disabled = !(selectedTier && selectedTraderTypes.size > 0 && startingCapital !== null && instrumentsOk);
  }

  function todayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // ---------- Broker-first profile setup (PROTOTYPE ONLY) ----------
  // Lets a brand-new user connect a broker FIRST, then auto-fills capital,
  // tier, and instruments from the (mocked) fetched account data, instead
  // of manually picking a tier/typing capital/checking instrument boxes.
  // Trading style still has to be asked directly — a broker can tell us
  // balance and trade history, but never the trader's stated intent.
  let setupFetchedInstrumentKeys = []; // which mock-fetched instruments the user has multi-selected during setup

  function generateMockFetchedBalance() {
    // A plausible-looking account balance spanning roughly the Small
    // through low-Pro tiers, so the auto-derived tier varies run to run
    // rather than always landing in the same bracket.
    const buckets = [
      { min: 30000, max: 75000 },
      { min: 100000, max: 400000 },
      { min: 500000, max: 900000 },
      { min: 1000000, max: 1800000 },
    ];
    const bucket = buckets[Math.floor(Math.random() * buckets.length)];
    const raw = bucket.min + Math.random() * (bucket.max - bucket.min);
    return Math.round(raw / 1000) * 1000; // round to nearest thousand, like a real balance would plausibly land
  }

  // Renders the setup screen's own broker picker — same featured-buttons +
  // "More brokers" search pattern as renderBrokerAreaInto, but using
  // startSetupBrokerConnect as the connect handler (which auto-derives
  // tier/capital/instruments) instead of connectMockBroker (which assumes
  // a profile already exists). Kept separate because the setup screen's
  // lifecycle and what "connect" should do are genuinely different from
  // the post-setup Settings/Daily-Limits-Tool connect widget.
  let setupBrokerPickerExpanded = false;
  let setupBrokerPickerSearchTerm = '';

  function renderSetupBrokerPicker() {
    const container = document.getElementById('setup-broker-picker');
    if (!container) return;

    const featured = BROKERS.filter(b => b.featured);
    const more = BROKERS.filter(b => !b.featured);

    if (!container.dataset.shellInitialized) {
      container.dataset.shellInitialized = 'true';
      container.innerHTML = `
        <div class="broker-grid" id="setup-broker-featured"></div>
        ${more.length > 0 ? `
          <button type="button" class="broker-more-toggle" id="setup-broker-more-toggle" onclick="toggleSetupMoreBrokers()"></button>
          <div class="broker-more-wrap hidden" id="setup-broker-more-wrap">
            <input type="text" class="instrument-picker-search" id="setup-broker-search"
                   placeholder="Search brokers..." oninput="onSetupBrokerPickerSearch(this.value)">
            <div class="broker-more-list" id="setup-broker-more-list"></div>
          </div>
        ` : ''}
      `;
    }

    refreshSetupBrokerPickerContent(featured, more);
  }

  function refreshSetupBrokerPickerContent(featured, more) {
    const featuredEl = document.getElementById('setup-broker-featured');
    if (featuredEl) {
      featuredEl.innerHTML = featured.map(b => `
        <button type="button" class="broker-option-btn setup-broker-option-btn" onclick="startSetupBrokerConnect('${b.name}')">
          <span class="broker-chip ${b.colorClass}">${b.initial}</span>
          <span>${b.name}</span>
        </button>
      `).join('');
    }

    const toggleBtn = document.getElementById('setup-broker-more-toggle');
    if (toggleBtn) {
      toggleBtn.innerText = setupBrokerPickerExpanded ? 'Hide other brokers' : `More brokers (${more.length})`;
    }

    const moreWrap = document.getElementById('setup-broker-more-wrap');
    if (moreWrap) moreWrap.classList.toggle('hidden', !setupBrokerPickerExpanded);

    const moreListEl = document.getElementById('setup-broker-more-list');
    if (moreListEl) {
      const searchTerm = setupBrokerPickerSearchTerm.toLowerCase().trim();
      const filteredMore = searchTerm
        ? more.filter(b => b.name.toLowerCase().includes(searchTerm))
        : more;
      moreListEl.innerHTML = filteredMore.length > 0 ? filteredMore.map(b => `
        <button type="button" class="broker-more-row setup-broker-option-btn" onclick="startSetupBrokerConnect('${b.name}')">
          <span class="broker-chip ${b.colorClass}">${b.initial}</span>
          <span>${b.name}</span>
        </button>
      `).join('') : '<div class="roadmap-empty-state">No brokers match your search.</div>';
    }
  }

  function toggleSetupMoreBrokers() {
    setupBrokerPickerExpanded = !setupBrokerPickerExpanded;
    if (!setupBrokerPickerExpanded) setupBrokerPickerSearchTerm = '';
    refreshSetupBrokerPickerContent(BROKERS.filter(b => b.featured), BROKERS.filter(b => !b.featured));
  }

  function onSetupBrokerPickerSearch(value) {
    setupBrokerPickerSearchTerm = value;
    refreshSetupBrokerPickerContent(BROKERS.filter(b => b.featured), BROKERS.filter(b => !b.featured));
  }

  function startSetupBrokerConnect(brokerName) {
    const statusEl = document.getElementById('setup-broker-status');
    if (statusEl) statusEl.innerText = `Connecting to ${brokerName}...`;

    document.querySelectorAll('.setup-broker-option-btn').forEach(btn => { btn.disabled = true; });

    connectBroker(brokerName, () => {
      const fetchedBalance = generateMockFetchedBalance();
      const derivedTier = tierForBalance(fetchedBalance);
      const fetchedInstruments = getMockBrokerTradableInstruments();

      applyFetchedBrokerProfile(brokerName, fetchedBalance, derivedTier, fetchedInstruments);
    });
  }

  function applyFetchedBrokerProfile(brokerName, fetchedBalance, derivedTier, fetchedInstruments) {
    // Default to selecting the index instruments (the most universally
    // traded), leaving stock F&O for the user to add if relevant — mirrors
    // how a real "select which of your tradable instruments to track"
    // step would reasonably default.
    setupFetchedInstrumentKeys = fetchedInstruments
      .filter(i => i.category === 'index')
      .map(i => i.value);

    selectedTier = derivedTier;
    startingCapital = fetchedBalance;
    currentBalance = fetchedBalance;
    selectedInstruments = {};
    setupFetchedInstrumentKeys.forEach(key => {
      selectedInstruments[key] = { lots: 1 };
    });

    renderSetupFetchedProfile(brokerName, fetchedBalance, derivedTier, fetchedInstruments);
    regenerateBrokerPnlForCurrentInstruments();
    updateContinueButtonState();
  }

  function renderSetupFetchedProfile(brokerName, fetchedBalance, derivedTier, fetchedInstruments) {
    const connectWrap = document.getElementById('setup-broker-connect-wrap');
    const fetchedWrap = document.getElementById('setup-broker-fetched-wrap');
    if (connectWrap) connectWrap.classList.add('hidden');
    if (fetchedWrap) fetchedWrap.classList.remove('hidden');

    const nameEl = document.getElementById('setup-fetched-broker-name');
    if (nameEl) nameEl.innerText = brokerName;

    const balanceEl = document.getElementById('setup-fetched-balance');
    if (balanceEl) balanceEl.innerText = `Rs. ${fmt(fetchedBalance)}`;

    const tierEl = document.getElementById('setup-fetched-tier');
    if (tierEl) tierEl.innerText = `${TIER_LABELS[derivedTier]} Tier`;

    renderInstrumentPicker('setup-fetched-instrument-picker', fetchedInstruments, toggleSetupFetchedInstrument);
  }

  function toggleSetupFetchedInstrument(key) {
    if (selectedInstruments[key]) {
      delete selectedInstruments[key];
      const idx = setupFetchedInstrumentKeys.indexOf(key);
      if (idx !== -1) setupFetchedInstrumentKeys.splice(idx, 1);
    } else {
      selectedInstruments[key] = { lots: 1 };
      setupFetchedInstrumentKeys.push(key);
    }

    regenerateBrokerPnlForCurrentInstruments();
    updateContinueButtonState();
    renderInstrumentPicker('setup-fetched-instrument-picker', getMockBrokerTradableInstruments(), toggleSetupFetchedInstrument);
  }

  // ---------- Shared instrument picker: search + category grouping + a
  // "your selection" chip row. Used by BOTH the broker-fetched setup path
  // and the manual fallback path — one render function, so a real broker's
  // 50-200+ instrument list (or this app's own growing INSTRUMENT_INFO)
  // never has to be browsed as one long flat grid. Each category section
  // is collapsible and starts open only if it already has a selection or
  // there are few enough categories that collapsing buys nothing.
  let instrumentPickerSearchTerms = {}; // { [containerId]: 'current search text' }
  let instrumentPickerCollapsedCategories = {}; // { [containerId]: Set of collapsed category keys }

  const CATEGORY_LABELS = { index: 'Indices', stock: 'Stocks' };

  function renderInstrumentPicker(containerId, instrumentList, onToggleFn) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Render the static shell (search box + category sections) only once;
    // subsequent calls just refresh the rows/chips inside it, so the
    // search input never loses focus while the user is typing.
    if (!container.dataset.pickerInitialized) {
      container.dataset.pickerInitialized = 'true';
      container.innerHTML = `
        <div class="instrument-picker-chips" id="${containerId}-chips"></div>
        <input type="text" class="instrument-picker-search" id="${containerId}-search"
               placeholder="Search instruments..." oninput="onInstrumentPickerSearch('${containerId}')">
        <div class="instrument-picker-categories" id="${containerId}-categories"></div>
      `;
    }

    const searchTerm = (instrumentPickerSearchTerms[containerId] || '').toLowerCase().trim();
    const selectedKeys = instrumentList.filter(i => selectedInstruments[i.value]).map(i => i.value);

    // "Your selection" chips — lets the user see/remove everything they've
    // picked without scrolling through every category, however long the
    // underlying instrument list is.
    const chipsEl = document.getElementById(`${containerId}-chips`);
    if (chipsEl) {
      if (selectedKeys.length === 0) {
        chipsEl.innerHTML = '<span class="instrument-picker-chips-empty">No instruments selected yet.</span>';
      } else {
        chipsEl.innerHTML = selectedKeys.map(key => {
          const inst = instrumentList.find(i => i.value === key);
          const label = inst ? inst.label : key;
          return `<span class="instrument-picker-chip">${label}<button type="button" class="instrument-picker-chip-remove" onclick="${onToggleFn.name}('${key}')">&times;</button></span>`;
        }).join('');
      }
    }

    // Group by category, preserving INSTRUMENT_INFO's natural order within each.
    const categories = {};
    instrumentList.forEach(inst => {
      const cat = inst.category || 'other';
      if (!categories[cat]) categories[cat] = [];
      if (!searchTerm || inst.label.toLowerCase().includes(searchTerm)) {
        categories[cat].push(inst);
      }
    });

    if (!instrumentPickerCollapsedCategories[containerId]) {
      instrumentPickerCollapsedCategories[containerId] = new Set();
    }
    const collapsedSet = instrumentPickerCollapsedCategories[containerId];

    const categoriesEl = document.getElementById(`${containerId}-categories`);
    if (!categoriesEl) return;

    const categoryKeys = Object.keys(categories);
    const anyMatches = categoryKeys.some(cat => categories[cat].length > 0);

    if (!anyMatches) {
      categoriesEl.innerHTML = '<div class="roadmap-empty-state">No instruments match your search.</div>';
      return;
    }

    categoriesEl.innerHTML = categoryKeys.map(cat => {
      const rows = categories[cat];
      if (rows.length === 0) return ''; // hide categories with zero matches while searching

      const selectedInCat = rows.filter(r => selectedInstruments[r.value]).length;
      const allSelectedInCat = selectedInCat === rows.length;
      const isCollapsed = collapsedSet.has(cat) && !searchTerm; // never collapse while actively searching
      const catLabel = CATEGORY_LABELS[cat] || cat;
      const selectAllFnName = containerId === 'setup-fetched-instrument-picker'
        ? 'toggleSelectAllInFetchedCategory'
        : 'toggleSelectAllInManualCategory';

      const rowsHtml = rows.map(inst => {
        const isSelected = !!selectedInstruments[inst.value];
        return `
          <button type="button" class="instrument-picker-row ${isSelected ? 'selected' : ''}" data-instrument="${inst.value}" onclick="${onToggleFn.name}('${inst.value}')">
            <span class="instrument-check"></span>
            <span class="instrument-picker-row-name">${inst.label}</span>
            <span class="instrument-picker-row-qty">${inst.qty} qty/lot</span>
          </button>
        `;
      }).join('');

      return `
        <div class="instrument-picker-category">
          <div class="instrument-picker-category-header-row">
            <button type="button" class="instrument-picker-category-header" onclick="toggleInstrumentPickerCategory('${containerId}', '${cat}')">
              <span class="instrument-picker-chevron ${isCollapsed ? 'instrument-picker-chevron-collapsed' : ''}">&#9660;</span>
              <span class="instrument-picker-category-title">${catLabel}</span>
              <span class="instrument-picker-category-count">${selectedInCat} of ${rows.length} selected</span>
            </button>
            <button type="button" class="instrument-picker-select-all-btn" onclick="${selectAllFnName}('${cat}')">${allSelectedInCat ? 'Clear' : 'Select all'}</button>
          </div>
          <div class="instrument-picker-rows ${isCollapsed ? 'instrument-picker-rows-collapsed' : ''}">${rowsHtml}</div>
        </div>
      `;
    }).join('');
  }

  function onInstrumentPickerSearch(containerId) {
    const input = document.getElementById(`${containerId}-search`);
    instrumentPickerSearchTerms[containerId] = input ? input.value : '';

    // Re-render whichever list this container is currently showing.
    if (containerId === 'setup-fetched-instrument-picker') {
      renderInstrumentPicker(containerId, getMockBrokerTradableInstruments(), toggleSetupFetchedInstrument);
    } else if (containerId === 'manual-instrument-picker') {
      renderInstrumentPicker(containerId, getMockBrokerTradableInstruments(), toggleInstrument);
    }
  }

  function toggleInstrumentPickerCategory(containerId, category) {
    if (!instrumentPickerCollapsedCategories[containerId]) {
      instrumentPickerCollapsedCategories[containerId] = new Set();
    }
    const set = instrumentPickerCollapsedCategories[containerId];
    if (set.has(category)) set.delete(category);
    else set.add(category);

    if (containerId === 'setup-fetched-instrument-picker') {
      renderInstrumentPicker(containerId, getMockBrokerTradableInstruments(), toggleSetupFetchedInstrument);
    } else if (containerId === 'manual-instrument-picker') {
      renderInstrumentPicker(containerId, getMockBrokerTradableInstruments(), toggleInstrument);
    }
  }

  function renderManualInstrumentGrid() {
    renderInstrumentPicker('manual-instrument-picker', getMockBrokerTradableInstruments(), toggleInstrument);
  }

  function showManualProfileSetup() {
    disconnectBroker();
    selectedTier = null;
    startingCapital = null;
    currentBalance = null;
    selectedInstruments = {};
    setupFetchedInstrumentKeys = [];

    const brokerStepWrap = document.getElementById('setup-broker-step');
    if (brokerStepWrap) brokerStepWrap.classList.add('hidden');
    const manualStepsWrap = document.getElementById('setup-manual-steps');
    if (manualStepsWrap) manualStepsWrap.classList.remove('hidden');
    const manualInstrumentStep = document.getElementById('setup-manual-instrument-step');
    if (manualInstrumentStep) manualInstrumentStep.classList.remove('hidden');

    renderManualInstrumentGrid();
    updateContinueButtonState();
  }


  function confirmProfile() {
    if (!(selectedTier && selectedTraderTypes.size > 0 && startingCapital !== null)) return;

    if (!profileConfirmed) {
      // Only set once — the very first confirmation is "join day", the
      // earliest date selectable when later submitting a trading log.
      // originalStartingCapital is likewise fixed forever from this point,
      // used as the permanent baseline for lot-unlock thresholds below.
      joinDate = todayDateString();
      originalStartingCapital = startingCapital;
    }
    profileConfirmed = true;

    // Record on the (mock) account itself that setup has been completed at
    // least once — purely informational in this prototype, since profile
    // data itself doesn't persist across reloads; see the auth gate comment
    // in DOMContentLoaded for why this doesn't yet skip setup on return.
    if (typeof window.Auth !== 'undefined') {
      window.Auth.markProfileComplete();
    }

    // The shell has been visible since page load (see DOMContentLoaded
    // below) — confirming the profile just exits "setup mode" so the
    // sidebar nav becomes clickable.
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('sidebar-setup-mode');
    refreshHeaderBadge();

    // Switch into the Dashboard tab as the new default landing screen.
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.sidebar-link').forEach(link => link.classList.remove('active'));
    const dashboardTab = document.getElementById('tab-dashboard');
    if (dashboardTab) dashboardTab.classList.add('active');
    const dashboardLink = document.querySelector('.sidebar-link[data-tab="tab-dashboard"]');
    if (dashboardLink) dashboardLink.classList.add('active');

    const titleEl = document.getElementById('top-bar-page-title');
    if (titleEl) titleEl.innerText = PAGE_TITLES['tab-dashboard'];

    loadComponent('tab-dashboard');

    Object.keys(COMPONENTS).forEach(applyTierHighlight);
  }

  function showTierSelect() {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.sidebar-link').forEach(link => link.classList.remove('active'));
    const selectTab = document.getElementById('tab-select');
    if (selectTab) selectTab.classList.add('active');
    loadComponent('tab-select');
  }

  // Header identity: a small avatar (initials, like Gmail/Slack/Notion)
  // replaces the old "Tier · Style + Style + Style..." badge, which had
  // no natural ceiling once trading styles became a true multi-select.
  // Tier and trading styles now live on the Account page instead, where
  // they have room to be shown properly (chips, cards) rather than
  // squeezed into one line of header text.
  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function refreshHeaderBadge() {
    const avatarWrap = document.getElementById('header-avatar-wrap');
    const avatarInitials = document.getElementById('header-avatar-initials');
    const menuName = document.getElementById('header-account-menu-name');
    const menuEmail = document.getElementById('header-account-menu-email');
    const menuTier = document.getElementById('header-account-menu-tier');
    const balancePill = document.getElementById('header-balance-pill');
    const balanceValue = document.getElementById('header-balance-value');

    const session = (typeof window.Auth !== 'undefined') ? window.Auth.getSession() : null;

    if (avatarWrap && avatarInitials) {
      avatarWrap.style.display = 'inline-flex';
      avatarInitials.innerText = getInitials(session ? session.name : '');
      if (menuName) menuName.innerText = session ? session.name : 'Trader';
      if (menuEmail) menuEmail.innerText = session ? session.email : '';
      if (menuTier) {
        const tierText = selectedTier ? TIER_LABELS[selectedTier] + ' Tier' : 'Profile setup pending';
        menuTier.innerText = tierText;
      }
    }

    if (balancePill && balanceValue && currentBalance !== null) {
      balancePill.style.display = 'flex';
      balanceValue.innerText = `Rs. ${fmt(currentBalance)}`;
    }
  }

  // Toggles the avatar's account dropdown open/closed. Exposed on window
  // since it's wired via an inline onclick in index.html. A single
  // document-level click listener (registered once, below) closes it on
  // any outside click so it never lingers open across tab switches etc.
  function toggleAccountMenu(event) {
    if (event) event.stopPropagation();
    const btn = document.getElementById('header-avatar-btn');
    const menu = document.getElementById('header-account-menu');
    if (!btn || !menu) return;
    const isHidden = menu.classList.contains('hidden');
    if (isHidden) {
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
    } else {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  document.addEventListener('click', () => {
    const menu = document.getElementById('header-account-menu');
    const btn = document.getElementById('header-avatar-btn');
    if (menu && !menu.classList.contains('hidden')) {
      menu.classList.add('hidden');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  });

  // Logout lives here (not in the lazily-loaded settings.js) because the
  // header avatar menu — and its Log Out button — is visible from the very
  // first page load, before Settings/Account has ever been opened once.
  function handleLogout() {
    if (typeof window.Auth === 'undefined') return;
    const ok = window.confirm('Log out of 1CrTrader? You\'ll need to log back in to continue.');
    if (!ok) return;
    window.Auth.logout();
    window.location.href = '/website/auth.html?view=login';
  }

  // ---------- Running balance + trade history ----------
  // Call this whenever a trading day's NET result should be recorded.
  // Positive netResult = net profit for the day, negative = net loss.
  // dateString is "YYYY-MM-DD" (defaults to today if omitted).
  // Exposed on window so components/calculator.js can call it directly when
  // the user presses "Submit Log".
  //
  // Multiple submissions for the SAME date are all kept as separate entries
  // (e.g. a trader logging two separate sessions on one day) — nothing is
  // overwritten. History is kept sorted by date, then by submission order
  // within a date, and every entry's balanceAfter is recalculated from
  // startingCapital forward in that order — so backfilling a missed earlier
  // day correctly rolls forward into every later day's running balance too.
  function recordCompletedDay(netResult, dateString, instrumentLabel, ruleStatus) {
    if (currentBalance === null || startingCapital === null) return null;

    const date = dateString || todayDateString();
    const submittedAt = Date.now();
    const tradeId = `trade-${submittedAt}`;

    tradeHistory.push({
      id: tradeId,
      date,
      netResult,
      balanceAfter: null,
      submittedAt,
      instrument: instrumentLabel || null,
      // ruleStatus: { compliant: bool, label: string, source: 'manual'|'broker' }
      // Defaults to a compliant manual entry when the caller doesn't evaluate
      // its own rule context (keeps this param backward-compatible).
      ruleStatus: ruleStatus || { compliant: true, label: 'Within rules', source: 'manual' },
    });

    tradeHistory.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.submittedAt - b.submittedAt;
    });

    // Recalculate every entry's running balance from the starting capital,
    // walking forward in date (then submission) order.
    let runningBalance = startingCapital;
    tradeHistory.forEach(entry => {
      runningBalance += entry.netResult;
      entry.balanceAfter = runningBalance;
    });

    currentBalance = runningBalance;
    checkTierCrossing();
    refreshHeaderBadge();
    renderInstrumentSlTable();

    if (typeof window.renderCalculatorHistory === 'function') {
      window.renderCalculatorHistory();
    }

    if (typeof window.renderJournalList === 'function') {
      window.renderJournalList();
    }

    if (typeof window.renderJournalAnalysis === 'function') {
      window.renderJournalAnalysis();
    }

    if (typeof window.renderCalculatorBrokerMode === 'function') {
      window.renderCalculatorBrokerMode();
    }

    if (document.getElementById('tab-settings') &&
        document.getElementById('tab-settings').classList.contains('active') &&
        typeof window.renderSettings === 'function') {
      window.renderSettings();
    }

    if (document.getElementById('tab-roadmap') &&
        document.getElementById('tab-roadmap').classList.contains('active') &&
        typeof window.renderRoadmap === 'function') {
      window.renderRoadmap();
    }

    return tradeId;
  }

  // Updates the ruleStatus on an already-recorded trade. Used when a trade
  // was logged before the trader's follow-up decision was known — e.g. a
  // profitable Trade 1 is recorded immediately, but its final label
  // ("stopped for today" vs. "pushed for Trade 2") depends on a choice made
  // a moment later via the profit decision card.
  function updateTradeRuleStatus(tradeId, ruleStatus) {
    const entry = tradeHistory.find(t => t.id === tradeId);
    if (!entry) return;
    entry.ruleStatus = ruleStatus;
    if (typeof window.renderCalculatorHistory === 'function') {
      window.renderCalculatorHistory();
    }
    if (typeof window.renderJournalAnalysis === 'function') {
      window.renderJournalAnalysis();
    }
  }

  // Lower-level hook: directly nudges the balance without touching trade
  // history (kept for flexibility / manual adjustments outside the normal
  // date-aware submit flow).
  function applyBalanceChange(delta) {
    if (currentBalance === null) return;
    currentBalance += delta;
    checkTierCrossing();
    refreshHeaderBadge();

    if (document.getElementById('tab-roadmap') &&
        document.getElementById('tab-roadmap').classList.contains('active') &&
        typeof window.renderRoadmap === 'function') {
      window.renderRoadmap();
    }
  }

  function checkTierCrossing() {
    if (currentBalance === null) return;
    const newTier = tierForBalance(currentBalance);

    if (lastTierForBalance && newTier !== lastTierForBalance) {
      const newIndex = TIER_ORDER.indexOf(newTier);
      const oldIndex = TIER_ORDER.indexOf(lastTierForBalance);
      if (newIndex > oldIndex) {
        showCongratulations(lastTierForBalance, newTier);
      }
      // Update the "official" selected tier to match reality, so the rest
      // of the dashboard (calculator dropdown, highlighting) follows along.
      selectedTier = newTier;
      Object.keys(COMPONENTS).forEach(applyTierHighlight);
    }
    lastTierForBalance = newTier;
  }

  function showCongratulations(fromTier, toTier) {
    pendingCongrats = { fromTier, toTier };

    // Immediate, always-visible notice regardless of which tab is currently open.
    showHeaderToast(`🎉 Congratulations — you've reached the ${TIER_LABELS[toTier]} tier!`);

    // If the roadmap screen happens to already be loaded, render its banner now too.
    renderPendingCongratsIfReady();
  }

  function showHeaderToast(message) {
    let toast = document.getElementById('header-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'header-toast';
      toast.className = 'header-toast';
      document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.classList.add('visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 6000);
  }

  function renderPendingCongratsIfReady() {
    if (!pendingCongrats) return;
    const slot = document.getElementById('congrats-banner-slot');
    if (!slot) return; // roadmap.html not in the DOM yet — stays queued

    const { fromTier, toTier } = pendingCongrats;
    slot.innerHTML = `
      <div class="congrats-banner">
        <div class="congrats-banner-icon">🎉</div>
        <div>
          <div class="congrats-banner-title">Congratulations — you've reached the ${TIER_LABELS[toTier]} tier!</div>
          <div class="congrats-banner-desc">Your balance grew from the ${TIER_LABELS[fromTier]} tier into ${TIER_LABELS[toTier]} by following the daily trading rules. Keep it up.</div>
        </div>
      </div>
    `;
    pendingCongrats = null;
  }

  // Computed directly from tierRulesMatrix now (see top of file) rather
  // than scraping the Daily Limits Tool's rendered text — this used to only
  // work if that tab had already been visited this session; now it works
  // anywhere, including the Dashboard, right after profile setup.
  //
  // Uses getOfficialSubLevelKey() (entry capital + formal growth unlock),
  // NOT a raw lookup against currentBalance — max loss must always match
  // whichever sub-tier the trader's lot count is officially at, so a bad
  // day's balance dip can't silently change today's loss limit too.
  function getCurrentMaxLossRupees() {
    const subLevelKey = getOfficialSubLevelKey();
    if (!subLevelKey || !tierRulesMatrix[subLevelKey]) return null;
    return tierRulesMatrix[subLevelKey].loss;
  }

  // Full risk-rules summary — max daily loss in rupees and %, max lots
  // right now, and how far to the next lot unlock. Built for the
  // Dashboard's risk-at-a-glance card, but safe to call from anywhere once
  // a profile exists. loss/pct and maxLots always refer to the SAME
  // official sub-tier (see getOfficialSubLevelKey()) — never two different
  // ones that could disagree with each other.
  function getRiskSummary() {
    if (!selectedTier || currentBalance === null) return null;

    const subLevelKey = getOfficialSubLevelKey();
    const rule = subLevelKey ? tierRulesMatrix[subLevelKey] : null;
    const maxLots = getMaxAllowedLots();
    const nextUnlock = getNextLotUnlockInfo();

    return {
      tier: selectedTier,
      tierLabel: TIER_LABELS[selectedTier],
      maxLossRupees: rule ? rule.loss : null,
      maxLossPct: rule ? rule.pct : null,
      maxLots: maxLots,
      nextLotUnlock: nextUnlock, // null if no further tier defined
    };
  }

  // How many lots the trader is currently allowed to use. Two separate
  // things combine here (see tierRulesMatrix's maxLots comment above):
  //
  // 1. ENTRY sub-tier — whichever sub-tier their ORIGINAL starting capital
  //    fell into. A trader who deposits Rs. 60,000 into Small enters
  //    directly at small-2 (2 lots) from day one — base capital alone can
  //    place you above sub-tier 1, no need to "grow into" a tier you
  //    already qualified for by deposit.
  // 2. GROWTH step-up — from that entry point, reaching +50% profit on
  //    ORIGINAL starting capital (compounding: 1.5x, then 2.25x, ...)
  //    advances one sub-tier at a time, capped at sub-tier 3 within the
  //    trader's broad tier. This is the only way to move UP beyond your
  //    entry sub-tier — depositing more cash later doesn't skip this.
  //
  // maxLots is a CEILING, not a mandate — a trader may always choose to
  // trade with fewer lots than this. It also has no bearing on max loss:
  // see getCurrentMaxLossRupees(), which reads the sub-tier's own `loss`
  // directly and never multiplies it by lot count.
  //
  // getOfficialSubLevelKey() is the SINGLE source of truth for both lot
  // count and max-loss display — both must always refer to the same
  // sub-tier, which only ever advances via entry-capital + the formal
  // growth rule above. It deliberately does NOT track currentBalance's
  // "natural" sub-tier on its own (a bad day's balance dip should not
  // silently change the trader's risk/loss numbers, only their balance) —
  // see highestOfficialSubLevelNum: this function is a RATCHET, recomputing
  // the live entry+growth walk on every call but never reporting a LOWER
  // sub-tier than the highest one ever actually reached.
  function getOfficialSubLevelKey() {
    if (!selectedTier || originalStartingCapital === null || currentBalance === null) return null;

    const entryKey = subLevelForBalance(selectedTier, originalStartingCapital);
    if (!entryKey || !tierRulesMatrix[entryKey]) return null;

    let subLevelNum = parseInt(entryKey.split('-')[1], 10);

    // Each further step requires the NEXT power of 1.5x on top of the
    // ORIGINAL starting capital (1.5x for the first step up, 2.25x for the
    // second), same compounding-from-original-capital rule used elsewhere.
    let growthMultiplier = 1.5;
    while (subLevelNum < 3) {
      const nextKey = `${selectedTier}-${subLevelNum + 1}`;
      if (!tierRulesMatrix[nextKey]) break;
      if (currentBalance >= originalStartingCapital * growthMultiplier) {
        subLevelNum += 1;
        growthMultiplier *= 1.5;
      } else {
        break;
      }
    }

    // Ratchet: never report (or remember) a sub-tier lower than the
    // highest one previously reached for this profile — but only within
    // the SAME broad tier; switching tiers via Change Tier resets it,
    // since "sub-tier 3" doesn't carry meaning across different tiers.
    if (highestOfficialSubLevelTier !== selectedTier) {
      highestOfficialSubLevelNum = null;
      highestOfficialSubLevelTier = selectedTier;
    }
    if (highestOfficialSubLevelNum === null || subLevelNum > highestOfficialSubLevelNum) {
      highestOfficialSubLevelNum = subLevelNum;
    } else if (subLevelNum < highestOfficialSubLevelNum) {
      subLevelNum = highestOfficialSubLevelNum;
    }

    return `${selectedTier}-${subLevelNum}`;
  }

  function getMaxAllowedLots() {
    const key = getOfficialSubLevelKey();
    return (key && tierRulesMatrix[key]) ? tierRulesMatrix[key].maxLots : 1;
  }

  // Balance still needed to reach the NEXT lot unlock (the next sub-tier
  // WITHIN the trader's tier, via the growth step-up described above), or
  // null if already at sub-tier 3 (the highest currently configured).
  function getNextLotUnlockInfo() {
    if (!selectedTier || originalStartingCapital === null || currentBalance === null) return null;

    const officialKey = getOfficialSubLevelKey();
    if (!officialKey) return null;
    const subLevelNum = parseInt(officialKey.split('-')[1], 10);
    const nextKey = `${selectedTier}-${subLevelNum + 1}`;
    if (!tierRulesMatrix[nextKey]) return null; // already at sub-tier 3

    // The multiplier needed for THIS NEXT step is 1.5 raised to the power
    // of how many growth steps it takes to get there from sub-tier 1 — i.e.
    // if currently at sub-tier 2 (one growth step already used, or entered
    // there directly), the next step still needs +50% more on top of
    // ORIGINAL starting capital for each level above entry. Recompute the
    // exact multiplier by walking from the entry point, mirroring
    // getOfficialSubLevelKey()'s own walk, so the two can never disagree.
    const entryKey = subLevelForBalance(selectedTier, originalStartingCapital);
    const entrySubLevelNum = parseInt(entryKey.split('-')[1], 10);
    let growthMultiplier = 1.5;
    for (let n = entrySubLevelNum; n < subLevelNum; n++) {
      growthMultiplier *= 1.5;
    }

    const requiredBalance = originalStartingCapital * growthMultiplier;
    const remaining = requiredBalance - currentBalance;
    return {
      nextLotCount: tierRulesMatrix[nextKey].maxLots,
      requiredBalance,
      remaining: remaining > 0 ? remaining : 0,
    };
  }

  // Generates the Calculator tab's "Capital Tier, Lots & Daily Loss
  // Reference" table — all 12 sub-tiers, straight from tierRulesMatrix (the
  // single source of truth), so this table can never hand-typed-drift out
  // of sync with the actual rule data the way the old 4-row merged version
  // did. Each row carries data-sublevel-row="small-1" etc. for exact
  // highlighting (see applyTierHighlight's tab-calculator branch), not just
  // a broad-tier match — a trader at small-2 should see THAT row
  // highlighted, not every Small row.
  function renderTierReferenceTable() {
    const grid = document.getElementById('tier-ref-grid');
    if (!grid) return;

    let html = `
      <div class="mini-ladder-cell mini-ladder-head">Tier</div>
      <div class="mini-ladder-cell mini-ladder-head num">Capital</div>
      <div class="mini-ladder-cell mini-ladder-head num">Max Lots</div>
      <div class="mini-ladder-cell mini-ladder-head num">Max Loss Rs.</div>
      <div class="mini-ladder-cell mini-ladder-head num">Max Loss %</div>
    `;

    TIER_ORDER.forEach(tier => {
      ['1', '2', '3'].forEach(subNum => {
        const key = `${tier}-${subNum}`;
        const rule = tierRulesMatrix[key];
        if (!rule) return;
        const label = `${TIER_LABELS[tier]} ${subNum}`;
        html += `
          <div class="mini-ladder-cell mini-ladder-label" data-sublevel-row="${key}">${label}</div>
          <div class="mini-ladder-cell num" data-sublevel-row="${key}">Rs. ${fmt(rule.cap)}+</div>
          <div class="mini-ladder-cell num" data-sublevel-row="${key}">${rule.maxLots}</div>
          <div class="mini-ladder-cell num" data-sublevel-row="${key}">Rs. ${fmt(rule.loss)}</div>
          <div class="mini-ladder-cell num" data-sublevel-row="${key}">${rule.pct.toFixed(2)}%</div>
        `;
      });
    });

    grid.innerHTML = html;
  }

  function renderInstrumentSlTable() {
    const wrap = document.getElementById('instrument-sl-wrap');
    const grid = document.getElementById('instrument-sl-grid');
    if (!wrap || !grid) return;

    const keys = Object.keys(selectedInstruments);
    if (keys.length === 0) {
      wrap.classList.add('hidden');
      return;
    }

    const maxLoss = getCurrentMaxLossRupees();
    if (maxLoss === null) {
      wrap.classList.add('hidden');
      return;
    }

    wrap.classList.remove('hidden');
    if (typeof window.applyReferenceSectionState === 'function') {
      window.applyReferenceSectionState('instrument-ref');
    }

    const maxAllowedLots = getMaxAllowedLots();

    let html = `
      <div class="mini-ladder-cell mini-ladder-head">Instrument</div>
      <div class="mini-ladder-cell mini-ladder-head num">Qty/Lot</div>
      <div class="mini-ladder-cell mini-ladder-head num">Lots</div>
      <div class="mini-ladder-cell mini-ladder-head num">Points SL</div>
    `;

    keys.forEach(key => {
      const info = INSTRUMENT_INFO[key];
      let lots = selectedInstruments[key].lots || 1;
      // Clamp to whatever is currently allowed — e.g. if balance dropped
      // back below a threshold after a losing day, lots reduce automatically.
      if (lots > maxAllowedLots) {
        lots = maxAllowedLots;
        selectedInstruments[key].lots = lots;
      }
      const totalQty = info.qty * lots;
      const pointsSl = totalQty > 0 ? (maxLoss / totalQty) : 0;

      html += `
        <div class="mini-ladder-cell mini-ladder-label">${info.label}</div>
        <div class="mini-ladder-cell num">${info.qty}</div>
        <div class="mini-ladder-cell num">
          <input type="number" class="sl-lots-input" data-instrument-key="${key}" min="1" max="${maxAllowedLots}" step="1" value="${lots}"
                 oninput="onSlTableLotsInput('${key}', this.value)">
        </div>
        <div class="mini-ladder-cell num sl-points-output" data-row-key="${key}" style="font-weight:600; color:#2e75b6;">${pointsSl.toFixed(2)} pts</div>
      `;
    });

    grid.innerHTML = html;

    // Show the lot-unlock progress note below the table.
    const noteEl = document.getElementById('lot-unlock-note');
    if (noteEl) {
      const nextUnlock = getNextLotUnlockInfo();
      if (nextUnlock) {
        noteEl.innerText = `You're cleared for up to ${maxAllowedLots} lot${maxAllowedLots === 1 ? '' : 's'} per trade right now. Reach Rs. ${fmt(nextUnlock.requiredBalance)} balance (50% profit on your original starting capital of Rs. ${fmt(originalStartingCapital)}) to unlock ${nextUnlock.nextLotCount} lots — Rs. ${fmt(nextUnlock.remaining)} to go.`;
        noteEl.classList.remove('hidden');
      } else if (maxAllowedLots >= 1) {
        noteEl.innerText = `You're cleared for up to ${maxAllowedLots} lot${maxAllowedLots === 1 ? '' : 's'} per trade. That's the highest currently configured for your tier — no further lot unlock is defined yet.`;
        noteEl.classList.remove('hidden');
      } else {
        noteEl.classList.add('hidden');
      }
    }
  }

  // Called when the user edits a lot count directly in the points-SL table
  // on the Daily Limits Tool (today's actual trading lots, decided live).
  // Updates only that row's points-SL output in place, rather than
  // re-rendering the whole grid (which would steal focus from the input
  // the user is actively typing into).
  function onSlTableLotsInput(key, value) {
    if (!selectedInstruments[key]) return;
    const lots = parseInt(value, 10);
    const maxAllowedLots = getMaxAllowedLots();
    let validLots = (isNaN(lots) || lots < 1) ? 1 : lots;

    // Enforce the lot cap. If the typed value had to be clamped down, show
    // an immediate, specific reason right at the note location — relying
    // only on the static unlock-progress paragraph below the table left
    // people with no feedback at the moment their input was overridden.
    if (validLots > maxAllowedLots) {
      const attemptedLots = validLots;
      validLots = maxAllowedLots;
      const inputEl = document.querySelector(`.sl-lots-input[data-instrument-key="${key}"]`);
      if (inputEl) inputEl.value = validLots;
      flashLotCapMessage(attemptedLots, maxAllowedLots);
    }

    selectedInstruments[key].lots = validLots;

    const maxLoss = getCurrentMaxLossRupees();
    const info = INSTRUMENT_INFO[key];
    if (maxLoss === null || !info) return;

    const totalQty = info.qty * validLots;
    const pointsSl = totalQty > 0 ? (maxLoss / totalQty) : 0;

    const outputCell = document.querySelector(`.sl-points-output[data-row-key="${key}"]`);
    if (outputCell) {
      outputCell.innerText = `${pointsSl.toFixed(2)} pts`;
    }
  }

  let lotCapFlashTimeoutId = null;

  // Briefly shows WHY a typed lot count was rejected, directly at the note
  // location, then restores the normal unlock-progress message after a few
  // seconds. This is in addition to (not instead of) the static note.
  function flashLotCapMessage(attemptedLots, maxAllowedLots) {
    const noteEl = document.getElementById('lot-unlock-note');
    if (!noteEl) return;

    const nextUnlock = getNextLotUnlockInfo();
    const ceilingNote = nextUnlock
      ? `Reach Rs. ${fmt(nextUnlock.requiredBalance)} to unlock lot ${nextUnlock.nextLotCount} (Rs. ${fmt(nextUnlock.remaining)} to go).`
      : `${maxAllowedLots} lot${maxAllowedLots === 1 ? '' : 's'} is the maximum currently defined for this account size — there's no further unlock configured yet.`;

    noteEl.innerText = `You typed ${attemptedLots} lots, but you're only cleared for ${maxAllowedLots} right now — it's been set back to ${maxAllowedLots}. ${ceilingNote}`;
    noteEl.classList.remove('hidden');
    noteEl.classList.add('lot-cap-flash');

    if (lotCapFlashTimeoutId) clearTimeout(lotCapFlashTimeoutId);
    lotCapFlashTimeoutId = setTimeout(() => {
      noteEl.classList.remove('lot-cap-flash');
      renderInstrumentSlTable(); // restores the normal static unlock note
    }, 4000);
  }

  function getProfileState() {
    const traderTypesArray = Array.from(selectedTraderTypes);
    return {
      tier: selectedTier,
      traderType: traderTypesArray[0] || null, // first selected, kept for backward compatibility
      traderTypes: traderTypesArray,           // full multi-select list
      startingCapital: startingCapital,
      currentBalance: currentBalance,
      joinDate: joinDate,
      today: todayDateString(),
      brokerConnected: brokerConnected,
      connectedBrokerName: connectedBrokerName,
      lastSyncedAt: lastSyncedAt,
    };
  }

  // ---------- Mock broker connection: connect / disconnect / sync ----------
  // PROTOTYPE ONLY. Simulates the experience of a real broker integration with
  // a short fake "connecting" delay and a callback once "connected." No real
  // network calls, no real credentials, nothing leaves this browser tab.
  let brokerPnlData = {}; // { 'YYYY-MM-DD': [ { scrip, qty, buyPrice, sellPrice, charges, netPnl } ] }

  // Lives here (rather than in settings.js) because dashboard.js is always
  // loaded, while settings.js only loads lazily the first time the Settings
  // tab opens. The Daily Limits Tool needs to connect/disconnect a broker
  // even if Settings has never been visited this session.
  // Top brokers by active client count in India (Groww/Zerodha/Angel One
  // alone serve 28M+ combined) — the first 4 are shown as quick-pick
  // buttons everywhere; the rest appear in a searchable "More brokers"
  // list so this never turns into a wall of buttons as it grows.
  const BROKERS = [
    { id: 'zerodha', name: 'Zerodha', initial: 'Z', colorClass: 'broker-chip-orange', featured: true },
    { id: 'groww', name: 'Groww', initial: 'G', colorClass: 'broker-chip-teal', featured: true },
    { id: 'angelone', name: 'Angel One', initial: 'A', colorClass: 'broker-chip-red', featured: true },
    { id: 'upstox', name: 'Upstox', initial: 'U', colorClass: 'broker-chip-purple', featured: true },
    { id: 'icicidirect', name: 'ICICI Direct', initial: 'I', colorClass: 'broker-chip-blue', featured: false },
    { id: 'kotak', name: 'Kotak Securities', initial: 'K', colorClass: 'broker-chip-maroon', featured: false },
    { id: 'hdfcsec', name: 'HDFC Securities', initial: 'H', colorClass: 'broker-chip-navy', featured: false },
    { id: 'dhan', name: 'Dhan', initial: 'D', colorClass: 'broker-chip-teal', featured: false },
    { id: 'motilal', name: 'Motilal Oswal', initial: 'M', colorClass: 'broker-chip-orange', featured: false },
    { id: 'sbicap', name: 'SBICAP Securities', initial: 'S', colorClass: 'broker-chip-blue', featured: false },
  ];
  let brokerConnecting = null; // broker id currently mid-"connect", or null
  let brokerPickerSearchTerm = ''; // current text in the "More brokers" search box, shared across instances
  let brokerPickerExpanded = false; // whether "More brokers" is currently showing its search+list

  // Renders the connect/connected broker UI into EVERY container id that has
  // this markup structure that's currently present in the DOM — used by
  // both the Settings tab and the Daily Limits Tool's broker panel, so
  // connecting/disconnecting works identically from either screen.
  const BROKER_AREA_IDS = ['broker-connect-area', 'calc-broker-connect-area'];

  function renderBrokerArea() {
    BROKER_AREA_IDS.forEach(renderBrokerAreaInto);
  }

  function renderBrokerAreaInto(containerId) {
    const area = document.getElementById(containerId);
    if (!area) return;

    if (brokerConnected) {
      area.dataset.brokerShellInitialized = ''; // reset so a future disconnect rebuilds the picker shell fresh
      const broker = BROKERS.find(b => b.name === connectedBrokerName);
      const lastSync = lastSyncedAt
        ? new Date(lastSyncedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        : 'Not synced yet';
      area.innerHTML = `
        <div class="broker-connected-row">
          <span class="broker-chip ${broker ? broker.colorClass : ''}">${broker ? broker.initial : '?'}</span>
          <span class="broker-connected-text">Connected to ${connectedBrokerName}</span>
          <span class="broker-last-sync">Last synced: ${lastSync}</span>
          <button type="button" class="broker-disconnect-btn" onclick="disconnectMockBroker()">Disconnect</button>
        </div>
      `;
      return;
    }

    const featured = BROKERS.filter(b => b.featured);
    const more = BROKERS.filter(b => !b.featured);

    // Build the static shell (featured buttons + toggle + search input) only
    // once per container; re-typing in the search box must NOT replace the
    // input element itself, or it loses focus on every keystroke. Only the
    // filtered list and button disabled-states get refreshed after that.
    if (!area.dataset.brokerShellInitialized) {
      area.dataset.brokerShellInitialized = 'true';
      area.innerHTML = `
        <div class="broker-grid" id="${containerId}-featured"></div>
        ${more.length > 0 ? `
          <button type="button" class="broker-more-toggle" id="${containerId}-more-toggle" onclick="toggleMoreBrokers('${containerId}')"></button>
          <div class="broker-more-wrap hidden" id="${containerId}-more-wrap">
            <input type="text" class="instrument-picker-search" id="${containerId}-search"
                   placeholder="Search brokers..." oninput="onBrokerPickerSearch('${containerId}', this.value)">
            <div class="broker-more-list" id="${containerId}-more-list"></div>
          </div>
        ` : ''}
      `;
    }

    refreshBrokerAreaContent(containerId, featured, more);
  }

  function refreshBrokerAreaContent(containerId, featured, more) {
    const featuredEl = document.getElementById(`${containerId}-featured`);
    if (featuredEl) {
      featuredEl.innerHTML = featured.map(b => `
        <button type="button" class="broker-option-btn" onclick="connectMockBroker('${b.name}')" ${brokerConnecting ? 'disabled' : ''}>
          <span class="broker-chip ${b.colorClass}">${b.initial}</span>
          <span>${brokerConnecting === b.id ? 'Connecting...' : b.name}</span>
        </button>
      `).join('');
    }

    const toggleBtn = document.getElementById(`${containerId}-more-toggle`);
    if (toggleBtn) {
      toggleBtn.innerText = brokerPickerExpanded ? 'Hide other brokers' : `More brokers (${more.length})`;
    }

    const moreWrap = document.getElementById(`${containerId}-more-wrap`);
    if (moreWrap) moreWrap.classList.toggle('hidden', !brokerPickerExpanded);

    const moreListEl = document.getElementById(`${containerId}-more-list`);
    if (moreListEl) {
      const searchTerm = brokerPickerSearchTerm.toLowerCase().trim();
      const filteredMore = searchTerm
        ? more.filter(b => b.name.toLowerCase().includes(searchTerm))
        : more;
      moreListEl.innerHTML = filteredMore.length > 0 ? filteredMore.map(b => `
        <button type="button" class="broker-more-row" onclick="connectMockBroker('${b.name}')" ${brokerConnecting ? 'disabled' : ''}>
          <span class="broker-chip ${b.colorClass}">${b.initial}</span>
          <span>${brokerConnecting === b.id ? 'Connecting...' : b.name}</span>
        </button>
      `).join('') : '<div class="roadmap-empty-state">No brokers match your search.</div>';
    }
  }

  function toggleMoreBrokers(containerId) {
    brokerPickerExpanded = !brokerPickerExpanded;
    if (!brokerPickerExpanded) brokerPickerSearchTerm = ''; // reset search when collapsing
    BROKER_AREA_IDS.forEach(id => {
      const featured = BROKERS.filter(b => b.featured);
      const more = BROKERS.filter(b => !b.featured);
      refreshBrokerAreaContent(id, featured, more);
    });
  }

  function onBrokerPickerSearch(containerId, value) {
    brokerPickerSearchTerm = value;
    // Only refresh the list contents for the container the user is
    // actually typing in — re-running the other container's full init
    // would steal focus from this input.
    const featured = BROKERS.filter(b => b.featured);
    const more = BROKERS.filter(b => !b.featured);
    refreshBrokerAreaContent(containerId, featured, more);
  }

  function connectMockBroker(brokerName) {
    const broker = BROKERS.find(b => b.name === brokerName);
    brokerConnecting = broker ? broker.id : brokerName;
    renderBrokerArea();

    connectBroker(brokerName, () => {
      brokerConnecting = null;
      renderBrokerArea();
      if (typeof window.renderCalculatorBrokerMode === 'function') {
        window.renderCalculatorBrokerMode();
      }
    });
  }

  function disconnectMockBroker() {
    disconnectBroker();
    renderBrokerArea();
    if (typeof window.renderCalculatorBrokerMode === 'function') {
      window.renderCalculatorBrokerMode();
    }
  }

  function connectBroker(brokerName, onConnected) {
    brokerConnected = false; // not yet — caller's UI should show a connecting state during the delay
    setTimeout(() => {
      brokerConnected = true;
      connectedBrokerName = brokerName;
      lastSyncedAt = null;
      brokerPnlData = generateMockBrokerPnlHistory();
      if (typeof onConnected === 'function') onConnected();
    }, 1400);
  }

  function disconnectBroker() {
    brokerConnected = false;
    connectedBrokerName = null;
    lastSyncedAt = null;
    brokerPnlData = {};
  }

  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Builds a realistic-looking scrip name, e.g. "NIFTY 2026-04-21 PE 24400",
  // matching how a real broker P&L statement labels option contracts.
  function buildScripName(instrumentLabel) {
    const base = instrumentLabel.toUpperCase().replace(/\s+/g, '');
    const today = new Date();
    const expiryOffsetDays = Math.floor(Math.random() * 28) + 1;
    const expiry = new Date(today);
    expiry.setDate(expiry.getDate() - expiryOffsetDays - Math.floor(Math.random() * 60));
    const expiryStr = ymd(expiry);
    const optType = Math.random() < 0.5 ? 'CE' : 'PE';
    const strikeBase = { NIFTY: 24000, BANKNIFTY: 51000, FINNIFTY: 23000, SENSEX: 77000 }[base] || 24000;
    const strike = strikeBase + (Math.floor(Math.random() * 20) - 10) * 50;
    return `${base} ${expiryStr} ${optType} ${strike}`;
  }

  // Returns the start of the current Indian financial year (Apr 1) as of
  // `today` — e.g. for any date in Jan-Mar 2026, FY started Apr 1, 2025.
  function startOfFinancialYear(today) {
    const aprFirstThisCalendarYear = new Date(today.getFullYear(), 3, 1); // month 3 = April
    if (today >= aprFirstThisCalendarYear) {
      return aprFirstThisCalendarYear;
    }
    return new Date(today.getFullYear() - 1, 3, 1);
  }

  // Generates a full mock trading history spanning the current Indian
  // financial year to date (Apr 1 \u2192 today), in the same shape a real
  // broker's tradebook/P&L endpoint would return. Most days have no trades
  // (realistic \u2014 traders don't trade every day); active days get 1-4
  // scrip-level rows. This is the seam where a real implementation would
  // call the broker's reports API instead.
  function generateMockBrokerPnlHistory() {
    const instruments = getAllTradableInstruments();
    const pool = instruments.length > 0 ? instruments : [{ value: 'nifty', label: 'Nifty' }];
    const data = {};
    const today = new Date();
    const fyStart = startOfFinancialYear(today);
    const totalDays = Math.floor((today - fyStart) / (1000 * 60 * 60 * 24)) + 1;

    for (let i = 0; i < totalDays; i++) {
      const day = new Date(fyStart);
      day.setDate(day.getDate() + i);
      if (day > today) break;
      if (day.getDay() === 0 || day.getDay() === 6) continue; // skip weekends, like real markets

      if (Math.random() < 0.55) continue; // most days: no trades logged with this broker

      const tradeCount = 1 + Math.floor(Math.random() * 4); // 1-4 scrip rows that day
      const rows = [];
      for (let j = 0; j < tradeCount; j++) {
        const chosen = pool[Math.floor(Math.random() * pool.length)];
        const qty = (1 + Math.floor(Math.random() * 4)) * 65;
        const buyPrice = Math.round((20 + Math.random() * 200) * 100) / 100;
        const isProfit = Math.random() < 0.5;
        const pctMove = (isProfit ? 1 : -1) * (0.02 + Math.random() * 0.4);
        const sellPrice = Math.round(buyPrice * (1 + pctMove) * 100) / 100;
        const charges = Math.round((qty * 0.06 + Math.random() * 40) * 100) / 100;
        const gross = Math.round((sellPrice - buyPrice) * qty * 100) / 100;
        const netPnl = Math.round((gross - charges) * 100) / 100;

        rows.push({
          scrip: buildScripName(chosen.label),
          instrumentLabel: chosen.label,
          qty,
          buyPrice,
          sellPrice,
          charges,
          netPnl,
        });
      }
      data[ymd(day)] = rows;
    }
    return data;
  }

  // Returns { [date]: [rows] } for everything the mock broker has, or just
  // one day's rows if a date is given. Read-only — this is what the
  // Daily Limits Tool's broker browser and import flow read from.
  function getBrokerPnlHistory(dateString) {
    if (dateString) return brokerPnlData[dateString] || [];
    return brokerPnlData;
  }

  // Regenerates the mock P&L history against whichever instruments are
  // CURRENTLY selected. Needed because the broker-first setup flow connects
  // BEFORE instruments are chosen (so the very first generateMockBrokerPnlHistory()
  // call inside connectBroker() falls back to a default pool) — call this
  // once instruments are actually set, so the P&L data matches what the
  // user actually trades.
  function regenerateBrokerPnlForCurrentInstruments() {
    if (!brokerConnected) return;
    brokerPnlData = generateMockBrokerPnlHistory();
  }

  // Aggregates realized P&L / charges / net P&L across every scrip row whose
  // date falls within [fromDateString, toDateString] inclusive — powers the
  // stat cards at the top of the broker P&L browser (mirrors how a real
  // broker's P&L report summarizes a selected date range).
  function getBrokerPnlSummary(fromDateString, toDateString) {
    let realizedPnl = 0; // gross, before charges
    let totalCharges = 0;
    let netRealizedPnl = 0;

    Object.keys(brokerPnlData).forEach(date => {
      if (date < fromDateString || date > toDateString) return;
      brokerPnlData[date].forEach(row => {
        totalCharges += row.charges;
        netRealizedPnl += row.netPnl;
        realizedPnl += row.netPnl + row.charges; // gross = net + charges added back
      });
    });

    return {
      realizedPnl: Math.round(realizedPnl * 100) / 100,
      totalCharges: Math.round(totalCharges * 100) / 100,
      netRealizedPnl: Math.round(netRealizedPnl * 100) / 100,
    };
  }

  // Records a trade that the (mock) broker reported, with a ruleStatus the
  // caller has already evaluated against the rules as they stood at that
  // moment. Also stamps lastSyncedAt so the Settings/Connected chip reflects
  // a real import time. dateString lets the caller import a past day's data,
  // not just "today."
  function recordBrokerSyncedTrade(netResult, instrumentLabel, ruleStatus, dateString) {
    if (!brokerConnected) return null;
    lastSyncedAt = Date.now();
    return recordCompletedDay(netResult, dateString || todayDateString(), instrumentLabel, ruleStatus);
  }

  // Combined list of everything the user can pick as "today's instrument"
  // when logging a trade: their selected index instruments (Nifty, Bank
  // Nifty, etc.) plus any custom stocks they've added. Each item has a
  // `label` for display and a `value` safe to use in a <select>.
  function getAllTradableInstruments() {
    const list = [];
    Object.keys(selectedInstruments).forEach(key => {
      const info = INSTRUMENT_INFO[key];
      if (info) list.push({ value: key, label: info.label });
    });
    customStocks.forEach(name => {
      list.push({ value: `stock:${name}`, label: name });
    });
    return list;
  }

  function getTradeHistory() {
    return tradeHistory.slice();
  }

  // ---------- Trading Journal entries ----------
  // Journal entries are keyed by the trade's stable id (see recordCompletedDay),
  // so each entry attaches to one specific submitted trade.
  function saveJournalEntry(tradeId, entryData) {
    if (!tradeId) return;
    journalEntries[tradeId] = Object.assign({}, journalEntries[tradeId], entryData);
  }

  function getJournalEntry(tradeId) {
    return journalEntries[tradeId] || null;
  }

  function getAllJournalEntries() {
    return Object.assign({}, journalEntries);
  }

  function deleteJournalEntry(tradeId) {
    delete journalEntries[tradeId];
  }

  // ---------- Apply highlighting once a component's HTML is in the DOM ----------
  function applyTierHighlight(tabId) {
    const container = document.getElementById(tabId);
    if (!container) return;

    if (tabId === 'tab-select') {
      renderSetupBrokerPicker();

      if (selectedTier) {
        container.querySelectorAll('.tier-select-card').forEach(card => {
          card.classList.toggle('selected', card.dataset.tier === selectedTier);
        });
        const wrap = document.getElementById('capital-amount-wrap');
        const hint = document.getElementById('capital-amount-hint');
        const input = document.getElementById('capital-amount-input');
        if (wrap) wrap.classList.remove('hidden');
        if (hint) {
          const range = TIER_RANGES[selectedTier];
          hint.innerText = `Enter an amount between Rs. ${fmt(range.min)} and Rs. ${fmt(range.max)} for the ${TIER_LABELS[selectedTier]} tier.`;
        }
        if (input && startingCapital !== null && input.value === '') {
          input.value = startingCapital;
        }

        // Reaching this screen with a tier already set (e.g. via "Change
        // Tier" after initial setup) means we're editing an existing
        // manual-path profile — reveal the manual steps directly and skip
        // straight past the broker-connect prompt, rather than asking
        // someone editing their profile to reconnect a broker.
        const brokerStepWrap = document.getElementById('setup-broker-step');
        if (brokerStepWrap) brokerStepWrap.classList.add('hidden');
        const manualStepsWrap = document.getElementById('setup-manual-steps');
        if (manualStepsWrap) manualStepsWrap.classList.remove('hidden');
        const manualInstrumentStep = document.getElementById('setup-manual-instrument-step');
        if (manualInstrumentStep) manualInstrumentStep.classList.remove('hidden');
      }
      if (selectedTraderTypes.size > 0) {
        container.querySelectorAll('.trader-type-card').forEach(card => {
          card.classList.toggle('selected', selectedTraderTypes.has(card.dataset.traderType));
        });
      }
      // Re-render (rather than patch) the instrument picker so it reflects
      // whichever instruments are currently selected — covers both the
      // manual path (re-opened via "Change Tier") and, if ever reached with
      // a broker already connected, the fetched path too.
      if (document.getElementById('manual-instrument-picker')) {
        renderManualInstrumentGrid();
      }
      if (brokerConnected && document.getElementById('setup-fetched-instrument-picker')) {
        renderInstrumentPicker('setup-fetched-instrument-picker', getMockBrokerTradableInstruments(), toggleSetupFetchedInstrument);
      }
      renderCustomStockChips();
      updateContinueButtonState();
      return;
    }

    if (!selectedTier) return;

    if (tabId === 'tab-subs') {
      const targetLabel = TIER_LABELS[selectedTier];
      container.querySelectorAll('.pricing-card').forEach(card => {
        const nameEl = card.querySelector('.tier-name');
        const matches = nameEl && nameEl.textContent.trim() === targetLabel;
        card.classList.toggle('tier-highlight', !!matches);
      });
      return;
    }

    if (tabId === 'tab-calculator') {
      // Auto-select the trader's OFFICIAL sub-tier (entry capital + the
      // formal +50%-growth rule — see getOfficialSubLevelKey()), not
      // always sub-tier 1. A Small trader who entered at small-2 (or
      // grew into it) should see small-2's rules here by default, not
      // be silently shown small-1's lower maxLots/loss every time they
      // open this tab.
      const officialKey = (typeof window.getOfficialSubLevelKey === 'function')
        ? window.getOfficialSubLevelKey()
        : null;

      // Highlight the matching EXACT sub-tier row (not the whole broad
      // tier) in the 12-row reference table — a trader at small-2 should
      // see only that row highlighted, not every Small row.
      container.querySelectorAll('.mini-ladder-cell[data-sublevel-row]').forEach(cell => {
        const isMatch = officialKey && cell.dataset.sublevelRow === officialKey;
        cell.classList.toggle('tier-highlight', isMatch && cell.classList.contains('mini-ladder-label'));
        cell.classList.toggle('tier-highlight-row', isMatch && !cell.classList.contains('mini-ladder-label'));
      });

      const select = document.getElementById('calc-tier');
      if (select) {
        select.value = officialKey || TIER_FIRST_SUBLEVEL[selectedTier];
        if (typeof window.onTierChange === 'function') {
          window.onTierChange(); // this already calls renderInstrumentSlTable() internally
        }
      }

      return;
    }

    if (tabId === 'tab-roadmap') {
      renderPendingCongratsIfReady();
      if (typeof window.renderRoadmap === 'function') {
        window.renderRoadmap();
      }
      return;
    }
  }

  // Expose handlers used by inline onclick attributes in index.html / components,
  // and the state/balance hooks for components/calculator.js and roadmap.js.
  window.switchTab = switchTab;
  window.toggleAccountMenu = toggleAccountMenu;
  window.handleLogout = handleLogout;
  window.getInitials = getInitials;
  window.selectTier = selectTier;
  window.selectTraderType = selectTraderType;
  window.onCapitalAmountInput = onCapitalAmountInput;
  window.toggleInstrument = toggleInstrument;
  window.toggleSelectAllInManualCategory = toggleSelectAllInManualCategory;
  window.toggleSelectAllInFetchedCategory = toggleSelectAllInFetchedCategory;
  window.onInstrumentPickerSearch = onInstrumentPickerSearch;
  window.toggleInstrumentPickerCategory = toggleInstrumentPickerCategory;
  window.addCustomStock = addCustomStock;
  window.onCustomStockKeydown = onCustomStockKeydown;
  window.removeCustomStock = removeCustomStock;
  window.getAllTradableInstruments = getAllTradableInstruments;
  window.getMockBrokerTradableInstruments = getMockBrokerTradableInstruments;
  window.renderInstrumentSlTable = renderInstrumentSlTable;
  window.renderTierReferenceTable = renderTierReferenceTable;
  window.onSlTableLotsInput = onSlTableLotsInput;
  window.getMaxAllowedLots = getMaxAllowedLots;
  window.getNextLotUnlockInfo = getNextLotUnlockInfo;
  window.getOfficialSubLevelKey = getOfficialSubLevelKey;
  window.tierRulesMatrix = tierRulesMatrix;
  window.getRiskSummary = getRiskSummary;
  window.subLevelForBalance = subLevelForBalance;
  window.confirmProfile = confirmProfile;
  window.showTierSelect = showTierSelect;
  window.applyBalanceChange = applyBalanceChange;
  window.recordCompletedDay = recordCompletedDay;
  window.getProfileState = getProfileState;
  window.getTradeHistory = getTradeHistory;
  window.saveJournalEntry = saveJournalEntry;
  window.getJournalEntry = getJournalEntry;
  window.getAllJournalEntries = getAllJournalEntries;
  window.deleteJournalEntry = deleteJournalEntry;
  window.connectBroker = connectBroker;
  window.disconnectBroker = disconnectBroker;
  window.connectMockBroker = connectMockBroker;
  window.toggleMoreBrokers = toggleMoreBrokers;
  window.onBrokerPickerSearch = onBrokerPickerSearch;
  window.startSetupBrokerConnect = startSetupBrokerConnect;
  window.toggleSetupMoreBrokers = toggleSetupMoreBrokers;
  window.onSetupBrokerPickerSearch = onSetupBrokerPickerSearch;
  window.toggleSetupFetchedInstrument = toggleSetupFetchedInstrument;
  window.showManualProfileSetup = showManualProfileSetup;
  window.disconnectMockBroker = disconnectMockBroker;
  window.renderBrokerArea = renderBrokerArea;
  window.getBrokerPnlHistory = getBrokerPnlHistory;
  window.getBrokerPnlSummary = getBrokerPnlSummary;
  window.recordBrokerSyncedTrade = recordBrokerSyncedTrade;
  window.updateTradeRuleStatus = updateTradeRuleStatus;

  // On first load, show the persistent shell right away (sidebar + top bar)
  // instead of hiding it until profile setup finishes. A brand-new user's
  // very first screen should already feel like part of the same app, not a
  // disconnected form — the sidebar nav just stays inert (greyed out, not
  // clickable) until there's something to navigate to. See
  // `.sidebar-setup-mode` in dashboard.css and the early-return guard added
  // to switchTab() for the enforcement side of this.
  document.addEventListener('DOMContentLoaded', () => {
    // ---------- Auth gate (PROTOTYPE MOCK — see auth.js) ----------
    // No logged-in session at all -> bounce to the login screen before
    // anything else renders. NOTE: this prototype only gates ACCESS to the
    // app behind a mock login — it does not yet persist tier/capital/
    // instrument selections across page reloads (that state has always
    // been in-memory only, independent of this auth layer). A returning
    // logged-in user still goes through profile setup once per session;
    // making the profile itself persist is a separate, larger change.
    if (typeof window.Auth === 'undefined') {
      console.warn('auth.js not loaded — skipping the auth gate (app will behave as if logged in).');
    } else if (!window.Auth.getSession()) {
      window.location.href = '/website/auth.html?view=login';
      return;
    }

    const sidebar = document.getElementById('sidebar');
    const topBar = document.getElementById('top-bar');
    if (sidebar) {
      sidebar.classList.remove('hidden');
      sidebar.classList.add('sidebar-setup-mode');
    }
    if (topBar) topBar.classList.remove('hidden');

    const titleEl = document.getElementById('top-bar-page-title');
    if (titleEl) titleEl.innerText = PAGE_TITLES['tab-select'];

    loadComponent('tab-select');
  });

})();