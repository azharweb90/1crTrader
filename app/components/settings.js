/* ===========================================================
   COMPONENT: settings (logic)
   Loaded lazily by dashboard.js the first time this tab opens.

   Read-only summary of the current profile (tier, capital, trading style,
   instruments) with a single "Edit Profile" action that reopens the
   tier-select screen pre-filled, via window.showTierSelect() in dashboard.js.
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

  function fmt(n) {
    return Math.round(n).toLocaleString('en-IN');
  }

  // Broker connect/disconnect UI lives in dashboard.js (see connectMockBroker,
  // disconnectMockBroker, renderBrokerArea) since it's shared between this
  // tab and the Daily Limits Tool, and dashboard.js is always loaded — unlike
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

    renderBrokerArea();
  }

  // handleLogout lives in dashboard.js now, not here — the header avatar
  // menu's Log Out button needs it available from the very first page
  // load, before this component has ever been lazily loaded.

  window.renderSettings = render;

  render();

})();
/* === END COMPONENT: settings (logic) === */