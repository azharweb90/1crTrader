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
      html: "components/tier-select.html",
    },
    "tab-dashboard": {
      html: "components/dashboard-home.html",
      js: "components/dashboard-home.js",
    },
    "tab-calculator": {
      html: "components/calculator.html",
      js: "components/calculator.js",
    },
    "tab-roadmap": {
      html: "components/roadmap.html",
      js: "components/roadmap.js",
    },
    "tab-journal": {
      html: "components/journal.html",
      js: "components/journal.js",
    },
    "tab-education": {
      html: "components/education.html",
      js: "components/education.js",
    },
    "tab-books": {
      html: "components/books.html",
      js: "components/books.js",
    },
    "tab-marketplace": {
      html: "components/marketplace.html",
      js: "components/marketplace.js",
    },
    "tab-strategies": {
      html: "components/strategies.html",
      js: "components/strategies.js",
    },
    "tab-settings": {
      html: "components/settings.html",
      js: "components/settings.js",
    },
    "tab-subs": {
      html: "components/pricing.html",
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
    "tab-marketplace": "Signal Marketplace",
    "tab-strategies": "Strategies",
    "tab-settings": "Settings",
    "tab-subs": "Subscription Pricing",
  };

  // First sub-level key used to pre-select the calculator dropdown per tier.
  const TIER_FIRST_SUBLEVEL = {
    small: "small-1",
    medium: "medium-1",
    large: "large-1",
    pro: "pro-1",
  };

  const TIER_ORDER = ["small", "medium", "large", "pro"];

  const TIER_LABELS = {
    small: "Small",
    medium: "Medium",
    large: "Large",
    pro: "Pro",
  };

  // Min/max capital range per tier, used to validate the entered amount
  // and to detect when a running balance crosses into a new tier.
  const TIER_RANGES = {
    small: { min: 25000, max: 75000 },
    medium: { min: 100000, max: 500000 },
    large: { min: 500000, max: 1000000 },
    pro: { min: 1000000, max: 2000000 },
  };

  const TRADER_TYPE_LABELS = {
    "option-buyer": "Option Buyer",
    "option-seller": "Option Seller",
    "futures-trader": "Futures Trader",
    "hedged-seller": "Hedged Seller",
  };

  // Lot quantity per instrument (NSE/BSE weekly index contracts).
  const INSTRUMENT_INFO = {
    nifty: { label: "Nifty", qty: 65 },
    banknifty: { label: "Bank Nifty", qty: 30 },
    finnifty: { label: "FinNifty", qty: 60 },
    sensex: { label: "Sensex", qty: 20 },
  };

  const fragmentCache = {};
  const scriptLoaded = {};

  // ---------- Global profile state ----------
  let selectedTier = null; // 'small' | 'medium' | 'large' | 'pro' | null
  let selectedTraderTypes = new Set(); // multi-select: any combination of 'option-buyer' | 'option-seller' | 'futures-trader' | 'hedged-seller'
  let startingCapital = null; // rupees, entered by the user, validated against tier range
  let currentBalance = null; // rupees, running balance — starts equal to startingCapital,
  // then shifts as trade P&L is applied (hook for the calculator)
  let profileConfirmed = false; // true once "Continue to Dashboard" has been clicked at least once
  let tradeHistory = []; // [{ id, date, netResult, balanceAfter }], one entry per submitted trade
  let journalEntries = {}; // { [tradeId]: { tradeDetails, execution, logic, psychology, score, grade } }
  let lastTierForBalance = null; // tracks which tier bucket the balance was in, to detect crossings
  let pendingCongrats = null; // { fromTier, toTier } queued until the roadmap screen can show it
  let selectedInstruments = {}; // { nifty: { lots: 1 }, banknifty: { lots: 2 }, ... } — only selected ones are keys
  let customStocks = []; // ['Reliance', 'TCS', ...] — user's own stock names, freeform
  let joinDate = null; // YYYY-MM-DD, set once on first profile confirmation — earliest selectable log date
  let originalStartingCapital = null; // rupees, set ONCE on first profile confirmation — never changes again, even
  // if startingCapital is later edited via Change Tier. This is the fixed
  // baseline the lot-unlock thresholds below are measured against.

  // ---------- Mock broker connection (PROTOTYPE ONLY — no real broker API calls) ----------
  // This entire block simulates what a real Kite Connect / SmartAPI integration would feel
  // like, using fake data generated client-side. Nothing here talks to a real broker. When the
  // real backend exists, this is the seam where actual OAuth + tradebook fetch would replace it.
  let brokerConnected = false; // true once a mock broker is "connected"
  let connectedBrokerName = null; // 'Zerodha' | 'Angel One' | 'Upstox' | null
  let lastSyncedAt = null; // timestamp (ms) of the last successful mock sync, or null

  // Multiplier of originalStartingCapital needed to unlock each additional lot.
  // Extensible: add a 3rd entry (e.g. 2.0) whenever a 3-lot tier is wanted —
  // nothing else needs to change.
  const LOT_UNLOCK_MULTIPLIERS = {
    1: 1.0, // always available from the start
    2: 1.5, // unlocked at +50% profit on original starting capital
  };

  function fmt(n) {
    return Math.round(n).toLocaleString("en-IN");
  }

  function tierForBalance(balance) {
    for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
      const t = TIER_ORDER[i];
      if (balance >= TIER_RANGES[t].min) return t;
    }
    return "small";
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
    const htmlUrl = config.html.includes("?")
      ? `${config.html}&${cacheBust}`
      : `${config.html}?${cacheBust}`;

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
      const script = document.createElement("script");
      script.src = cacheBust
        ? src.includes("?")
          ? `${src}&${cacheBust}`
          : `${src}?${cacheBust}`
        : src;
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
    const sidebar = document.getElementById("sidebar");
    if (
      sidebar &&
      sidebar.classList.contains("sidebar-setup-mode") &&
      tabId !== "tab-select"
    ) {
      return;
    }

    document
      .querySelectorAll(".tab-content")
      .forEach((tab) => tab.classList.remove("active"));
    document
      .querySelectorAll(".sidebar-link")
      .forEach((link) => link.classList.remove("active"));

    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.add("active");

    const sidebarLink = document.querySelector(
      `.sidebar-link[data-tab="${tabId}"]`,
    );
    if (sidebarLink) sidebarLink.classList.add("active");
    else if (event && event.currentTarget) {
      event.currentTarget.classList.add("active");
    }

    const titleEl = document.getElementById("top-bar-page-title");
    if (titleEl && PAGE_TITLES[tabId]) {
      titleEl.innerText = PAGE_TITLES[tabId];
    }

    loadComponent(tabId).then(() => {
      if (tabId === "tab-roadmap") {
        renderPendingCongratsIfReady();
        if (typeof window.renderRoadmap === "function") {
          window.renderRoadmap();
        }
      }
      if (
        tabId === "tab-dashboard" &&
        typeof window.renderDashboardHome === "function"
      ) {
        window.renderDashboardHome();
      }
    });
  }

  // ---------- Profile selection flow (tier + capital + trader type) ----------
  function selectTier(tier) {
    selectedTier = tier;

    document.querySelectorAll(".tier-select-card").forEach((card) => {
      card.classList.toggle("selected", card.dataset.tier === tier);
    });

    // Reveal the capital-amount field now that a tier is chosen, and
    // show its valid range as a hint. Re-validate any amount already typed.
    const wrap = document.getElementById("capital-amount-wrap");
    const hint = document.getElementById("capital-amount-hint");
    if (wrap) wrap.classList.remove("hidden");
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
    const input = document.getElementById("capital-amount-input");
    const row = input ? input.closest(".capital-amount-input-row") : null;
    const errorEl = document.getElementById("capital-amount-error");
    if (!input || !errorEl) return false;

    const raw = input.value.trim();
    if (raw === "") {
      startingCapital = null;
      row.classList.remove("input-error");
      errorEl.classList.add("hidden");
      errorEl.innerText = "";
      updateContinueButtonState();
      return false;
    }

    const amount = parseFloat(raw);
    const range = selectedTier ? TIER_RANGES[selectedTier] : null;

    if (isNaN(amount) || amount <= 0) {
      startingCapital = null;
      row.classList.add("input-error");
      errorEl.classList.remove("hidden");
      errorEl.innerText = "Enter a valid positive amount.";
      updateContinueButtonState();
      return false;
    }

    if (range && (amount < range.min || amount > range.max)) {
      startingCapital = null;
      row.classList.add("input-error");
      errorEl.classList.remove("hidden");
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
    row.classList.remove("input-error");
    errorEl.classList.add("hidden");
    errorEl.innerText = "";
    updateContinueButtonState();
    return true;
  }

  function selectTraderType(traderType) {
    if (selectedTraderTypes.has(traderType)) {
      selectedTraderTypes.delete(traderType);
    } else {
      selectedTraderTypes.add(traderType);
    }

    document.querySelectorAll(".trader-type-card").forEach((card) => {
      card.classList.toggle(
        "selected",
        selectedTraderTypes.has(card.dataset.traderType),
      );
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
    const card = document.querySelector(
      `.instrument-card[data-instrument="${key}"]`,
    );
    if (!card) return;

    if (selectedInstruments[key]) {
      delete selectedInstruments[key];
      card.classList.remove("selected");
    } else {
      selectedInstruments[key] = { lots: 1 };
      card.classList.add("selected");
    }

    updateSelectAllButtonState();
    updateContinueButtonState();

    if (profileConfirmed) {
      renderInstrumentSlTable();
    }
  }

  function toggleSelectAllInstruments() {
    const allKeys = Object.keys(INSTRUMENT_INFO);
    const allCurrentlySelected = allKeys.every((k) => selectedInstruments[k]);

    allKeys.forEach((key) => {
      const card = document.querySelector(
        `.instrument-card[data-instrument="${key}"]`,
      );
      if (allCurrentlySelected) {
        delete selectedInstruments[key];
        if (card) card.classList.remove("selected");
      } else {
        if (!selectedInstruments[key]) {
          selectedInstruments[key] = { lots: 1 };
        }
        if (card) card.classList.add("selected");
      }
    });

    updateSelectAllButtonState();
    updateContinueButtonState();

    if (profileConfirmed) {
      renderInstrumentSlTable();
    }
  }

  function updateSelectAllButtonState() {
    const btn = document.getElementById("select-all-instruments-btn");
    if (!btn) return;
    const allKeys = Object.keys(INSTRUMENT_INFO);
    const allSelected = allKeys.every((k) => selectedInstruments[k]);
    btn.classList.toggle("all-selected", allSelected);
    btn.innerText = allSelected ? "All Selected ✓" : "Select All";
  }

  // ---------- Custom stocks (freeform, for stock option buyers/sellers) ----------
  function addCustomStock() {
    const input = document.getElementById("custom-stock-input");
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;

    // Support comma-separated entry too (e.g. "Reliance, TCS")
    const names = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    names.forEach((name) => {
      const alreadyExists = customStocks.some(
        (s) => s.toLowerCase() === name.toLowerCase(),
      );
      if (!alreadyExists) customStocks.push(name);
    });

    input.value = "";
    renderCustomStockChips();
    updateContinueButtonState();
  }

  function onCustomStockKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomStock();
    }
  }

  function removeCustomStock(name) {
    customStocks = customStocks.filter((s) => s !== name);
    renderCustomStockChips();
    updateContinueButtonState();
  }

  function renderCustomStockChips() {
    const container = document.getElementById("custom-stock-chips");
    if (!container) return;
    container.innerHTML = customStocks
      .map(
        (name) => `
      <span class="custom-stock-chip">
        ${name}
        <button type="button" class="custom-stock-chip-remove" onclick="removeCustomStock('${name.replace(/'/g, "\\'")}')">&times;</button>
      </span>
    `,
      )
      .join("");
  }

  function updateContinueButtonState() {
    const btn = document.getElementById("profile-continue-btn");
    if (!btn) return;
    const instrumentsOk =
      Object.keys(selectedInstruments).length > 0 || customStocks.length > 0;
    btn.disabled = !(
      selectedTier &&
      selectedTraderTypes.size > 0 &&
      startingCapital !== null &&
      instrumentsOk
    );
  }

  function todayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function confirmProfile() {
    if (
      !(
        selectedTier &&
        selectedTraderTypes.size > 0 &&
        startingCapital !== null
      )
    )
      return;

    if (!profileConfirmed) {
      // Only set once — the very first confirmation is "join day", the
      // earliest date selectable when later submitting a trading log.
      // originalStartingCapital is likewise fixed forever from this point,
      // used as the permanent baseline for lot-unlock thresholds below.
      joinDate = todayDateString();
      originalStartingCapital = startingCapital;
    }
    profileConfirmed = true;

    // The shell has been visible since page load (see DOMContentLoaded
    // below) — confirming the profile just exits "setup mode" so the
    // sidebar nav becomes clickable.
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.remove("sidebar-setup-mode");
    refreshHeaderBadge();

    // Switch into the Dashboard tab as the new default landing screen.
    document
      .querySelectorAll(".tab-content")
      .forEach((tab) => tab.classList.remove("active"));
    document
      .querySelectorAll(".sidebar-link")
      .forEach((link) => link.classList.remove("active"));
    const dashboardTab = document.getElementById("tab-dashboard");
    if (dashboardTab) dashboardTab.classList.add("active");
    const dashboardLink = document.querySelector(
      '.sidebar-link[data-tab="tab-dashboard"]',
    );
    if (dashboardLink) dashboardLink.classList.add("active");

    const titleEl = document.getElementById("top-bar-page-title");
    if (titleEl) titleEl.innerText = PAGE_TITLES["tab-dashboard"];

    loadComponent("tab-dashboard");

    Object.keys(COMPONENTS).forEach(applyTierHighlight);
  }

  function showTierSelect() {
    document
      .querySelectorAll(".tab-content")
      .forEach((tab) => tab.classList.remove("active"));
    document
      .querySelectorAll(".sidebar-link")
      .forEach((link) => link.classList.remove("active"));
    const selectTab = document.getElementById("tab-select");
    if (selectTab) selectTab.classList.add("active");
    loadComponent("tab-select");
  }

  function refreshHeaderBadge() {
    const badge = document.getElementById("active-tier-badge");
    const label = document.getElementById("active-tier-label");
    const balancePill = document.getElementById("header-balance-pill");
    const balanceValue = document.getElementById("header-balance-value");

    if (badge && label) {
      badge.style.display = "inline-flex";
      const tierText = selectedTier ? TIER_LABELS[selectedTier] + " Tier" : "";
      const traderText =
        selectedTraderTypes.size > 0
          ? Array.from(selectedTraderTypes)
              .map((t) => TRADER_TYPE_LABELS[t])
              .join(" + ")
          : "";
      label.innerText = [tierText, traderText].filter(Boolean).join(" \u00b7 ");
    }

    if (balancePill && balanceValue && currentBalance !== null) {
      balancePill.style.display = "flex";
      balanceValue.innerText = `Rs. ${fmt(currentBalance)}`;
    }
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
  function recordCompletedDay(
    netResult,
    dateString,
    instrumentLabel,
    ruleStatus,
  ) {
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
      ruleStatus: ruleStatus || {
        compliant: true,
        label: "Within rules",
        source: "manual",
      },
    });

    tradeHistory.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.submittedAt - b.submittedAt;
    });

    // Recalculate every entry's running balance from the starting capital,
    // walking forward in date (then submission) order.
    let runningBalance = startingCapital;
    tradeHistory.forEach((entry) => {
      runningBalance += entry.netResult;
      entry.balanceAfter = runningBalance;
    });

    currentBalance = runningBalance;
    checkTierCrossing();
    refreshHeaderBadge();
    renderInstrumentSlTable();

    if (typeof window.renderCalculatorHistory === "function") {
      window.renderCalculatorHistory();
    }

    if (typeof window.renderJournalList === "function") {
      window.renderJournalList();
    }

    if (typeof window.renderCalculatorBrokerMode === "function") {
      window.renderCalculatorBrokerMode();
    }

    if (
      document.getElementById("tab-settings") &&
      document.getElementById("tab-settings").classList.contains("active") &&
      typeof window.renderSettings === "function"
    ) {
      window.renderSettings();
    }

    if (
      document.getElementById("tab-roadmap") &&
      document.getElementById("tab-roadmap").classList.contains("active") &&
      typeof window.renderRoadmap === "function"
    ) {
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
    const entry = tradeHistory.find((t) => t.id === tradeId);
    if (!entry) return;
    entry.ruleStatus = ruleStatus;
    if (typeof window.renderCalculatorHistory === "function") {
      window.renderCalculatorHistory();
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

    if (
      document.getElementById("tab-roadmap") &&
      document.getElementById("tab-roadmap").classList.contains("active") &&
      typeof window.renderRoadmap === "function"
    ) {
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
    showHeaderToast(
      `🎉 Congratulations — you've reached the ${TIER_LABELS[toTier]} tier!`,
    );

    // If the roadmap screen happens to already be loaded, render its banner now too.
    renderPendingCongratsIfReady();
  }

  function showHeaderToast(message) {
    let toast = document.getElementById("header-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "header-toast";
      toast.className = "header-toast";
      document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.classList.add("visible");
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.classList.remove("visible");
    }, 6000);
  }

  function renderPendingCongratsIfReady() {
    if (!pendingCongrats) return;
    const slot = document.getElementById("congrats-banner-slot");
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

  // ---------- Points stop-loss table (Daily Limits Tool) ----------
  // Reads the currently-displayed max rupee loss from the calculator's own
  // "out-max-loss" stat (already computed there per tier+sub-level), so the
  // tier rules matrix lives in exactly one place (components/calculator.js).
  function getCurrentMaxLossRupees() {
    const el = document.getElementById("out-max-loss");
    if (!el) return null;
    const match = el.innerText.match(/Rs\.\s*([\d,]+)/);
    if (!match) return null;
    return parseInt(match[1].replace(/,/g, ""), 10);
  }

  // How many lots the trader is currently allowed to use, based on their
  // CURRENT BALANCE measured against their ORIGINAL starting capital — never
  // the (possibly re-entered) startingCapital value. A Small trader who
  // started at Rs. 25,000 only unlocks lot 2 once balance reaches Rs. 37,500
  // (1.5x), regardless of what their tier/capital is edited to later.
  function getMaxAllowedLots() {
    if (originalStartingCapital === null || currentBalance === null) return 1;

    let maxLots = 1;
    Object.keys(LOT_UNLOCK_MULTIPLIERS).forEach((lotCountStr) => {
      const lotCount = parseInt(lotCountStr, 10);
      const requiredBalance =
        originalStartingCapital * LOT_UNLOCK_MULTIPLIERS[lotCount];
      if (currentBalance >= requiredBalance && lotCount > maxLots) {
        maxLots = lotCount;
      }
    });
    return maxLots;
  }

  // Balance still needed to reach the NEXT lot unlock, or null if there is
  // no further tier defined yet (extensible via LOT_UNLOCK_MULTIPLIERS).
  function getNextLotUnlockInfo() {
    if (originalStartingCapital === null || currentBalance === null)
      return null;

    const currentMax = getMaxAllowedLots();
    const nextLotCount = currentMax + 1;
    const nextMultiplier = LOT_UNLOCK_MULTIPLIERS[nextLotCount];
    if (!nextMultiplier) return null;

    const requiredBalance = originalStartingCapital * nextMultiplier;
    const remaining = requiredBalance - currentBalance;
    return {
      nextLotCount,
      requiredBalance,
      remaining: remaining > 0 ? remaining : 0,
    };
  }

  function renderInstrumentSlTable() {
    const wrap = document.getElementById("instrument-sl-wrap");
    const grid = document.getElementById("instrument-sl-grid");
    if (!wrap || !grid) return;

    const keys = Object.keys(selectedInstruments);
    if (keys.length === 0) {
      wrap.classList.add("hidden");
      return;
    }

    const maxLoss = getCurrentMaxLossRupees();
    if (maxLoss === null) {
      wrap.classList.add("hidden");
      return;
    }

    wrap.classList.remove("hidden");
    if (typeof window.applyReferenceSectionState === "function") {
      window.applyReferenceSectionState("instrument-ref");
    }

    const maxAllowedLots = getMaxAllowedLots();

    let html = `
      <div class="mini-ladder-cell mini-ladder-head">Instrument</div>
      <div class="mini-ladder-cell mini-ladder-head num">Qty/Lot</div>
      <div class="mini-ladder-cell mini-ladder-head num">Lots</div>
      <div class="mini-ladder-cell mini-ladder-head num">Points SL</div>
    `;

    keys.forEach((key) => {
      const info = INSTRUMENT_INFO[key];
      let lots = selectedInstruments[key].lots || 1;
      // Clamp to whatever is currently allowed — e.g. if balance dropped
      // back below a threshold after a losing day, lots reduce automatically.
      if (lots > maxAllowedLots) {
        lots = maxAllowedLots;
        selectedInstruments[key].lots = lots;
      }
      const totalQty = info.qty * lots;
      const pointsSl = totalQty > 0 ? maxLoss / totalQty : 0;

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
    const noteEl = document.getElementById("lot-unlock-note");
    if (noteEl) {
      const nextUnlock = getNextLotUnlockInfo();
      if (maxAllowedLots === 1 && nextUnlock) {
        noteEl.innerText = `You're limited to 1 lot per trade until your balance reaches Rs. ${fmt(nextUnlock.requiredBalance)} (50% profit on your original starting capital of Rs. ${fmt(originalStartingCapital)}). Rs. ${fmt(nextUnlock.remaining)} to go.`;
        noteEl.classList.remove("hidden");
      } else if (nextUnlock) {
        noteEl.innerText = `You're cleared for up to ${maxAllowedLots} lots per trade. Reach Rs. ${fmt(nextUnlock.requiredBalance)} to unlock lot ${nextUnlock.nextLotCount} (Rs. ${fmt(nextUnlock.remaining)} to go).`;
        noteEl.classList.remove("hidden");
      } else if (maxAllowedLots > 1) {
        noteEl.innerText = `You're cleared for up to ${maxAllowedLots} lots per trade based on your account growth. That's the highest currently configured — no further lot unlock is defined yet.`;
        noteEl.classList.remove("hidden");
      } else {
        noteEl.classList.add("hidden");
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
    let validLots = isNaN(lots) || lots < 1 ? 1 : lots;

    // Enforce the lot cap. If the typed value had to be clamped down, show
    // an immediate, specific reason right at the note location — relying
    // only on the static unlock-progress paragraph below the table left
    // people with no feedback at the moment their input was overridden.
    if (validLots > maxAllowedLots) {
      const attemptedLots = validLots;
      validLots = maxAllowedLots;
      const inputEl = document.querySelector(
        `.sl-lots-input[data-instrument-key="${key}"]`,
      );
      if (inputEl) inputEl.value = validLots;
      flashLotCapMessage(attemptedLots, maxAllowedLots);
    }

    selectedInstruments[key].lots = validLots;

    const maxLoss = getCurrentMaxLossRupees();
    const info = INSTRUMENT_INFO[key];
    if (maxLoss === null || !info) return;

    const totalQty = info.qty * validLots;
    const pointsSl = totalQty > 0 ? maxLoss / totalQty : 0;

    const outputCell = document.querySelector(
      `.sl-points-output[data-row-key="${key}"]`,
    );
    if (outputCell) {
      outputCell.innerText = `${pointsSl.toFixed(2)} pts`;
    }
  }

  let lotCapFlashTimeoutId = null;

  // Briefly shows WHY a typed lot count was rejected, directly at the note
  // location, then restores the normal unlock-progress message after a few
  // seconds. This is in addition to (not instead of) the static note.
  function flashLotCapMessage(attemptedLots, maxAllowedLots) {
    const noteEl = document.getElementById("lot-unlock-note");
    if (!noteEl) return;

    const nextUnlock = getNextLotUnlockInfo();
    const ceilingNote = nextUnlock
      ? `Reach Rs. ${fmt(nextUnlock.requiredBalance)} to unlock lot ${nextUnlock.nextLotCount} (Rs. ${fmt(nextUnlock.remaining)} to go).`
      : `${maxAllowedLots} lot${maxAllowedLots === 1 ? "" : "s"} is the maximum currently defined for this account size — there's no further unlock configured yet.`;

    noteEl.innerText = `You typed ${attemptedLots} lots, but you're only cleared for ${maxAllowedLots} right now — it's been set back to ${maxAllowedLots}. ${ceilingNote}`;
    noteEl.classList.remove("hidden");
    noteEl.classList.add("lot-cap-flash");

    if (lotCapFlashTimeoutId) clearTimeout(lotCapFlashTimeoutId);
    lotCapFlashTimeoutId = setTimeout(() => {
      noteEl.classList.remove("lot-cap-flash");
      renderInstrumentSlTable(); // restores the normal static unlock note
    }, 4000);
  }

  function getProfileState() {
    const traderTypesArray = Array.from(selectedTraderTypes);
    return {
      tier: selectedTier,
      traderType: traderTypesArray[0] || null, // first selected, kept for backward compatibility
      traderTypes: traderTypesArray, // full multi-select list
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
  const BROKERS = [
    {
      id: "zerodha",
      name: "Zerodha",
      initial: "Z",
      colorClass: "broker-chip-orange",
    },
    {
      id: "angelone",
      name: "Angel One",
      initial: "A",
      colorClass: "broker-chip-red",
    },
    {
      id: "upstox",
      name: "Upstox",
      initial: "U",
      colorClass: "broker-chip-purple",
    },
  ];
  let brokerConnecting = null; // broker id currently mid-"connect", or null

  // Renders the connect/connected broker UI into EVERY container id that has
  // this markup structure that's currently present in the DOM — used by
  // both the Settings tab and the Daily Limits Tool's broker panel, so
  // connecting/disconnecting works identically from either screen.
  const BROKER_AREA_IDS = ["broker-connect-area", "calc-broker-connect-area"];

  function renderBrokerArea() {
    BROKER_AREA_IDS.forEach(renderBrokerAreaInto);
  }

  function renderBrokerAreaInto(containerId) {
    const area = document.getElementById(containerId);
    if (!area) return;

    if (brokerConnected) {
      const broker = BROKERS.find((b) => b.name === connectedBrokerName);
      const lastSync = lastSyncedAt
        ? new Date(lastSyncedAt).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Not synced yet";
      area.innerHTML = `
        <div class="broker-connected-row">
          <span class="broker-chip ${broker ? broker.colorClass : ""}">${broker ? broker.initial : "?"}</span>
          <span class="broker-connected-text">Connected to ${connectedBrokerName}</span>
          <span class="broker-last-sync">Last synced: ${lastSync}</span>
          <button type="button" class="broker-disconnect-btn" onclick="disconnectMockBroker()">Disconnect</button>
        </div>
      `;
      return;
    }

    area.innerHTML = `
      <div class="broker-grid">
        ${BROKERS.map(
          (b) => `
          <button type="button" class="broker-option-btn" onclick="connectMockBroker('${b.name}')" ${brokerConnecting ? "disabled" : ""}>
            <span class="broker-chip ${b.colorClass}">${b.initial}</span>
            <span>${brokerConnecting === b.id ? "Connecting..." : b.name}</span>
          </button>
        `,
        ).join("")}
      </div>
    `;
  }

  function connectMockBroker(brokerName) {
    const broker = BROKERS.find((b) => b.name === brokerName);
    brokerConnecting = broker ? broker.id : brokerName;
    renderBrokerArea();

    connectBroker(brokerName, () => {
      brokerConnecting = null;
      renderBrokerArea();
      if (typeof window.renderCalculatorBrokerMode === "function") {
        window.renderCalculatorBrokerMode();
      }
    });
  }

  function disconnectMockBroker() {
    disconnectBroker();
    renderBrokerArea();
    if (typeof window.renderCalculatorBrokerMode === "function") {
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
      if (typeof onConnected === "function") onConnected();
    }, 1400);
  }

  function disconnectBroker() {
    brokerConnected = false;
    connectedBrokerName = null;
    lastSyncedAt = null;
    brokerPnlData = {};
  }

  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Builds a realistic-looking scrip name, e.g. "NIFTY 2026-04-21 PE 24400",
  // matching how a real broker P&L statement labels option contracts.
  function buildScripName(instrumentLabel) {
    const base = instrumentLabel.toUpperCase().replace(/\s+/g, "");
    const today = new Date();
    const expiryOffsetDays = Math.floor(Math.random() * 28) + 1;
    const expiry = new Date(today);
    expiry.setDate(
      expiry.getDate() - expiryOffsetDays - Math.floor(Math.random() * 60),
    );
    const expiryStr = ymd(expiry);
    const optType = Math.random() < 0.5 ? "CE" : "PE";
    const strikeBase =
      { NIFTY: 24000, BANKNIFTY: 51000, FINNIFTY: 23000, SENSEX: 77000 }[
        base
      ] || 24000;
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
    const pool =
      instruments.length > 0
        ? instruments
        : [{ value: "nifty", label: "Nifty" }];
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
        const charges =
          Math.round((qty * 0.06 + Math.random() * 40) * 100) / 100;
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

  // Aggregates realized P&L / charges / net P&L across every scrip row whose
  // date falls within [fromDateString, toDateString] inclusive — powers the
  // stat cards at the top of the broker P&L browser (mirrors how a real
  // broker's P&L report summarizes a selected date range).
  function getBrokerPnlSummary(fromDateString, toDateString) {
    let realizedPnl = 0; // gross, before charges
    let totalCharges = 0;
    let netRealizedPnl = 0;

    Object.keys(brokerPnlData).forEach((date) => {
      if (date < fromDateString || date > toDateString) return;
      brokerPnlData[date].forEach((row) => {
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
  function recordBrokerSyncedTrade(
    netResult,
    instrumentLabel,
    ruleStatus,
    dateString,
  ) {
    if (!brokerConnected) return null;
    lastSyncedAt = Date.now();
    return recordCompletedDay(
      netResult,
      dateString || todayDateString(),
      instrumentLabel,
      ruleStatus,
    );
  }

  // Combined list of everything the user can pick as "today's instrument"
  // when logging a trade: their selected index instruments (Nifty, Bank
  // Nifty, etc.) plus any custom stocks they've added. Each item has a
  // `label` for display and a `value` safe to use in a <select>.
  function getAllTradableInstruments() {
    const list = [];
    Object.keys(selectedInstruments).forEach((key) => {
      const info = INSTRUMENT_INFO[key];
      if (info) list.push({ value: key, label: info.label });
    });
    customStocks.forEach((name) => {
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
    journalEntries[tradeId] = Object.assign(
      {},
      journalEntries[tradeId],
      entryData,
    );
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

    if (tabId === "tab-select") {
      if (selectedTier) {
        container.querySelectorAll(".tier-select-card").forEach((card) => {
          card.classList.toggle("selected", card.dataset.tier === selectedTier);
        });
        const wrap = document.getElementById("capital-amount-wrap");
        const hint = document.getElementById("capital-amount-hint");
        const input = document.getElementById("capital-amount-input");
        if (wrap) wrap.classList.remove("hidden");
        if (hint) {
          const range = TIER_RANGES[selectedTier];
          hint.innerText = `Enter an amount between Rs. ${fmt(range.min)} and Rs. ${fmt(range.max)} for the ${TIER_LABELS[selectedTier]} tier.`;
        }
        if (input && startingCapital !== null && input.value === "") {
          input.value = startingCapital;
        }
      }
      if (selectedTraderTypes.size > 0) {
        container.querySelectorAll(".trader-type-card").forEach((card) => {
          card.classList.toggle(
            "selected",
            selectedTraderTypes.has(card.dataset.traderType),
          );
        });
      }
      Object.keys(INSTRUMENT_INFO).forEach((key) => {
        const card = container.querySelector(
          `.instrument-card[data-instrument="${key}"]`,
        );
        if (!card) return;
        card.classList.toggle("selected", !!selectedInstruments[key]);
      });
      updateSelectAllButtonState();
      renderCustomStockChips();
      updateContinueButtonState();
      return;
    }

    if (!selectedTier) return;

    if (tabId === "tab-subs") {
      const targetLabel = TIER_LABELS[selectedTier];
      container.querySelectorAll(".pricing-card").forEach((card) => {
        const nameEl = card.querySelector(".tier-name");
        const matches = nameEl && nameEl.textContent.trim() === targetLabel;
        card.classList.toggle("tier-highlight", !!matches);
      });
      return;
    }

    if (tabId === "tab-calculator") {
      // Highlight the matching row in the mini ladder reference table (all 4 cells).
      const targetTier = selectedTier;
      container
        .querySelectorAll(".mini-ladder-cell[data-tier-row]")
        .forEach((cell) => {
          const isMatch = cell.dataset.tierRow === targetTier;
          cell.classList.toggle(
            "tier-highlight",
            isMatch && cell.classList.contains("mini-ladder-label"),
          );
          cell.classList.toggle(
            "tier-highlight-row",
            isMatch && !cell.classList.contains("mini-ladder-label"),
          );
        });

      const select = document.getElementById("calc-tier");
      if (select) {
        select.value = TIER_FIRST_SUBLEVEL[selectedTier];
        if (typeof window.onTierChange === "function") {
          window.onTierChange(); // this already calls renderInstrumentSlTable() internally
        }
      }

      return;
    }

    if (tabId === "tab-roadmap") {
      renderPendingCongratsIfReady();
      if (typeof window.renderRoadmap === "function") {
        window.renderRoadmap();
      }
      return;
    }
  }

  // Expose handlers used by inline onclick attributes in index.html / components,
  // and the state/balance hooks for components/calculator.js and roadmap.js.
  window.switchTab = switchTab;
  window.selectTier = selectTier;
  window.selectTraderType = selectTraderType;
  window.onCapitalAmountInput = onCapitalAmountInput;
  window.toggleInstrument = toggleInstrument;
  window.toggleSelectAllInstruments = toggleSelectAllInstruments;
  window.addCustomStock = addCustomStock;
  window.onCustomStockKeydown = onCustomStockKeydown;
  window.removeCustomStock = removeCustomStock;
  window.getAllTradableInstruments = getAllTradableInstruments;
  window.renderInstrumentSlTable = renderInstrumentSlTable;
  window.onSlTableLotsInput = onSlTableLotsInput;
  window.getMaxAllowedLots = getMaxAllowedLots;
  window.getNextLotUnlockInfo = getNextLotUnlockInfo;
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
  document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.getElementById("sidebar");
    const topBar = document.getElementById("top-bar");
    if (sidebar) {
      sidebar.classList.remove("hidden");
      sidebar.classList.add("sidebar-setup-mode");
    }
    if (topBar) topBar.classList.remove("hidden");

    const titleEl = document.getElementById("top-bar-page-title");
    if (titleEl) titleEl.innerText = PAGE_TITLES["tab-select"];

    loadComponent("tab-select");
  });
})();
