/* ===========================================================
   COMPONENT: settings (logic)
   Loaded lazily by app-shell.js the first time this tab opens.

   Read-only summary of the current profile (tier, capital, trading style,
   instruments) with a single "Edit Profile" action that reopens the
   tier-select screen pre-filled, via window.showTierSelect() in app-shell.js.
   =========================================================== */

(function () {

  const TIER_LABELS = {
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
    pro: 'Pro',
  };

  const TRADER_TYPE_LABELS = {
    'option-buyer': 'Option Buyer',
    'option-seller': 'Option Seller',
    'futures-trader': 'Futures Trader',
    'hedged-seller': 'Hedged Seller',
    'equity-trader': 'Equity / Cash Trader',
    'spread-trader': 'Spread Trader',
    'scalper': 'Scalper',
    'swing-trader': 'Swing Trader',
  };

  // fmt() now shared — see /src/app/shared/utils/formatters.js

  // ---------- Plan comparison (merged in from the old standalone
  // Subscription Pricing tab) — shown inline via "Manage plan" instead of
  // navigating to a separate page, since pricing.html is a bare fragment
  // meant to be fetched into a tab, not opened as its own document. ----------
  const PRICING_TIERS = [
    { key: 'small', name: 'Small', monthly: 625, yearlyOld: 7500, yearlyNew: 6000 },
    { key: 'medium', name: 'Medium', monthly: 1250, yearlyOld: 15000, yearlyNew: 12000 },
    { key: 'large', name: 'Large', monthly: 2500, yearlyOld: 30000, yearlyNew: 24000, popular: true },
    { key: 'pro', name: 'Pro', monthly: 5000, yearlyOld: 60000, yearlyNew: 48000 },
  ];

  function renderPricingCompare(currentTierKey) {
    const container = document.getElementById('account-pricing-container');
    if (!container) return;
    container.innerHTML = PRICING_TIERS.map(t => `
      <div class="pricing-card ${t.popular ? 'popular' : ''} ${t.key === currentTierKey ? 'tier-highlight' : ''}">
        ${t.popular ? '<div class="badge">Best Value</div>' : ''}
        <div>
          <div class="tier-name">${t.name}</div>
          <div class="price-block">
            <div class="monthly-price">₹${fmt(t.monthly)}<span>/mo</span></div>
          </div>
          <div class="yearly-block">
            <div class="old-price">₹${fmt(t.yearlyOld)}</div>
            <div class="new-price">₹${fmt(t.yearlyNew)}</div>
            <div class="yearly-label">Yearly &middot; 20% Off</div>
          </div>
        </div>
        <button type="button" class="action-btn" ${t.key === currentTierKey ? 'disabled' : ''}>${t.key === currentTierKey ? 'Current Plan' : 'Subscribe ' + t.name}</button>
      </div>
    `).join('');
  }

  function togglePlanCompare() {
    const wrap = document.getElementById('account-plan-compare');
    if (wrap) wrap.classList.toggle('hidden');
  }
  window.togglePlanCompare = togglePlanCompare;

  // Broker connect/disconnect UI lives in app-shell.js (see connectMockBroker,
  // disconnectMockBroker, renderBrokerArea) since it's shared between this
  // tab and the Daily Limits Tool, and app-shell.js is always loaded — unlike
  // this component, which only loads lazily when Settings is opened.

  function render() {
    const session = (typeof window.Auth !== 'undefined') ? window.Auth.getSession() : null;
    const state = (typeof window.getProfileState === 'function') ? window.getProfileState() : {};
    const riskSummary = (typeof window.getRiskSummary === 'function') ? window.getRiskSummary() : null;
    const instruments = (typeof window.getAllTradableInstruments === 'function') ? window.getAllTradableInstruments() : [];

    // ---------- Profile header: avatar, name, email, phone, member since ----------
    const avatarEl = document.getElementById('account-avatar');
    if (avatarEl) {
      avatarEl.innerText = (typeof window.getInitials === 'function')
        ? window.getInitials(session ? session.name : '')
        : '?';
    }
    const nameEl = document.getElementById('account-name');
    if (nameEl) nameEl.innerText = session ? session.name : 'Trader';

    const emailEl = document.getElementById('account-email');
    if (emailEl) emailEl.innerText = session ? session.email : 'Not logged in';

    const phoneEl = document.getElementById('account-phone');
    if (phoneEl) phoneEl.innerText = (session && session.phone) ? session.phone : '';

    const memberSinceEl = document.getElementById('account-member-since');
    if (memberSinceEl) {
      if (session && session.createdAt) {
        const created = new Date(session.createdAt);
        memberSinceEl.innerText = `Account created ${created.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
      } else {
        memberSinceEl.innerText = '';
      }
    }

    // ---------- Risk rules card (same data + look as the Dashboard tab's
    // "Your Risk Rules Right Now", via the dash-risk-card styles) ----------
    const riskGrid = document.getElementById('account-risk-grid');
    const riskLotNote = document.getElementById('account-risk-lot-note');
    if (riskGrid) {
      if (!riskSummary || riskSummary.maxLossRupees === null) {
        riskGrid.innerHTML = `<p class="section-note">Finish profile setup to see your risk rules here.</p>`;
        if (riskLotNote) riskLotNote.innerText = '';
      } else {
        const maxLots = (typeof window.getMaxAllowedLots === 'function') ? window.getMaxAllowedLots() : riskSummary.maxLots;
        riskGrid.innerHTML = `
          <div class="dash-risk-card">
            <div class="dash-risk-label">Capital Tier</div>
            <div class="dash-risk-value">${riskSummary.tierLabel}</div>
          </div>
          <div class="dash-risk-card">
            <div class="dash-risk-label">Max Loss Today</div>
            <div class="dash-risk-value">₹${fmt(riskSummary.maxLossRupees)}</div>
            <div class="dash-risk-sublabel">${riskSummary.maxLossPct}% of capital</div>
          </div>
          <div class="dash-risk-card">
            <div class="dash-risk-label">Lots Allowed</div>
            <div class="dash-risk-value">${maxLots}</div>
          </div>
        `;
        if (riskLotNote) {
          riskLotNote.innerText = riskSummary.nextLotUnlock
            ? `Reach ₹${fmt(riskSummary.nextLotUnlock.requiredBalance)} balance (₹${fmt(riskSummary.nextLotUnlock.remaining)} more) to unlock lot ${riskSummary.nextLotUnlock.nextLotCount}.`
            : `You're at the maximum lot allowance for your tier.`;
        }
      }
    }

    // ---------- Trading style, as chips (no truncation problem — chips wrap) ----------
    const traderTypesEl = document.getElementById('account-trader-types');
    if (traderTypesEl) {
      const types = state.traderTypes || [];
      traderTypesEl.innerHTML = types.length > 0
        ? types.map(t => `<span class="account-chip">${TRADER_TYPE_LABELS[t] || t}</span>`).join('')
        : `<p class="section-note">No trading style selected yet.</p>`;
    }

    // ---------- Capital: starting vs. current, with P&L since joining ----------
    const capitalGrid = document.getElementById('account-capital-grid');
    if (capitalGrid) {
      const hasCapital = state.startingCapital !== null && state.startingCapital !== undefined
        && state.currentBalance !== null && state.currentBalance !== undefined;
      if (!hasCapital) {
        capitalGrid.innerHTML = `<p class="section-note">No capital on file yet.</p>`;
      } else {
        const pnl = state.currentBalance - state.startingCapital;
        const pnlSign = pnl > 0 ? '+' : (pnl < 0 ? '\u2212' : '');
        const pnlClass = pnl > 0 ? 'account-pnl-positive' : (pnl < 0 ? 'account-pnl-negative' : '');
        capitalGrid.innerHTML = `
          <div class="settings-stat">
            <div class="settings-stat-label">Starting Capital</div>
            <div class="settings-stat-value">₹${fmt(state.startingCapital)}</div>
          </div>
          <div class="settings-stat">
            <div class="settings-stat-label">Current Balance</div>
            <div class="settings-stat-value">₹${fmt(state.currentBalance)}</div>
          </div>
          <div class="settings-stat">
            <div class="settings-stat-label">P&amp;L Since Joining</div>
            <div class="settings-stat-value ${pnlClass}">${pnlSign}₹${fmt(Math.abs(pnl))}</div>
          </div>
          <div class="settings-stat">
            <div class="settings-stat-label">Member Since</div>
            <div class="settings-stat-value">${state.joinDate || '\u2014'}</div>
          </div>
        `;
      }
    }

    // ---------- Instruments, as chips ----------
    const instrumentsEl = document.getElementById('account-instruments');
    if (instrumentsEl) {
      instrumentsEl.innerHTML = instruments.length > 0
        ? instruments.map(i => `<span class="account-chip">${i.label}</span>`).join('')
        : `<p class="section-note">No instruments selected yet.</p>`;
    }

    // ---------- Plan & Billing (merged in from the old standalone
    // Subscription Pricing tab — same per-tier pricing table, shown here
    // as the trader's own active plan instead of a full comparison grid) ----------
    const planCardEl = document.getElementById('account-plan-card');
    if (planCardEl) {
      const tierKey = state.tier;
      const PLAN_PRICE = { small: 625, medium: 1250, large: 2500, pro: 5000 };
      if (!tierKey || !PLAN_PRICE[tierKey]) {
        planCardEl.innerHTML = `<p class="section-note">Finish profile setup to see your plan here.</p>`;
      } else {
        const price = PLAN_PRICE[tierKey];
        const email = session ? session.email : '';
        planCardEl.innerHTML = `
          <div class="account-plan-card">
            <div class="account-plan-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z"/></svg>
            </div>
            <div class="account-plan-main">
              <div class="account-plan-name-row">
                <span class="account-plan-name">${TIER_LABELS[tierKey]}</span>
                <span class="account-plan-badge">Active</span>
              </div>
              <div class="account-plan-sub">₹${fmt(price)} / month · renews next billing cycle</div>
            </div>
            <button type="button" class="account-plan-manage-btn" onclick="togglePlanCompare()">Manage plan</button>
          </div>
          <div class="account-plan-details">
            <div class="account-plan-detail">
              <div class="account-plan-detail-label">Payment method</div>
              <div class="account-plan-detail-value">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5B6B82" stroke-width="1.7"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg>
                UPI · ${email || 'not set'}
              </div>
            </div>
            <div class="account-plan-detail">
              <div class="account-plan-detail-label">Next invoice</div>
              <div class="account-plan-detail-value">₹${fmt(price)} on next renewal</div>
            </div>
          </div>
        `;
      }
      renderPricingCompare(tierKey);
    }

    renderBrokerArea();
  }

  // handleLogout lives in app-shell.js now, not here — the header avatar
  // menu's Log Out button needs it available from the very first page
  // load, before this component has ever been lazily loaded.

  window.renderSettings = render;

  render();

})();
/* === END COMPONENT: settings (logic) === */