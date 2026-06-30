/* ===========================================================
   COMPONENT: roadmap (logic)
   Loaded lazily by dashboard.js the first time this tab opens.
   Reads global profile state (balance, tier) and trade history
   via window.getProfileState() / window.getTradeHistory(),
   both exposed by dashboard.js.
   =========================================================== */

(function () {

  const TIER_ORDER = ['small', 'medium', 'large', 'pro'];

  const TIER_MIN = {
    small: 25000,
    medium: 100000,
    large: 500000,
    pro: 1000000,
  };

  const TIER_MAX = {
    small: 75000,
    medium: 500000,
    large: 1000000,
    pro: 2000000,
  };

  const TIER_LABELS = {
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
    pro: 'Pro',
  };

  // Representative max daily loss per tier, used as the assumed size of a
  // losing trade in the Goal Tracker's expected-value math. Reads the
  // trader's tier's LOWEST sub-level (e.g. "small-1") from the same
  // tierRulesMatrix dashboard.js and calculator.js use — not a separate
  // hardcoded copy, which had drifted out of sync with the real numbers
  // more than once. A conservative (smaller, less punishing) estimate.
  const tierRulesMatrix = window.tierRulesMatrix || {};

  function tierLossEstimate(tier) {
    const rule = tierRulesMatrix[`${tier}-1`] || tierRulesMatrix['small-1'];
    return rule ? rule.loss : 1750;
  }

  let avgWinManualValue = null; // user-entered fallback when no trade history exists yet
  let selectedGoalAmount = null; // rupees, chosen from the Goal Tracker buttons

  function fmt(n) {
    return Math.round(n).toLocaleString('en-IN');
  }

  function getState() {
    return (typeof window.getProfileState === 'function') ? window.getProfileState() : {};
  }

  function getHistory() {
    return (typeof window.getTradeHistory === 'function') ? window.getTradeHistory() : [];
  }

  // Determine which tier bucket a given balance currently falls in.
  // Balances beyond Pro's max still count as "pro" (top of the ladder).
  function tierForBalance(balance) {
    for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
      const t = TIER_ORDER[i];
      if (balance >= TIER_MIN[t]) return t;
    }
    return 'small';
  }

  function onRoadmapAvgWinInput() {
    const input = document.getElementById('roadmap-avg-win-input');
    const val = parseFloat(input.value);
    avgWinManualValue = (isNaN(val) || val <= 0) ? null : val;
    render();
  }

  function selectGoalAmount(amount) {
    selectedGoalAmount = amount;
    document.querySelectorAll('.goal-amount-btn').forEach(btn => {
      btn.classList.toggle('selected', parseInt(btn.dataset.goal, 10) === amount);
    });
    renderGoalTracker();
  }

  function renderGoalTracker() {
    const container = document.getElementById('goal-result-area');
    if (!container) return;

    if (selectedGoalAmount === null) {
      container.innerHTML = '';
      return;
    }

    const state = getState();
    const balance = state.currentBalance;
    const tier = state.tier;

    if (balance === null || balance === undefined) {
      container.innerHTML = '<div class="roadmap-empty-state">Complete your profile setup to use the goal tracker.</div>';
      return;
    }

    const gap = selectedGoalAmount - balance;
    if (gap <= 0) {
      container.innerHTML = `
        <div class="goal-result-card">
          <div class="goal-result-headline">🎉 You've already reached this goal — ₹${fmt(selectedGoalAmount)}!</div>
        </div>
      `;
      return;
    }

    const actual = computeActualStats();
    const usingActual = actual.hasHistory && actual.avgWin !== null && actual.winRate !== null;
    const avgWin = usingActual ? actual.avgWin : avgWinManualValue;
    const winRate = usingActual ? actual.winRate : (avgWinManualValue !== null ? 1 : null);
    const avgLoss = tierLossEstimate(tier);

    if (avgWin === null || avgWin <= 0 || winRate === null) {
      container.innerHTML = '<div class="roadmap-empty-state">Enter an average winning-trade amount above to see how many trades and days this goal will take.</div>';
      return;
    }

    // Expected net result per trade, accounting for both wins and losses at
    // the given win rate: winRate * avgWin - (1 - winRate) * avgLoss.
    const expectedNetPerTrade = (winRate * avgWin) - ((1 - winRate) * avgLoss);

    if (expectedNetPerTrade <= 0) {
      // Even when the current pace is unfavorable, still show what's
      // happening rather than hiding the projection — the trades/days
      // figure is honestly "not reachable at this pace," but the breakeven
      // win rate gives a concrete, useful target to aim for.
      const breakevenWinRate = avgWin + avgLoss > 0 ? (avgLoss / (avgWin + avgLoss)) : null;

      container.innerHTML = `
        <div class="goal-result-card">
          <div class="goal-result-headline">To reach ₹${fmt(selectedGoalAmount)}, here's what it takes at your current pace:</div>
          <div class="goal-result-grid">
            <div>
              <div class="goal-result-stat-label">Trades Needed</div>
              <div class="goal-result-stat-value">Not reachable at this pace</div>
            </div>
            <div>
              <div class="goal-result-stat-label">Days Needed</div>
              <div class="goal-result-stat-value">&mdash;</div>
            </div>
            <div>
              <div class="goal-result-stat-label">Win Rate Used</div>
              <div class="goal-result-stat-value">${(winRate * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div class="goal-result-stat-label">Gap To Goal</div>
              <div class="goal-result-stat-value">₹${fmt(gap)}</div>
            </div>
          </div>
          <div class="goal-result-note">
            At a ${(winRate * 100).toFixed(0)}% win rate, your average win of ₹${fmt(avgWin)} against a typical loss of ₹${fmt(avgLoss)} means each trade loses ₹${fmt(Math.abs(expectedNetPerTrade))} on average — so more trades at this exact pace move you further from the goal, not closer.
            ${breakevenWinRate !== null
              ? ` Markets are sideways or choppy often, so a string of losing days doesn't mean you're doing something wrong — but mathematically, you'd need at least a ${(breakevenWinRate * 100).toFixed(1)}% win rate at this win/loss size just to break even, and higher than that to make real progress. Raising your win rate, improving your reward-to-risk (winning more per trade relative to what you risk), or both, are the two levers that change this.`
              : ''}
          </div>
        </div>
      `;
      return;
    }

    const tradesNeeded = Math.ceil(gap / expectedNetPerTrade);
    const daysNeeded = Math.ceil(tradesNeeded / 2); // max 2 trades/day, the hard rule
    const years = daysNeeded / 365;
    const yearsLabel = years >= 1 ? `(~${years.toFixed(1)} years)` : '';

    container.innerHTML = `
      <div class="goal-result-card">
        <div class="goal-result-headline">To reach ₹${fmt(selectedGoalAmount)}, here's what it takes at your current pace:</div>
        <div class="goal-result-grid">
          <div>
            <div class="goal-result-stat-label">Trades Needed</div>
            <div class="goal-result-stat-value">${fmt(tradesNeeded)}</div>
          </div>
          <div>
            <div class="goal-result-stat-label">Days Needed</div>
            <div class="goal-result-stat-value">${fmt(daysNeeded)} ${yearsLabel}</div>
          </div>
          <div>
            <div class="goal-result-stat-label">Win Rate Used</div>
            <div class="goal-result-stat-value">${(winRate * 100).toFixed(0)}%</div>
          </div>
          <div>
            <div class="goal-result-stat-label">Gap To Goal</div>
            <div class="goal-result-stat-value">₹${fmt(gap)}</div>
          </div>
        </div>
        <div class="goal-result-note">
          ${usingActual
            ? `Based on your actual logged trades (${actual.sampleSize} day${actual.sampleSize === 1 ? '' : 's'} so far) — win rate ${(winRate * 100).toFixed(0)}%, average win ₹${fmt(avgWin)}, assumed average loss ₹${fmt(avgLoss)} per losing trade.`
            : `Based on the average win you entered above, assuming every trade wins (no logged history yet to measure a real win rate).`
          } Keep your win rate at or above ${(winRate * 100).toFixed(0)}% to stay on this pace — slipping below it will need more trades to reach the same goal.
        </div>
      </div>
    `;
  }

  // Actual win rate / average win amount, computed from logged trade history.
  // Returns null fields if there isn't enough history yet (falls back to manual input).
  function computeActualStats() {
    const history = getHistory();
    if (!history || history.length === 0) {
      return { hasHistory: false, avgWin: null, winRate: null, sampleSize: 0 };
    }

    const wins = history.filter(day => day.netResult > 0);
    const avgWin = wins.length > 0
      ? wins.reduce((sum, d) => sum + d.netResult, 0) / wins.length
      : null;
    const winRate = history.length > 0 ? (wins.length / history.length) : null;

    return {
      hasHistory: true,
      avgWin: avgWin,
      winRate: winRate,
      sampleSize: history.length,
    };
  }

  function formatDate(isoString) {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function renderHistory() {
    const container = document.getElementById('roadmap-history-area');
    if (!container) return;

    const history = getHistory();

    if (!history || history.length === 0) {
      container.innerHTML = '<div class="roadmap-empty-state">No days submitted yet. Log and submit a day on the Daily Limits Tool to see it here.</div>';
      return;
    }

    // Most recent first
    const rows = history.slice().reverse();

    let html = '<div class="roadmap-history-grid">';
    html += `
      <div class="roadmap-history-cell roadmap-history-head">Date</div>
      <div class="roadmap-history-cell roadmap-history-head num">Net Result</div>
      <div class="roadmap-history-cell roadmap-history-head num">Balance After</div>
    `;

    rows.forEach(day => {
      const isWin = day.netResult > 0;
      const sign = isWin ? '+' : (day.netResult < 0 ? '-' : '');
      const resultClass = isWin ? 'roadmap-history-win' : (day.netResult < 0 ? 'roadmap-history-loss' : '');
      html += `
        <div class="roadmap-history-cell">${formatDate(day.date)}</div>
        <div class="roadmap-history-cell num ${resultClass}">${sign}₹${fmt(Math.abs(day.netResult))}</div>
        <div class="roadmap-history-cell num">₹${fmt(day.balanceAfter)}</div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;
  }

  function render() {
    renderHistory();
    renderGoalTracker();

    const state = getState();
    const balance = state.currentBalance;
    const container = document.getElementById('roadmap-projection-area');
    if (!container) return;

    if (balance === null || balance === undefined) {
      container.innerHTML = '<div class="roadmap-empty-state">Complete your profile setup with a starting capital to see your roadmap.</div>';
      return;
    }

    const balanceValueEl = document.getElementById('roadmap-balance-value');
    const balanceSubEl = document.getElementById('roadmap-balance-sub');
    if (balanceValueEl) balanceValueEl.innerText = `₹${fmt(balance)}`;

    const currentTier = tierForBalance(balance);
    const currentTierIndex = TIER_ORDER.indexOf(currentTier);
    const nextTier = TIER_ORDER[currentTierIndex + 1];

    // Update the stage track
    TIER_ORDER.forEach((t, i) => {
      const stageEl = document.querySelector(`.roadmap-stage[data-stage="${t}"]`);
      if (!stageEl) return;
      stageEl.classList.remove('reached', 'current');
      if (i < currentTierIndex) stageEl.classList.add('reached');
      if (i === currentTierIndex) stageEl.classList.add('current');
    });

    if (!nextTier) {
      // Already at the top tier (Pro)
      if (balanceSubEl) balanceSubEl.innerText = `You're in the Pro tier — the top of the ladder.`;
      container.innerHTML = '<div class="roadmap-empty-state">You\'ve reached the Pro tier. There\'s no higher tier to project toward right now.</div>';
      return;
    }

    const gap = TIER_MIN[nextTier] - balance;
    if (balanceSubEl) {
      balanceSubEl.innerText = gap > 0
        ? `₹${fmt(gap)} away from the ${TIER_LABELS[nextTier]} tier (₹${fmt(TIER_MIN[nextTier])})`
        : `You've already crossed into the ${TIER_LABELS[nextTier]} tier range.`;
    }

    const actual = computeActualStats();
    const usingActual = actual.hasHistory && actual.avgWin !== null;
    const avgWin = usingActual ? actual.avgWin : avgWinManualValue;

    let html = '';

    if (avgWin === null || avgWin <= 0) {
      html = '<div class="roadmap-empty-state">Enter an average winning-trade amount above to see your projection.</div>';
      container.innerHTML = html;
      return;
    }

    const tradesNeeded = gap > 0 ? Math.ceil(gap / avgWin) : 0;
    const winRatePct = actual.winRate !== null ? (actual.winRate * 100).toFixed(0) + '%' : '—';

    html += '<div class="roadmap-projection-grid">';
    html += `
      <div class="roadmap-stat">
        <div class="roadmap-stat-label">Avg. Win Used</div>
        <div class="roadmap-stat-value">₹${fmt(avgWin)}</div>
      </div>
      <div class="roadmap-stat">
        <div class="roadmap-stat-label">Trades Needed</div>
        <div class="roadmap-stat-value">${tradesNeeded}</div>
      </div>
      <div class="roadmap-stat">
        <div class="roadmap-stat-label">Actual Win Rate</div>
        <div class="roadmap-stat-value">${winRatePct}</div>
      </div>
      <div class="roadmap-stat">
        <div class="roadmap-stat-label">Days Logged</div>
        <div class="roadmap-stat-value">${actual.sampleSize}</div>
      </div>
    `;
    html += '</div>';

    html += `<p class="foot-note" style="margin-top:16px;">${
      usingActual
        ? `Based on your actual logged trades (${actual.sampleSize} day${actual.sampleSize === 1 ? '' : 's'} so far).`
        : `Based on the average win amount you entered above — no logged trade history yet.`
    }</p>`;

    container.innerHTML = html;
  }

  window.onRoadmapAvgWinInput = onRoadmapAvgWinInput;
  window.selectGoalAmount = selectGoalAmount;
  window.renderRoadmap = render; // dashboard.js calls this when the tab is shown/refreshed

  render();

})();
/* === END COMPONENT: roadmap (logic) === */