/* ===========================================================
   COMPONENT: roadmap (rebuilt)
   Three sections:
   1. Current position (balance card + tier track)
   2. Goal Simulator — slider goal picker + "What-If" sliders
      when current pace is "Not Reachable"
   3. Personal Challenge — set a target amount + date,
      track daily progress toward it
   =========================================================== */
(function () {

  const TIER_ORDER  = ['small', 'medium', 'large', 'pro'];
  const TIER_MIN    = { small: 25000, medium: 100000, large: 500000, pro: 1000000 };
  const TIER_LABELS = { small: 'Small', medium: 'Medium', large: 'Large', pro: 'Pro' };
  const tierRulesMatrix = window.tierRulesMatrix || {};

  function tierLossEstimate(tier) {
    const rule = tierRulesMatrix[`${tier}-1`] || tierRulesMatrix['small-1'];
    return rule ? rule.loss : 1750;
  }

  // fmt() now shared — see /src/app/shared/utils/formatters.js
  function getState()   { return (typeof window.getProfileState  === 'function') ? window.getProfileState()  : {}; }
  function getHistory() { return (typeof window.getTradeHistory  === 'function') ? window.getTradeHistory()  : []; }

  // ── State ──────────────────────────────────────────────────────────────
  let avgWinManualValue = null;
  let selectedGoalAmount = 5000000; // used only in 'custom' goal mode
  let goalMode = 'tier'; // 'tier' (default — next tier up) | 'custom' (slider amount)
  let challenge = null; // { name, target, date, setDate, startDate, startBalance, trackingStarted } or null
  let challengeStartMode = 'today'; // 'today' | 'later' — modal-only UI state
  // Simulator overrides — null means "use actual"
  let simWinRateOverride = null;
  let simAvgWinOverride  = null;
  let simActive = false; // true when user is adjusting the "what-if" sliders

  function tierForBalance(balance) {
    for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
      if (balance >= TIER_MIN[TIER_ORDER[i]]) return TIER_ORDER[i];
    }
    return 'small';
  }

  // Keeps a range input's filled-vs-track color split in sync with its
  // actual value (blue up to the thumb, light gray the rest of the way)
  // — .rm-goal-slider's CSS only paints a static background, so this
  // has to run any time a slider's value changes, including when it's
  // set programmatically (custom-amount input, manual avg-win input).
  function updateSliderFill(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const min = parseFloat(el.min) || 0;
    const max = parseFloat(el.max) || 100;
    const val = parseFloat(el.value);
    const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
    el.style.background = `linear-gradient(to right, #2563EB 0%, #2563EB ${pct}%, #E3E9F1 ${pct}%)`;
  }

  // ── Goal Slider ────────────────────────────────────────────────────────
  function onRoadmapSliderInput(value) {
    selectedGoalAmount = parseInt(value, 10);
    const customInput = document.getElementById('rm-goal-custom-input');
    if (customInput) customInput.value = selectedGoalAmount;
    updateGoalDisplay();
    updateSliderFill('rm-goal-slider');
    resetSimulator();
    renderSimulatorSection();
  }

  function onRoadmapGoalCustomInput(value) {
    const v = parseInt(value, 10);
    if (isNaN(v) || v <= 0) return;
    selectedGoalAmount = v;
    // Clamp slider
    const slider = document.getElementById('rm-goal-slider');
    if (slider) {
      const clamped = Math.max(1000000, Math.min(10000000, v));
      slider.value = clamped;
    }
    updateGoalDisplay();
    updateSliderFill('rm-goal-slider');
    resetSimulator();
    renderSimulatorSection();
  }

  function updateGoalDisplay() {
    const el = document.getElementById('rm-goal-display');
    if (el) el.innerText = `₹${fmt(selectedGoalAmount)}`;
  }

  // ── Average win input (manual, shown when no history) ─────────────────
  function onRoadmapAvgWinInput() {
    const input = document.getElementById('roadmap-avg-win-input');
    const val = parseFloat(input.value);
    avgWinManualValue = (isNaN(val) || val <= 0) ? null : val;
    // When user types here, also seed the simulator avg-win slider
    if (avgWinManualValue) {
      const simSlider = document.getElementById('rm-sim-avgwin');
      if (simSlider) {
        simSlider.value = Math.min(20000, Math.max(500, avgWinManualValue));
        document.getElementById('rm-sim-avgwin-val').innerText = `₹${fmt(avgWinManualValue)}`;
        updateSliderFill('rm-sim-avgwin');
      }
    }
    resetSimulator();
    renderSimulatorSection();
  }

  // ── Simulator sliders ──────────────────────────────────────────────────
  function onSimulatorInput() {
    simActive = true;
    const wrEl  = document.getElementById('rm-sim-winrate');
    const awEl  = document.getElementById('rm-sim-avgwin');
    const wrVal = document.getElementById('rm-sim-winrate-val');
    const awVal = document.getElementById('rm-sim-avgwin-val');
    if (!wrEl || !awEl) return;

    simWinRateOverride = parseInt(wrEl.value, 10) / 100;
    simAvgWinOverride  = parseInt(awEl.value,  10);

    if (wrVal) wrVal.innerText = `${(simWinRateOverride * 100).toFixed(0)}%`;
    if (awVal) awVal.innerText = `₹${fmt(simAvgWinOverride)}`;
    updateSliderFill('rm-sim-winrate');
    updateSliderFill('rm-sim-avgwin');
    renderGoalResult();
  }

  function resetSimulator() {
    simActive = false;
    simWinRateOverride = null;
    simAvgWinOverride  = null;
  }

  function computeActualStats() {
    const history = getHistory();
    if (!history || history.length === 0) return { hasHistory: false, avgWin: null, winRate: null, sampleSize: 0 };
    const wins = history.filter(d => d.netResult > 0);
    return {
      hasHistory: true,
      avgWin:  wins.length > 0 ? wins.reduce((s, d) => s + d.netResult, 0) / wins.length : null,
      winRate: history.length > 0 ? wins.length / history.length : null,
      sampleSize: history.length,
    };
  }

  // ── Render simulator section ───────────────────────────────────────────
  function renderSimulatorSection() {
    renderProjectionStats();
    renderGoalResult();
  }

  function renderProjectionStats() {
    const container = document.getElementById('roadmap-projection-area');
    if (!container) return;

    const state   = getState();
    const balance = state.currentBalance;
    if (balance === null || balance === undefined) {
      container.innerHTML = '<div class="roadmap-empty-state">Complete your profile setup to see your roadmap.</div>';
      return;
    }

    const actual  = computeActualStats();
    const avgWinEl = document.getElementById('rm-avg-win-wrap');

    if (!actual.hasHistory) {
      // No history — show the manual avg-win input
      if (avgWinEl) avgWinEl.classList.remove('hidden');
    } else {
      if (avgWinEl) avgWinEl.classList.add('hidden');
    }

    const usingActual = actual.hasHistory && actual.avgWin !== null;
    const avgWin  = usingActual ? actual.avgWin : avgWinManualValue;
    const winRate = usingActual ? actual.winRate : (avgWinManualValue !== null ? 1.0 : null);

    if (avgWin === null) { container.innerHTML = ''; return; }

    const tier    = tierForBalance(balance);
    const nextTierIdx = TIER_ORDER.indexOf(tier) + 1;
    const nextTier    = TIER_ORDER[nextTierIdx] || null;
    const gapToNext   = nextTier ? Math.max(0, TIER_MIN[nextTier] - balance) : 0;
    const tradesNext  = gapToNext > 0 && avgWin > 0 ? Math.ceil(gapToNext / avgWin) : 0;
    const winRateLabel = winRate !== null ? `${(winRate * 100).toFixed(0)}%` : '—';

    container.innerHTML = `
      <div class="roadmap-projection-grid" style="margin-top:16px;">
        <div class="roadmap-stat">
          <div class="roadmap-stat-label">Avg. Win Used</div>
          <div class="roadmap-stat-value">₹${fmt(avgWin)}</div>
        </div>
        <div class="roadmap-stat">
          <div class="roadmap-stat-label">Trades to Next Tier</div>
          <div class="roadmap-stat-value">${tradesNext || '—'}</div>
        </div>
        <div class="roadmap-stat">
          <div class="roadmap-stat-label">Actual Win Rate</div>
          <div class="roadmap-stat-value">${winRateLabel}</div>
        </div>
        <div class="roadmap-stat">
          <div class="roadmap-stat-label">Days Logged</div>
          <div class="roadmap-stat-value">${actual.sampleSize}</div>
        </div>
      </div>
      <p class="foot-note" style="margin-top:12px; padding:0 2px;">${
        usingActual
          ? `Based on your actual logged trades (${actual.sampleSize} day${actual.sampleSize === 1 ? '' : 's'} so far).`
          : 'Based on the average win you entered above — no logged history yet.'
      }</p>
    `;
  }

  function renderGoalResult() {
    const statusEl    = document.getElementById('rm-simulator-status');
    const simControls = document.getElementById('rm-sim-controls');
    const resultEl    = document.getElementById('goal-result-area');
    if (!statusEl || !simControls || !resultEl) return;

    const state   = getState();
    const balance = state.currentBalance;
    const tier    = tierForBalance(balance || 0);
    if (balance === null || balance === undefined) { resultEl.innerHTML = ''; statusEl.innerHTML = ''; return; }

    const goal = selectedGoalAmount;
    const gap  = goal - balance;
    if (gap <= 0) {
      statusEl.innerHTML = `<div class="rm-status-badge rm-status-reached">🎉 You've already reached ₹${fmt(goal)}!</div>`;
      simControls.classList.add('hidden');
      resultEl.innerHTML = '';
      return;
    }

    const actual      = computeActualStats();
    const usingActual = actual.hasHistory && actual.avgWin !== null && actual.winRate !== null;

    // Use simulator overrides if active, else actual/manual
    const avgWin  = simActive && simAvgWinOverride  !== null ? simAvgWinOverride  : (usingActual ? actual.avgWin  : avgWinManualValue);
    const winRate = simActive && simWinRateOverride !== null ? simWinRateOverride : (usingActual ? actual.winRate : (avgWinManualValue !== null ? 1 : null));

    if (avgWin === null || winRate === null) {
      statusEl.innerHTML = '';
      simControls.classList.add('hidden');
      resultEl.innerHTML = '<div class="roadmap-empty-state">Enter your average winning-trade amount above to see the goal projection.</div>';
      return;
    }

    const avgLoss = tierLossEstimate(tier);
    const expectedNet = (winRate * avgWin) - ((1 - winRate) * avgLoss);
    const notReachable = expectedNet <= 0;

    // Seed simulator sliders if not yet active
    if (!simActive) {
      const wrSlider = document.getElementById('rm-sim-winrate');
      const awSlider = document.getElementById('rm-sim-avgwin');
      const wrVal    = document.getElementById('rm-sim-winrate-val');
      const awVal    = document.getElementById('rm-sim-avgwin-val');
      if (wrSlider) { wrSlider.value = Math.round((winRate || 0.5) * 100); if (wrVal) wrVal.innerText = `${Math.round((winRate || 0.5) * 100)}%`; }
      if (awSlider) { awSlider.value = Math.min(20000, Math.max(500, Math.round(avgWin || 2500))); if (awVal) awVal.innerText = `₹${fmt(avgWin || 2500)}`; }
    }

    if (notReachable) {
      // Show the simulator controls so user can find a path
      simControls.classList.remove('hidden');
      const breakeven = avgWin + avgLoss > 0 ? (avgLoss / (avgWin + avgLoss)) : null;

      statusEl.innerHTML = `
        <div class="rm-status-badge rm-status-warning">
          ⚠ At your current pace (${(winRate * 100).toFixed(0)}% win rate), this goal is <strong>not reachable</strong>.
          Each trade loses ₹${fmt(Math.abs(expectedNet))} on average.
          ${breakeven ? `You need at least a ${(breakeven * 100).toFixed(1)}% win rate to break even.` : ''}
          Simulate changes below to find a path.
        </div>
      `;
      // Show what the simulated pace achieves (for the what-if sliders)
      if (simActive) {
        if (expectedNet > 0) {
          const trades = Math.ceil(gap / expectedNet);
          const days   = Math.ceil(trades / 2);
          resultEl.innerHTML = renderGoalCards({ trades, days, winRate, gap, avgWin, simActive, reachable: true });
        } else {
          resultEl.innerHTML = renderGoalCards({ trades: null, days: null, winRate, gap, avgWin, simActive, reachable: false });
        }
      } else {
        resultEl.innerHTML = '';
      }
    } else {
      // Reachable — hide simulator, show clean metrics
      simControls.classList.add('hidden');
      const isSimulated = simActive;
      const trades = Math.ceil(gap / expectedNet);
      const days   = Math.ceil(trades / 2);

      statusEl.innerHTML = isSimulated
        ? `<div class="rm-status-badge rm-status-reached">✓ Reachable at simulated pace — ${(winRate*100).toFixed(0)}% win rate, ₹${fmt(avgWin)} avg win</div>`
        : `<div class="rm-status-badge rm-status-ok">✓ Reachable at your current pace</div>`;

      resultEl.innerHTML = renderGoalCards({ trades, days, winRate, gap, avgWin, simActive, reachable: true });
    }
  }

  function renderGoalCards({ trades, days, winRate, gap, avgWin, simActive, reachable }) {
    const yearsLabel = days && days / 365 >= 1 ? ` (~${(days / 365).toFixed(1)} yrs)` : '';
    return `
      <div class="rm-goal-metrics-grid" style="margin-top:18px;">
        <div class="rm-metric-card">
          <div class="rm-metric-label">Trades Needed</div>
          <div class="rm-metric-value ${!reachable ? 'rm-metric-warn' : ''}">${trades ? fmt(trades) : '—'}</div>
          <div class="rm-metric-sub">${simActive ? 'At simulated pace' : 'At current pace'}</div>
        </div>
        <div class="rm-metric-card">
          <div class="rm-metric-label">Est. Days</div>
          <div class="rm-metric-value">${days ? `${fmt(days)}${yearsLabel}` : '—'}</div>
          <div class="rm-metric-sub">Based on 2 trades/day max</div>
        </div>
        <div class="rm-metric-card">
          <div class="rm-metric-label">Win Rate Used</div>
          <div class="rm-metric-value">${(winRate * 100).toFixed(0)}%</div>
          <div class="rm-metric-sub">${simActive ? 'Simulated' : 'Actual'}</div>
        </div>
        <div class="rm-metric-card">
          <div class="rm-metric-label">Gap to Goal</div>
          <div class="rm-metric-value">₹${fmt(gap)}</div>
          <div class="rm-metric-sub">From current balance</div>
        </div>
      </div>
    `;
  }

  // ── Challenge ──────────────────────────────────────────────────────────
  function renderChallenge() {
    const body = document.getElementById('rm-challenge-body');
    if (!body) return;

    if (!challenge) {
      body.innerHTML = `
        <div class="rm-challenge-empty">
          <div class="rm-challenge-empty-icon">🎯</div>
          <div class="rm-challenge-empty-text">No challenge set yet. Tap "Set Challenge" to define a target amount and date — and track your daily progress against it.</div>
        </div>
      `;
      return;
    }

    const state   = getState();
    const balance = state.currentBalance || 0;
    const start   = challenge.startBalance;
    const target  = challenge.target;
    const dateStr = challenge.date;
    const name    = challenge.name || `₹${fmt(target)} Challenge`;

    const gained    = Math.max(0, balance - start);
    const needed    = Math.max(0, target - start);
    const pct       = needed > 0 ? Math.min(100, (gained / needed) * 100) : 100;
    const remaining = Math.max(0, target - balance);

    const today  = new Date();
    const end    = new Date(dateStr);
    const msLeft = end - today;
    const daysLeft = msLeft > 0 ? Math.ceil(msLeft / 86400000) : 0;
    const daysGone = Math.max(0, Math.ceil((today - new Date(challenge.setDate)) / 86400000));

    const dailyNeeded = daysLeft > 0 ? (remaining / daysLeft) : 0;

    body.innerHTML = `
      <div class="rm-challenge-content">
        <div class="rm-challenge-meta-row">
          <div>
            <div class="rm-challenge-name">${name}</div>
            <div class="rm-challenge-dates">Started ${new Date(challenge.setDate).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'})} · Target ${end.toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'})}</div>
          </div>
          <div class="rm-challenge-days-left ${daysLeft === 0 ? 'rm-challenge-expired' : ''}">
            ${daysLeft > 0 ? `<span class="rm-challenge-days-num">${daysLeft}</span><span class="rm-challenge-days-label">days left</span>` : '<span class="rm-challenge-days-num">🏁</span><span class="rm-challenge-days-label">Ended</span>'}
          </div>
        </div>

        <div class="rm-challenge-progress-wrap">
          <div class="rm-challenge-progress-labels">
            <span>₹${fmt(start)} start</span>
            <span class="rm-challenge-pct">${pct.toFixed(1)}%</span>
            <span>₹${fmt(target)} target</span>
          </div>
          <div class="rm-challenge-progress-track">
            <div class="rm-challenge-progress-fill" style="width:${pct.toFixed(1)}%"></div>
          </div>
        </div>

        <div class="rm-challenge-stats-grid">
          <div class="rm-challenge-stat">
            <div class="rm-challenge-stat-label">Current Balance</div>
            <div class="rm-challenge-stat-value">₹${fmt(balance)}</div>
          </div>
          <div class="rm-challenge-stat">
            <div class="rm-challenge-stat-label">Gained So Far</div>
            <div class="rm-challenge-stat-value ${gained > 0 ? 'rm-stat-positive' : ''}">+₹${fmt(gained)}</div>
          </div>
          <div class="rm-challenge-stat">
            <div class="rm-challenge-stat-label">Still Needed</div>
            <div class="rm-challenge-stat-value">₹${fmt(remaining)}</div>
          </div>
          <div class="rm-challenge-stat">
            <div class="rm-challenge-stat-label">Daily Target</div>
            <div class="rm-challenge-stat-value">₹${fmt(dailyNeeded)}/day</div>
          </div>
        </div>

        <div class="rm-challenge-reset-row">
          <button type="button" class="setup-manual-link" style="font-size:12px; color:#8A98AD;" onclick="openChallengeModal()">Edit challenge</button>
          <button type="button" class="setup-manual-link" style="font-size:12px; color:#C53D22; margin-left:14px;" onclick="clearChallenge()">Remove</button>
        </div>
      </div>
    `;
  }

  function openChallengeModal() {
    const overlay = document.getElementById('rm-challenge-modal-overlay');
    if (!overlay) return;
    if (challenge) {
      document.getElementById('rm-ch-target').value = challenge.target;
      document.getElementById('rm-ch-date').value   = challenge.date;
      document.getElementById('rm-ch-name').value   = challenge.name || '';
    }
    overlay.classList.remove('hidden');
  }

  function closeChallengeModal() {
    const overlay = document.getElementById('rm-challenge-modal-overlay');
    if (overlay) overlay.classList.add('hidden');
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
    const state = getState();
    challenge = {
      target,
      date,
      name,
      startBalance: state.currentBalance || 0,
      setDate: new Date().toISOString().slice(0, 10),
    };
    closeChallengeModal();
    renderChallenge();
  }

  function clearChallenge() {
    challenge = null;
    renderChallenge();
  }

  // ── History ────────────────────────────────────────────────────────────
  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function renderHistory() {
    const el = document.getElementById('roadmap-history-area');
    if (!el) return;
    const history = getHistory();
    if (!history || history.length === 0) {
      el.innerHTML = '<div class="roadmap-empty-state">No days submitted yet. Log and submit a day on the Daily Limits Tool to see it here.</div>';
      return;
    }
    const rows = history.slice().reverse();
    let html = '<div class="roadmap-history-grid">';
    html += `<div class="roadmap-history-cell roadmap-history-head">Date</div>
             <div class="roadmap-history-cell roadmap-history-head num">Net Result</div>
             <div class="roadmap-history-cell roadmap-history-head num">Balance After</div>`;
    rows.forEach(day => {
      const win = day.netResult > 0;
      const cls = win ? 'roadmap-history-win' : (day.netResult < 0 ? 'roadmap-history-loss' : '');
      const sign = win ? '+' : (day.netResult < 0 ? '-' : '');
      html += `<div class="roadmap-history-cell">${formatDate(day.date)}</div>
               <div class="roadmap-history-cell num ${cls}">${sign}₹${fmt(Math.abs(day.netResult))}</div>
               <div class="roadmap-history-cell num">₹${fmt(day.balanceAfter)}</div>`;
    });
    html += '</div>';
    el.innerHTML = html;
  }

  // ── Top-level render ───────────────────────────────────────────────────
  function render() {
    const state   = getState();
    const balance = state.currentBalance;

    // Balance card
    const balEl  = document.getElementById('roadmap-balance-value');
    const subEl  = document.getElementById('roadmap-balance-sub');
    if (balEl) balEl.innerText = balance !== null && balance !== undefined ? `₹${fmt(balance)}` : '₹—';

    if (balance !== null && balance !== undefined) {
      const tier      = tierForBalance(balance);
      const nextTierI = TIER_ORDER.indexOf(tier) + 1;
      const nextTier  = TIER_ORDER[nextTierI];
      const gap       = nextTier ? Math.max(0, TIER_MIN[nextTier] - balance) : 0;
      if (subEl) {
        subEl.innerText = nextTier
          ? `₹${fmt(gap)} away from the ${TIER_LABELS[nextTier]} tier (₹${fmt(TIER_MIN[nextTier])})`
          : "You're in the Pro tier — the top of the ladder.";
      }
      TIER_ORDER.forEach((t, i) => {
        const el = document.querySelector(`.roadmap-stage[data-stage="${t}"]`);
        if (!el) return;
        el.classList.remove('reached', 'current');
        if (i < TIER_ORDER.indexOf(tier)) el.classList.add('reached');
        if (t === tier) el.classList.add('current');
      });
    }

    // Init slider display
    updateGoalDisplay();
    const customInput = document.getElementById('rm-goal-custom-input');
    if (customInput && !customInput.value) customInput.value = selectedGoalAmount;
    updateSliderFill('rm-goal-slider');
    updateSliderFill('rm-sim-winrate');
    updateSliderFill('rm-sim-avgwin');

    renderSimulatorSection();
    renderChallenge();
    renderHistory();
  }

  // ── Expose ─────────────────────────────────────────────────────────────
  window.onRoadmapAvgWinInput     = onRoadmapAvgWinInput;
  window.onRoadmapSliderInput     = onRoadmapSliderInput;
  window.onRoadmapGoalCustomInput = onRoadmapGoalCustomInput;
  window.onSimulatorInput         = onSimulatorInput;
  window.openChallengeModal       = openChallengeModal;
  window.closeChallengeModal      = closeChallengeModal;
  window.closeChallengeModalIfOutside = closeChallengeModalIfOutside;
  window.saveChallengeModal       = saveChallengeModal;
  window.clearChallenge           = clearChallenge;
  window.renderRoadmap            = render;
  window.selectGoalAmount         = function() {}; // kept for compatibility

  render();
})();