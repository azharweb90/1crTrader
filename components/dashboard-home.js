/* ===========================================================
   COMPONENT: dashboard-home (logic)
   Loaded lazily by dashboard.js the first time the Dashboard tab opens.

   Shows 4 key stat cards (Balance, Win Rate, Total Trades, Net P&L),
   quick-link shortcuts to the other sections, and a short recent-activity
   list pulled from the same trade history used everywhere else.
   =========================================================== */

(function () {

  function fmt(n) {
    return Math.round(n).toLocaleString('en-IN');
  }

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
        <div class="dash-stat-value">${balance !== null && balance !== undefined ? 'Rs. ' + fmt(balance) : '&mdash;'}</div>
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
        <div class="dash-stat-value ${netPnlClass}">${totalTrades > 0 ? netPnlSign + 'Rs. ' + fmt(Math.abs(netPnl)) : '&mdash;'}</div>
      </div>
    `;
  }

  function renderRecentActivity() {
    const container = document.getElementById('dash-recent-area');
    if (!container) return;

    const history = getHistory();

    if (!history || history.length === 0) {
      container.innerHTML = '<div class="roadmap-empty-state">No trades logged yet. Head to the Daily Limits Tool to log your first trade.</div>';
      return;
    }

    const rows = history.slice().reverse().slice(0, 5);

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
        <div class="calc-history-cell num ${resultClass}">${sign}Rs. ${fmt(Math.abs(entry.netResult))}</div>
        <div class="calc-history-cell num">Rs. ${fmt(entry.balanceAfter)}</div>
      `;
    });
    html += '</div>';

    container.innerHTML = html;
  }

  function render() {
    renderStatCards();
    renderRecentActivity();
  }

  window.renderDashboardHome = render;

  render();

})();
/* === END COMPONENT: dashboard-home (logic) === */
