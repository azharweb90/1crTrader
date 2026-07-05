/* ===========================================================
   COMPONENT: roadmap / "Challenge" (logic)
   Displayed to the user as "Challenge" (see app-shell.js PAGE_TITLES
   and the sidebar label) — kept as the "roadmap" tab id/folder
   internally, same convention as "learn" being shown as "Knowledge
   Area". Rebuilt to match the Claude Design "Challenge" mockup:

     - Up to 3 money-target goals, each tracked from the day it was
       created (not from account balance — a goal is "make ₹X in
       profit", so progress = cumulative net result since the goal's
       start date, not the account's running balance).
     - Each goal gets its own card: name + Active/Achieved/Ended badge,
       days left, profit so far, a progress bar, three stat boxes
       (Target / Still Needed / Days Left), a day-by-day trade table
       scoped to that goal's window, and a "Your path" projection of
       the average win needed per trading day to hit the target in time.
   =========================================================== */
(function () {

  const MAX_GOALS = 3;
  const TRADING_DAYS_PER_MONTH = 22; // reference constant shown in the UI
  const MAX_TRADES_PER_DAY = 2; // matches the app-wide daily trade cap

  function getHistory() { return (typeof window.getTradeHistory  === 'function') ? window.getTradeHistory()  : []; }

  // ── State ──────────────────────────────────────────────────────────────
  let goals = []; // { id, name, target, date, setDate }
  let nextGoalId = 1;
  let editingGoalId = null; // null while creating a new goal

  function formatDate(iso) {
    return new Date(iso + (iso.length <= 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // History entries recorded since this goal's start date, oldest first.
  function goalHistory(goal) {
    const history = getHistory() || [];
    return history.filter(d => d.date >= goal.setDate).slice().sort((a, b) => a.date < b.date ? -1 : 1);
  }

  function computeGoalStats(goal) {
    const rows = goalHistory(goal);
    let running = 0;
    const rowsWithRunning = rows.map(r => {
      running += r.netResult;
      return { ...r, runningTotal: running };
    });
    const gained = rowsWithRunning.length ? rowsWithRunning[rowsWithRunning.length - 1].runningTotal : 0;

    const target = goal.target;
    const pct = target > 0 ? Math.min(100, Math.max(0, (gained / target) * 100)) : 0;
    const stillNeeded = Math.max(0, target - gained);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(goal.date + 'T00:00:00');
    const msLeft = end - today;
    const daysLeft = msLeft > 0 ? Math.ceil(msLeft / 86400000) : 0;

    const achieved = gained >= target && target > 0;
    const ended = !achieved && daysLeft <= 0;

    // ~5 trading days per 7 calendar days (Mon–Fri approximation).
    const tradingDaysLeft = daysLeft > 0 ? Math.max(1, Math.round(daysLeft * 5 / 7)) : 0;
    const avgWinPerTradingDay = tradingDaysLeft > 0 ? stillNeeded / tradingDaysLeft : 0;
    const perTrade = avgWinPerTradingDay / MAX_TRADES_PER_DAY;
    const tradesNeeded = perTrade > 0 ? Math.ceil(stillNeeded / perTrade) : 0;

    return {
      rowsNewestFirst: rowsWithRunning.slice().reverse(),
      gained, pct, stillNeeded, daysLeft, achieved, ended,
      tradingDaysLeft, avgWinPerTradingDay, perTrade, tradesNeeded,
    };
  }

  function statusBadge(stats) {
    if (stats.achieved) return '<span class="chal-status-pill chal-status-achieved">Achieved</span>';
    if (stats.ended)    return '<span class="chal-status-pill chal-status-ended">Ended</span>';
    return '<span class="chal-status-pill chal-status-active">Active</span>';
  }

  function renderGoalHistoryTable(stats) {
    if (stats.rowsNewestFirst.length === 0) {
      return '<div class="roadmap-empty-state">No trades logged yet since this goal started. Log a day on the Daily Limits Tool to see it here.</div>';
    }
    let html = '<div class="roadmap-history-grid">';
    html += `<div class="roadmap-history-cell roadmap-history-head">Date</div>
             <div class="roadmap-history-cell roadmap-history-head num">Net Result</div>
             <div class="roadmap-history-cell roadmap-history-head num">Balance After</div>`;
    stats.rowsNewestFirst.forEach(row => {
      const win = row.netResult > 0;
      const cls = win ? 'roadmap-history-win' : (row.netResult < 0 ? 'roadmap-history-loss' : '');
      const sign = win ? '+' : (row.netResult < 0 ? '-' : '');
      const runSign = row.runningTotal >= 0 ? '+' : '-';
      html += `<div class="roadmap-history-cell">${formatDate(row.date)}</div>
               <div class="roadmap-history-cell num ${cls}">${sign}₹${fmt(Math.abs(row.netResult))}</div>
               <div class="roadmap-history-cell num">${runSign}₹${fmt(Math.abs(row.runningTotal))}</div>`;
    });
    html += '</div>';
    return html;
  }

  function renderGoalCard(goal) {
    const stats = computeGoalStats(goal);
    const name = goal.name || `₹${fmt(goal.target)} Challenge`;
    const gainedSign = stats.gained >= 0 ? '+' : '−';

    const daysLeftBlock = stats.achieved
      ? `<span class="chal-days-num">🏁</span><span class="chal-days-label">Achieved</span>`
      : stats.ended
        ? `<span class="chal-days-num">🏁</span><span class="chal-days-label">Ended</span>`
        : `<span class="chal-days-num">${stats.daysLeft}</span><span class="chal-days-label">Days Left</span>`;

    return `
      <div class="chal-goal-card" data-goal-id="${goal.id}">
        <div class="chal-goal-top-row">
          <div>
            <div class="chal-goal-name-row">
              <span class="chal-goal-name">${name}</span>
              ${statusBadge(stats)}
            </div>
            <div class="chal-goal-dates">Started ${formatDate(goal.setDate)} · Target by ${formatDate(goal.date)}</div>
          </div>
          <div class="chal-days-left ${stats.achieved || stats.ended ? 'chal-days-done' : ''}">${daysLeftBlock}</div>
        </div>

        <div class="chal-profit-label">Profit So Far</div>
        <div class="chal-profit-value ${stats.gained < 0 ? 'chal-profit-negative' : ''}">${gainedSign}₹${fmt(Math.abs(stats.gained))}</div>

        <div class="chal-progress-labels">
          <span>${stats.pct.toFixed(0)}% of target</span>
          <span>₹${fmt(goal.target)} target</span>
        </div>
        <div class="chal-progress-track">
          <div class="chal-progress-fill" style="width:${stats.pct.toFixed(1)}%"></div>
        </div>

        <div class="rm-challenge-stats-grid" style="margin-top:18px;">
          <div class="rm-challenge-stat">
            <div class="rm-challenge-stat-label">Target</div>
            <div class="rm-challenge-stat-value">₹${fmt(goal.target)}</div>
          </div>
          <div class="rm-challenge-stat">
            <div class="rm-challenge-stat-label">Still Needed</div>
            <div class="rm-challenge-stat-value">₹${fmt(stats.stillNeeded)}</div>
          </div>
          <div class="rm-challenge-stat">
            <div class="rm-challenge-stat-label">Days Left</div>
            <div class="rm-challenge-stat-value">${stats.daysLeft}</div>
          </div>
        </div>

        <div class="chal-section-label">Day by Day</div>
        ${renderGoalHistoryTable(stats)}

        ${stats.stillNeeded > 0 && !stats.ended ? `
          <div class="chal-path-divider"></div>
          <div class="chal-section-label">Your Path</div>
          <p class="section-note" style="margin-bottom:14px;">To reach the ₹${fmt(goal.target)} target in about ${stats.daysLeft} day${stats.daysLeft === 1 ? '' : 's'} (${stats.tradingDaysLeft} trading day${stats.tradingDaysLeft === 1 ? '' : 's'}), here's the average you'd need to win.</p>

          <div class="chal-path-highlight">
            <div class="rm-challenge-stat-label">Average Win Needed Per Trading Day</div>
            <div class="chal-path-highlight-value">₹${fmt(stats.avgWinPerTradingDay)}</div>
          </div>

          <div class="rm-challenge-stats-grid" style="margin-top:12px;">
            <div class="rm-challenge-stat">
              <div class="rm-challenge-stat-label">Per Trade (${MAX_TRADES_PER_DAY}/day)</div>
              <div class="rm-challenge-stat-value">₹${fmt(stats.perTrade)}</div>
            </div>
            <div class="rm-challenge-stat">
              <div class="rm-challenge-stat-label">Trading Days / Month</div>
              <div class="rm-challenge-stat-value">${TRADING_DAYS_PER_MONTH}</div>
            </div>
            <div class="rm-challenge-stat">
              <div class="rm-challenge-stat-label">Trades at ₹${fmt(stats.perTrade)} Avg Win</div>
              <div class="rm-challenge-stat-value">${stats.tradesNeeded}</div>
            </div>
          </div>
          <p class="foot-note" style="margin-top:10px;">At your ₹${fmt(stats.perTrade)} average win, that's about ${stats.tradesNeeded} winning trades to make ₹${fmt(goal.target)}. You have ${stats.daysLeft} day${stats.daysLeft === 1 ? '' : 's'} left.</p>
        ` : ''}

        <div class="chal-goal-footer">
          <button type="button" class="setup-manual-link" style="font-size:12.5px; color:#2563EB;" onclick="openChallengeModal('${goal.id}')">Edit goal</button>
          <button type="button" class="setup-manual-link" style="font-size:12.5px; color:#C53D22; margin-left:16px;" onclick="removeGoal('${goal.id}')">Remove</button>
        </div>
      </div>
    `;
  }

  function renderGoals() {
    const area = document.getElementById('chal-goals-area');
    const subtitle = document.getElementById('chal-subtitle');
    const createBtn = document.getElementById('chal-create-btn');
    if (subtitle) subtitle.innerText = `${goals.length} of ${MAX_GOALS} goals — track a single goal or up to ${MAX_GOALS}.`;
    if (createBtn) createBtn.disabled = goals.length >= MAX_GOALS;
    if (!area) return;

    if (goals.length === 0) {
      area.innerHTML = `
        <div class="chal-empty-state">
          <div class="chal-empty-icon">🎯</div>
          <div class="chal-empty-text">No goal set yet. Create a money target with a deadline and track your daily progress toward it here.</div>
        </div>
      `;
      return;
    }
    area.innerHTML = goals.map(renderGoalCard).join('');
  }

  // ── Create / Edit / Remove ──────────────────────────────────────────────
  function openChallengeModal(goalId) {
    const overlay = document.getElementById('rm-challenge-modal-overlay');
    if (!overlay) return;
    editingGoalId = goalId || null;

    const titleEl = document.getElementById('rm-modal-title-text');
    const nameEl  = document.getElementById('rm-ch-name');
    const targetEl = document.getElementById('rm-ch-target');
    const dateEl  = document.getElementById('rm-ch-date');

    if (editingGoalId) {
      const goal = goals.find(g => g.id === editingGoalId);
      if (!goal) { editingGoalId = null; }
      else {
        if (titleEl) titleEl.innerText = 'Edit goal';
        if (nameEl) nameEl.value = goal.name || '';
        if (targetEl) targetEl.value = goal.target;
        if (dateEl) dateEl.value = goal.date;
      }
    }
    if (!editingGoalId) {
      if (titleEl) titleEl.innerText = 'Create a goal';
      if (nameEl) nameEl.value = '';
      if (targetEl) targetEl.value = '';
      if (dateEl) dateEl.value = '';
    }
    overlay.classList.remove('hidden');
  }

  function closeChallengeModal() {
    const overlay = document.getElementById('rm-challenge-modal-overlay');
    if (overlay) overlay.classList.add('hidden');
    editingGoalId = null;
  }

  function closeChallengeModalIfOutside(e) {
    if (e.target === document.getElementById('rm-challenge-modal-overlay')) closeChallengeModal();
  }

  function saveChallengeModal() {
    const target = parseInt(document.getElementById('rm-ch-target').value, 10);
    const date   = document.getElementById('rm-ch-date').value;
    const name   = document.getElementById('rm-ch-name').value.trim();
    if (!target || target <= 0 || !date) {
      alert('Please enter a valid target amount and date.');
      return;
    }

    if (editingGoalId) {
      const goal = goals.find(g => g.id === editingGoalId);
      if (goal) { goal.target = target; goal.date = date; goal.name = name; }
    } else {
      if (goals.length >= MAX_GOALS) { closeChallengeModal(); return; }
      goals.push({
        id: 'g' + (nextGoalId++),
        name, target, date,
        setDate: new Date().toISOString().slice(0, 10),
      });
    }
    closeChallengeModal();
    renderGoals();
  }

  function removeGoal(goalId) {
    goals = goals.filter(g => g.id !== goalId);
    renderGoals();
  }

  // ── Top-level render ───────────────────────────────────────────────────
  function render() {
    renderGoals();
  }

  // ── Expose ─────────────────────────────────────────────────────────────
  window.openChallengeModal       = openChallengeModal;
  window.closeChallengeModal      = closeChallengeModal;
  window.closeChallengeModalIfOutside = closeChallengeModalIfOutside;
  window.saveChallengeModal       = saveChallengeModal;
  window.removeGoal               = removeGoal;
  window.renderRoadmap            = render;

  render();
})();