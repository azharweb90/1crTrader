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
  };

  function fmt(n) {
    return Math.round(n).toLocaleString('en-IN');
  }

  function render() {
    const container = document.getElementById('settings-summary-area');
    if (!container) return;

    const state = (typeof window.getProfileState === 'function') ? window.getProfileState() : {};
    const instruments = (typeof window.getAllTradableInstruments === 'function') ? window.getAllTradableInstruments() : [];

    const tierLabel = state.tier ? TIER_LABELS[state.tier] : '\u2014';
    const traderLabel = (state.traderTypes && state.traderTypes.length > 0)
      ? state.traderTypes.map(t => TRADER_TYPE_LABELS[t]).join(', ')
      : '\u2014';
    const startingCapital = state.startingCapital !== null && state.startingCapital !== undefined
      ? `Rs. ${fmt(state.startingCapital)}` : '\u2014';
    const currentBalance = state.currentBalance !== null && state.currentBalance !== undefined
      ? `Rs. ${fmt(state.currentBalance)}` : '\u2014';
    const joinDate = state.joinDate || '\u2014';
    const instrumentsLabel = instruments.length > 0
      ? instruments.map(i => i.label).join(', ')
      : 'None selected';

    container.innerHTML = `
      <div class="settings-stat">
        <div class="settings-stat-label">Capital Tier</div>
        <div class="settings-stat-value">${tierLabel}</div>
      </div>
      <div class="settings-stat">
        <div class="settings-stat-label">Trading Style</div>
        <div class="settings-stat-value">${traderLabel}</div>
      </div>
      <div class="settings-stat">
        <div class="settings-stat-label">Starting Capital</div>
        <div class="settings-stat-value">${startingCapital}</div>
      </div>
      <div class="settings-stat">
        <div class="settings-stat-label">Current Balance</div>
        <div class="settings-stat-value">${currentBalance}</div>
      </div>
      <div class="settings-stat">
        <div class="settings-stat-label">Member Since</div>
        <div class="settings-stat-value">${joinDate}</div>
      </div>
      <div class="settings-stat settings-stat-wide">
        <div class="settings-stat-label">Instruments You Trade</div>
        <div class="settings-stat-value settings-stat-value-small">${instrumentsLabel}</div>
      </div>
    `;
  }

  window.renderSettings = render;

  render();

})();
/* === END COMPONENT: settings (logic) === */