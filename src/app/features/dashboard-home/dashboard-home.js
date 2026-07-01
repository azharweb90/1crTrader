/* ===========================================================
   COMPONENT: dashboard-home (logic)
   Loaded lazily by app-shell.js the first time the Dashboard tab opens.

   Shows 4 key stat cards (Balance, Win Rate, Total Trades, Net P&L),
   quick-link shortcuts to the other sections, and a short recent-activity
   list pulled from the same trade history used everywhere else.
   =========================================================== */

(function () {

  // fmt() now shared — see /src/app/shared/utils/formatters.js

  function formatDateShort(isoDateString) {
    const d = new Date(isoDateString);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function getState() {
    return (typeof window.getProfileState === 'function') ? window.getProfileState() : {};
  }

  function getHistory() {
    return (typeof window.getTradeHistory === 'function') ? window.getTradeHistory() : [];
  }

  function renderStatCards() {
    const grid = document.getElementById('dash-stat-grid');
    if (!grid) return;

    const state = getState();
    const history = getHistory();

    const balance = state.currentBalance;
    const totalTrades = history.length;
    const wins = history.filter(t => t.netResult > 0).length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : null;
    const netPnl = history.reduce((sum, t) => sum + t.netResult, 0);

    const netPnlClass = netPnl > 0 ? 'dash-stat-positive' : (netPnl < 0 ? 'dash-stat-negative' : '');
    const netPnlSign = netPnl > 0 ? '+' : (netPnl < 0 ? '-' : '');

    grid.innerHTML = `
      <div class="dash-stat-card">
        <div class="dash-stat-label">Current Balance</div>
        <div class="dash-stat-value">${balance !== null && balance !== undefined ? '₹' + fmt(balance) : '&mdash;'}</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-label">Win Rate</div>
        <div class="dash-stat-value">${winRate !== null ? winRate.toFixed(0) + '%' : '&mdash;'}</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-label">Total Trades</div>
        <div class="dash-stat-value">${totalTrades}</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-label">Net P&amp;L</div>
        <div class="dash-stat-value ${netPnlClass}">${totalTrades > 0 ? netPnlSign + '₹' + fmt(Math.abs(netPnl)) : '&mdash;'}</div>
      </div>
    `;
  }

  // Risk-rules-at-a-glance: pulls from window.getRiskSummary() in
  // app-shell.js, which is computed from the SAME tierRulesMatrix the Daily
  // Limits Tool enforces — never a separate, possibly-drifting set of
  // numbers. Hidden entirely if no profile/tier exists yet (shouldn't
  // normally happen since the Dashboard is only reachable after setup, but
  // safe regardless).
  function renderRiskRules() {
    const wrap = document.getElementById('dash-risk-wrap');
    const grid = document.getElementById('dash-risk-grid');
    const lotNote = document.getElementById('dash-risk-lot-note');
    if (!wrap || !grid) return;

    const summary = (typeof window.getRiskSummary === 'function') ? window.getRiskSummary() : null;
    if (!summary || summary.maxLossRupees === null) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');

    grid.innerHTML = `
      <div class="dash-risk-card">
        <div class="dash-risk-label">Capital Tier</div>
        <div class="dash-risk-value">${summary.tierLabel}</div>
      </div>
      <div class="dash-risk-card">
        <div class="dash-risk-label">Max Loss Today</div>
        <div class="dash-risk-value">₹${fmt(summary.maxLossRupees)}</div>
        <div class="dash-risk-sublabel">${summary.maxLossPct}% of capital</div>
      </div>
      <div class="dash-risk-card">
        <div class="dash-risk-label">Lots Allowed Right Now</div>
        <div class="dash-risk-value">${summary.maxLots}</div>
      </div>
      <div class="dash-risk-card">
        <div class="dash-risk-label">Max Trades / Day</div>
        <div class="dash-risk-value">2</div>
      </div>
    `;

    if (lotNote) {
      const progressRow = document.getElementById('dash-lot-progress-row');
      const progressFill = document.getElementById('dash-lot-progress-fill');
      if (summary.nextLotUnlock) {
        lotNote.innerHTML = `Reach ₹<strong>${fmt(summary.nextLotUnlock.requiredBalance)}</strong> to unlock ${summary.nextLotUnlock.nextLotCount} lots &mdash; ₹${fmt(summary.nextLotUnlock.remaining)} to go`;
        if (progressRow && progressFill) {
          const profile = (typeof window.getProfileState === 'function') ? window.getProfileState() : null;
          const currentBalance = profile ? profile.currentBalance : null;
          const requiredBalance = summary.nextLotUnlock.requiredBalance;
          let pct = 0;
          if (currentBalance !== null && requiredBalance > 0) {
            pct = Math.max(0, Math.min(100, (currentBalance / requiredBalance) * 100));
          }
          progressFill.style.width = `${pct}%`;
          progressRow.classList.remove('hidden');
        }
      } else {
        lotNote.innerText = `${summary.maxLots} lots is the highest currently configured for your account size.`;
        if (progressRow) progressRow.classList.add('hidden');
      }
    }
  }

  function renderRecentActivity() {
    const container = document.getElementById('dash-recent-area');
    if (!container) return;

    const history = getHistory();

    if (!history || history.length === 0) {
      container.innerHTML = '<div class="roadmap-empty-state">No trades logged yet. Head to the Daily Limits Tool to log your first trade.</div>';
      return;
    }

    // Sort by date (newest first), preserving submission order within a
    // date — same fix as the Daily Limits Tool's Trade Log, since raw
    // insertion order can diverge from date order once broker days get
    // imported out of chronological sequence.
    const rows = history
      .slice()
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (a.submittedAt || 0) < (b.submittedAt || 0) ? 1 : -1;
      })
      .slice(0, 5);

    let html = '<div class="calc-history-grid">';
    html += `
      <div class="calc-history-cell calc-history-head">Date</div>
      <div class="calc-history-cell calc-history-head num">Net Result</div>
      <div class="calc-history-cell calc-history-head num">Balance After</div>
    `;
    rows.forEach(entry => {
      const isWin = entry.netResult > 0;
      const sign = isWin ? '+' : (entry.netResult < 0 ? '-' : '');
      const resultClass = isWin ? 'calc-history-win' : (entry.netResult < 0 ? 'calc-history-loss' : '');
      html += `
        <div class="calc-history-cell">${formatDateShort(entry.date)}</div>
        <div class="calc-history-cell num ${resultClass}">${sign}₹${fmt(Math.abs(entry.netResult))}</div>
        <div class="calc-history-cell num">₹${fmt(entry.balanceAfter)}</div>
      `;
    });
    html += '</div>';

    container.innerHTML = html;
  }

  function render() {
    renderStatCards();
    renderRiskRules();
    renderRecentActivity();
  }

  window.renderDashboardHome = render;

  render();

})();
/* === END COMPONENT: dashboard-home (logic) === */