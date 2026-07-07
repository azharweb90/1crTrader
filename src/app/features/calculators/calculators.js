/* ===========================================================
   COMPONENT: calculators
   Five standalone "what-if" calculators (Position Size, Trade
   Expectancy, Drawdown & Recovery, Equity Simulator, Withdraw & Scale).
   Nothing here is saved anywhere — every field recalculates live as you
   type, same "scratchpad" spirit as the Daily Limits Tool's own
   calculator, just without the rule-enforcement side of it.

   Account Equity / Starting Capital is ONE shared value (sharedEquity)
   across all five tabs — seeded from the trader's real current balance
   (window.getProfileState().currentBalance) on first load, and kept in
   sync whenever any of the four equity-labeled inputs changes (see
   onSharedEquityInput / EQUITY_INPUT_IDS).

   Withdraw & Scale's "From trades" mode reuses the shared
   window.getWeekBounds() (formatters.js) for "what week are we in" —
   see that file's comment for why this was consolidated rather than
   adding a third local copy.

   Loaded lazily by app-shell.js the first time this tab opens.
   =========================================================== */

(function () {

  // ---------- Shared state ----------
  let activeCalcTab = 'position';
  let sharedEquity = null; // seeded from real balance, synced across all 5 tabs
  let expectancyMode = 'amount'; // 'R multiple' mode is a disabled placeholder for now
  let equitySimHorizon = 12; // 6 | 12
  let withdrawSource = 'trades'; // 'trades' | 'manual'
  let withdrawManualSign = 'profit'; // 'profit' | 'loss'

  const EQUITY_INPUT_IDS = ['ps-equity', 'dd-equity', 'es-capital', 'ws-capital'];
  const RECOVERY_MATRIX = [5, 10, 15, 20, 25, 30, 40, 50];
  const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // ---------- Generic helpers ----------
  function num(id) {
    const el = document.getElementById(id);
    if (!el) return NaN;
    const v = parseFloat(el.value);
    return isNaN(v) ? NaN : v;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
  }

  function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function fmtSigned(n) {
    const sign = n > 0 ? '+' : (n < 0 ? '−' : '');
    return `${sign}₹${fmt(Math.abs(n))}`;
  }

  function fmtPct(n, decimals) {
    const d = decimals === undefined ? 2 : decimals;
    return `${n.toFixed(d)}%`;
  }

  function setHeroVariant(cardId, variant) {
    const el = document.getElementById(cardId);
    if (!el) return;
    el.classList.remove('calc-hero-blue', 'calc-hero-green', 'calc-hero-red');
    el.classList.add(`calc-hero-${variant}`);
  }

  function setValueColor(valueId, kind) {
    const el = document.getElementById(valueId);
    if (!el) return;
    el.classList.remove('calc-hero-value-profit', 'calc-hero-value-loss');
    if (kind === 'profit') el.classList.add('calc-hero-value-profit');
    else if (kind === 'loss') el.classList.add('calc-hero-value-loss');
  }

  // ---------- Shared equity ----------
  function getRealBalance() {
    const state = (typeof window.getProfileState === 'function') ? window.getProfileState() : null;
    if (state && typeof state.currentBalance === 'number' && !isNaN(state.currentBalance)) return state.currentBalance;
    if (state && typeof state.startingCapital === 'number' && !isNaN(state.startingCapital)) return state.startingCapital;
    return 100000;
  }

  function ensureSharedEquitySeeded() {
    if (sharedEquity === null) {
      sharedEquity = getRealBalance();
    }
  }

  function applySharedEquityToInputs() {
    EQUITY_INPUT_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && document.activeElement !== el) el.value = sharedEquity;
    });
  }

  // Bound to every equity-labeled input's oninput. Updates the one shared
  // value and mirrors it into the OTHER three tabs' equity inputs — the
  // input's own tab recalculates separately via its own oninput chain
  // (e.g. onSharedEquityInput(this.value); recalcPosition();).
  function onSharedEquityInput(value) {
    const v = parseFloat(value);
    sharedEquity = isNaN(v) ? 0 : v;
    EQUITY_INPUT_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && document.activeElement !== el) el.value = sharedEquity;
    });
  }

  // ---------- Tabs ----------
  function setCalcTab(tab) {
    activeCalcTab = tab;
    document.querySelectorAll('.calc-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.calc === tab);
    });
    document.querySelectorAll('.calc-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== `calc-panel-${tab}`);
    });
    // Recompute the tab being switched TO, in case sharedEquity (or real
    // trade history, for Withdraw & Scale) changed while another tab was active.
    if (tab === 'position') recalcPosition();
    else if (tab === 'expectancy') recalcExpectancy();
    else if (tab === 'drawdown') recalcDrawdown();
    else if (tab === 'equity') recalcEquitySim();
    else if (tab === 'withdraw') recalcWithdraw();
  }

  // ---------- Position Size ----------
  function recalcPosition() {
    const equity = num('ps-equity');
    const riskPct = num('ps-risk');
    const entry = num('ps-entry');
    const stop = num('ps-stop');

    const eq = isNaN(equity) ? 0 : equity;
    const rp = isNaN(riskPct) ? 0 : riskPct;
    const maxRisk = eq * rp / 100;

    setText('ps-out-maxrisk', `₹${fmt(maxRisk)}`);
    setText('ps-out-maxrisk-sub', `${isNaN(riskPct) ? 0 : riskPct}% of ₹${fmt(eq)}`);

    const hasEntryStop = !isNaN(entry) && !isNaN(stop) && entry !== stop;
    if (!hasEntryStop) {
      setText('ps-out-units', '—');
      setText('ps-out-sub', 'Enter entry & stop-loss');
      setText('ps-out-riskunit', '—');
      return;
    }

    const riskPerUnit = Math.abs(entry - stop);
    const rawUnits = riskPerUnit > 0 ? maxRisk / riskPerUnit : 0;
    const units = Math.round(rawUnits);
    const positionValue = rawUnits * entry;

    setText('ps-out-units', fmt(units));
    setText('ps-out-sub', `Position value ≈ ₹${fmt(positionValue)}`);
    setText('ps-out-riskunit', `${fmt(riskPerUnit)} /unit`);
  }

  // ---------- Trade Expectancy ----------
  function setExpectancyMode(mode) {
    // R-multiple mode is intentionally not implemented yet — the
    // screenshots this page was built from only specified "amount" mode.
    // The toggle button is disabled in the HTML; this stub means turning
    // it on later is a small addition here, not a new wiring job.
    if (mode !== 'amount') return;
    expectancyMode = mode;
    recalcExpectancy();
  }

  function recalcExpectancy() {
    const winRate = num('te-winrate');
    const avgWin = num('te-avgwin');
    const avgLoss = num('te-avgloss');
    const badge = document.getElementById('te-out-badge');

    if (isNaN(winRate) || isNaN(avgWin) || isNaN(avgLoss)) {
      setText('te-out-value', '—');
      setText('te-out-sub', 'Enter win rate, average win and average loss');
      setText('te-out-breakeven', '—');
      if (badge) badge.classList.add('hidden');
      setHeroVariant('te-hero-card', 'blue');
      setValueColor('te-out-value', null);
      return;
    }

    const wr = Math.max(0, Math.min(100, winRate));
    const lossRate = 100 - wr;
    const expectancy = (wr / 100) * avgWin - (lossRate / 100) * avgLoss;
    const denom = avgWin + avgLoss;
    const breakEven = denom > 0 ? (avgLoss / denom) * 100 : 0;
    const vsBreakEven = wr - breakEven;

    setText('te-out-value', fmtSigned(expectancy));
    setText('te-out-sub', `${vsBreakEven >= 0 ? '+' : ''}${vsBreakEven.toFixed(2)}% vs break-even`);
    setText('te-out-breakeven', fmtPct(breakEven));

    if (badge) {
      badge.classList.remove('hidden');
      if (expectancy > 0) {
        badge.className = 'calc-hero-badge';
        badge.innerText = 'Profitable edge';
        setHeroVariant('te-hero-card', 'green');
        setValueColor('te-out-value', 'profit');
      } else if (expectancy < 0) {
        badge.className = 'calc-hero-badge calc-hero-badge-loss';
        badge.innerText = 'Losing edge';
        setHeroVariant('te-hero-card', 'red');
        setValueColor('te-out-value', 'loss');
      } else {
        badge.className = 'calc-hero-badge calc-hero-badge-neutral';
        badge.innerText = 'Break-even';
        setHeroVariant('te-hero-card', 'blue');
        setValueColor('te-out-value', null);
      }
    }
  }

  // ---------- Drawdown & Recovery ----------
  function renderRecoveryMatrix() {
    const container = document.getElementById('dd-matrix-table');
    if (!container) return;
    let html = `<div class="calc-matrix-row calc-matrix-head-row">
      <div class="calc-matrix-cell calc-matrix-head">DRAWDOWN</div>
      <div class="calc-matrix-cell calc-matrix-head num">GAIN TO RECOVER</div>
    </div>`;
    RECOVERY_MATRIX.forEach(d => {
      const gain = (d / (100 - d)) * 100;
      const gainText = gain % 1 === 0 ? gain.toFixed(0) : gain.toFixed(2);
      html += `<div class="calc-matrix-row">
        <div class="calc-matrix-cell">−${d}%</div>
        <div class="calc-matrix-cell num">+${gainText}%</div>
      </div>`;
    });
    container.innerHTML = html;
  }

  function recalcDrawdown() {
    const ddPct = num('dd-pct');
    const equity = num('dd-equity');
    const eq = isNaN(equity) ? 0 : equity;

    if (isNaN(ddPct) || ddPct <= 0) {
      setText('dd-out-gain', '—');
      setText('dd-out-recover', 'Enter a drawdown %');
    } else if (ddPct >= 100) {
      setText('dd-out-gain', '—');
      setText('dd-out-recover', 'Drawdown must be below 100%');
    } else {
      const gain = (ddPct / (100 - ddPct)) * 100;
      const recoverAmt = eq * (ddPct / 100);
      setText('dd-out-gain', fmtPct(gain));
      setText('dd-out-recover', `Recover ₹${fmt(recoverAmt)} of losses`);
    }

    const streak = num('dd-streak');
    const streakRisk = num('dd-streak-risk');
    if (isNaN(streak) || streak <= 0 || isNaN(streakRisk) || streakRisk <= 0) {
      setText('dd-out-streak-drawdown', '—');
      setText('dd-out-streak-gain', '—');
      setText('dd-out-streak-caption', 'Enter consecutive losses and risk per trade');
      return;
    }

    const n = Math.round(streak);
    const perTradeFactor = Math.max(0, 1 - (streakRisk / 100));
    const remaining = Math.pow(perTradeFactor, n);
    const resultingDrawdown = (1 - remaining) * 100;
    const gainToRecover = remaining > 0 ? ((1 / remaining) - 1) * 100 : Infinity;

    setText('dd-out-streak-drawdown', fmtPct(resultingDrawdown));
    setText('dd-out-streak-gain', isFinite(gainToRecover) ? fmtPct(gainToRecover) : '—');
    setText('dd-out-streak-caption', `${n} loss${n === 1 ? '' : 'es'} × ${streakRisk}% risk each`);
  }

  // ---------- Equity Simulator ----------
  function computeEquitySim() {
    const capital = num('es-capital');
    const tradesMonth = num('es-trades-month');
    const winRate = num('es-winrate');
    const risk = num('es-risk');
    const reward = num('es-reward');

    if ([capital, tradesMonth, winRate, risk, reward].some(v => isNaN(v)) || capital <= 0 || tradesMonth <= 0) {
      return null;
    }

    const wr = Math.max(0, Math.min(100, winRate)) / 100;
    const gainOnWin = reward * risk;  // % of equity, on a winning trade
    const lossOnLoss = risk;          // % of equity, on a losing trade
    const edgePerTrade = wr * gainOnWin - (1 - wr) * lossOnLoss; // % per trade, compounded

    const totalTrades = Math.round(tradesMonth * equitySimHorizon);
    const finalEquity = capital * Math.pow(1 + edgePerTrade / 100, totalTrades);

    const points = [];
    for (let m = 0; m <= equitySimHorizon; m++) {
      const tradesSoFar = Math.round(tradesMonth * m);
      points.push(capital * Math.pow(1 + edgePerTrade / 100, tradesSoFar));
    }

    return { capital, totalTrades, edgePerTrade, finalEquity, points };
  }

  function renderEquityChart(points) {
    const area = document.getElementById('es-chart-area');
    if (!area) return;
    if (!points || points.length < 2) {
      area.innerHTML = '';
      return;
    }

    const W = 900, H = 260, padL = 4, padR = 4, padT = 16, padB = 16;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = (max - min) || 1;
    const stepX = (W - padL - padR) / (points.length - 1);

    const coords = points.map((v, i) => {
      const x = padL + i * stepX;
      const y = padT + (H - padT - padB) * (1 - (v - min) / range);
      return [x, y];
    });

    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
    const last = coords[coords.length - 1];
    const first = coords[0];
    const areaPath = `${linePath} L${last[0].toFixed(1)},${(H - padB).toFixed(1)} L${first[0].toFixed(1)},${(H - padB).toFixed(1)} Z`;

    area.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="calcEquityGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#16A34A" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="#16A34A" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#calcEquityGradient)" stroke="none"/>
        <path d="${linePath}" fill="none" stroke="#16A34A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4.5" fill="#16A34A"/>
      </svg>
    `;
  }

  function setEquitySimHorizon(h) {
    equitySimHorizon = h;
    document.querySelectorAll('#es-horizon-toggle .calc-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.horizon) === h);
    });
    recalcEquitySim();
  }

  function recalcEquitySim() {
    setText('es-out-label', `PROJECTED EQUITY · MONTH ${equitySimHorizon}`);
    const result = computeEquitySim();

    if (!result) {
      setText('es-out-value', '—');
      setText('es-out-sub', 'Enter your inputs to project a curve');
      setText('es-out-return', '—');
      setText('es-out-edge', '—');
      setHtml('es-chart-area', '');
      return;
    }

    const totalReturn = (result.finalEquity / result.capital - 1) * 100;

    setText('es-out-value', `₹${fmt(result.finalEquity)}`);
    setText('es-out-sub', `${fmt(result.totalTrades)} trades over ${equitySimHorizon} months`);
    setText('es-out-return', `${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`);
    setText('es-out-edge', `${result.edgePerTrade >= 0 ? '+' : ''}${result.edgePerTrade.toFixed(2)}%`);

    const returnEl = document.getElementById('es-out-return');
    const edgeEl = document.getElementById('es-out-edge');
    const valueEl = document.getElementById('es-out-value');
    [returnEl, edgeEl, valueEl].forEach(el => {
      if (el) el.classList.remove('calc-stat-value-profit', 'calc-stat-value-loss', 'calc-hero-value-profit', 'calc-hero-value-loss');
    });
    if (returnEl) returnEl.classList.add(totalReturn >= 0 ? 'calc-stat-value-profit' : 'calc-stat-value-loss');
    if (valueEl) valueEl.classList.add(totalReturn >= 0 ? 'calc-hero-value-profit' : 'calc-hero-value-loss');
    if (edgeEl) edgeEl.classList.add(result.edgePerTrade >= 0 ? 'calc-stat-value-profit' : 'calc-stat-value-loss');

    renderEquityChart(result.points);
  }

  // ---------- Withdraw & Scale ----------
  function toLocalIso(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function dayAbbrevFromIso(iso) {
    const p = iso.split('-');
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    return WEEKDAY_ABBR[d.getDay()];
  }

  // Reuses the shared window.getWeekBounds() (Monday-start trading week —
  // see formatters.js) rather than computing week boundaries locally a
  // third time in this app.
  function getThisWeekTrades() {
    const history = (typeof window.getTradeHistory === 'function') ? window.getTradeHistory() : [];
    if (typeof window.getWeekBounds !== 'function') return [];
    const wk = window.getWeekBounds(new Date());
    const startIso = toLocalIso(wk.start);
    const endIso = toLocalIso(wk.end);
    return history
      .filter(t => t.date >= startIso && t.date <= endIso)
      .sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : (a.submittedAt || 0) - (b.submittedAt || 0))));
  }

  function setWithdrawSource(source) {
    withdrawSource = source;
    document.querySelectorAll('#ws-source-toggle .calc-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.source === source);
    });
    const tradesBlock = document.getElementById('ws-trades-block');
    const manualBlock = document.getElementById('ws-manual-block');
    if (tradesBlock) tradesBlock.classList.toggle('hidden', source !== 'trades');
    if (manualBlock) manualBlock.classList.toggle('hidden', source !== 'manual');
    recalcWithdraw();
  }

  function setWithdrawSign(sign) {
    withdrawManualSign = sign;
    document.querySelectorAll('#ws-sign-toggle .calc-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sign === sign);
    });
    recalcWithdraw();
  }

  // Renders the "closed trades this week" list and returns their net
  // total — the caller (recalcWithdraw) feeds that straight into the
  // withdraw/take-a-week-off/keep-going decision below.
  function renderWithdrawTradesBlock() {
    const trades = getThisWeekTrades();
    const listEl = document.getElementById('ws-trades-list');
    const countEl = document.getElementById('ws-trades-count-label');
    const totalEl = document.getElementById('ws-trades-total');
    if (!listEl) return 0;

    if (trades.length === 0) {
      listEl.innerHTML = '<div class="roadmap-empty-state">No trades logged yet this week.</div>';
    } else {
      listEl.innerHTML = trades.map(t => {
        const isProfit = t.netResult >= 0;
        return `<div class="calc-ws-trade-row">
          <span class="calc-ws-trade-day">${dayAbbrevFromIso(t.date)}</span>
          <span class="calc-ws-trade-instrument">${t.instrument || 'Trade'}</span>
          <span class="calc-ws-trade-amount ${isProfit ? 'profit' : 'loss'}">${isProfit ? '+' : '−'}₹${fmt(Math.abs(t.netResult))}</span>
        </div>`;
      }).join('');
    }

    const total = trades.reduce((sum, t) => sum + t.netResult, 0);
    if (countEl) countEl.innerText = `${trades.length} closed trade${trades.length === 1 ? '' : 's'}`;
    if (totalEl) {
      totalEl.innerText = `${total >= 0 ? '+' : '−'}₹${fmt(Math.abs(total))}`;
      totalEl.classList.toggle('calc-ws-trades-total-loss', total < 0);
    }
    return total;
  }

  function renderWithdrawMove(capital, weeklyBudget, days, weekResult) {
    const pill = document.getElementById('ws-out-pill');
    const titleEl = document.getElementById('ws-out-title');
    const bodyEl = document.getElementById('ws-out-body');
    const statsEl = document.getElementById('ws-move-stats');
    if (!pill || !titleEl || !bodyEl || !statsEl) return;

    if (!capital || weeklyBudget <= 0) {
      setHeroVariant('ws-move-card', 'blue');
      pill.classList.add('hidden');
      titleEl.innerText = "Waiting on this week's numbers";
      bodyEl.innerText = "Enter your starting capital and this week's result to see the move.";
      statsEl.classList.add('hidden');
      return;
    }

    if (weekResult > weeklyBudget) {
      // Banked more than the weekly risk budget — withdraw the budgeted
      // amount, carry the rest forward as a smaller, "house money" cushion.
      const withdrawNow = weeklyBudget;
      const cushion = weekResult - weeklyBudget;
      const cushionPerDay = cushion / days;
      const cushionPctPerDay = capital > 0 ? (cushionPerDay / capital) * 100 : 0;

      setHeroVariant('ws-move-card', 'green');
      pill.classList.remove('hidden');
      pill.className = 'calc-hero-badge';
      pill.innerText = 'WITHDRAW';
      titleEl.innerText = `Withdraw ₹${fmt(withdrawNow)} — lock it in`;
      bodyEl.innerText = `You banked more than your weekly risk. Take out ₹${fmt(withdrawNow)} (the amount you were willing to lose) as real profit, and carry ₹${fmt(cushion)} as next week's cushion — that drops your risk to about ${cushionPctPerDay.toFixed(1)}% a day (₹${fmt(cushionPerDay)}), all house money.`;
      statsEl.classList.remove('hidden');
      setText('ws-out-withdraw', `₹${fmt(withdrawNow)}`);
      setText('ws-out-cushion', `₹${fmt(cushion)}`);
      setText('ws-out-cushion-sub', `≈${cushionPctPerDay.toFixed(1)}%/day · ₹${fmt(cushionPerDay)}`);
    } else if (weekResult <= -weeklyBudget) {
      // Hit (or blew past) the weekly cap — no stat cards here, the message is the point.
      setHeroVariant('ws-move-card', 'red');
      pill.classList.remove('hidden');
      pill.className = 'calc-hero-badge calc-hero-badge-loss';
      pill.innerText = 'TAKE A WEEK OFF';
      titleEl.innerText = 'Weekly limit hit — take a week off';
      bodyEl.innerText = `You're down ₹${fmt(Math.abs(weekResult))}, at or past your ₹${fmt(weeklyBudget)} weekly cap. Don't jump back in next week — step away for a full week. Use the gap to study your trades, rebuild your psychology, and return only once your head is clear.`;
      statsEl.classList.add('hidden');
    } else {
      // Still inside the weekly risk budget either way — no screenshot
      // covered this state explicitly, but the UI needs a resting state
      // between "withdraw" and "take a week off."
      setHeroVariant('ws-move-card', 'blue');
      pill.classList.remove('hidden');
      pill.className = 'calc-hero-badge calc-hero-badge-neutral';
      pill.innerText = 'KEEP GOING';
      const remaining = weeklyBudget - weekResult;
      titleEl.innerText = weekResult >= 0 ? "Still inside this week's risk" : 'Inside your weekly cap — for now';
      const soFar = weekResult >= 0 ? `You're up ₹${fmt(weekResult)} so far.` : `You're down ₹${fmt(Math.abs(weekResult))} so far.`;
      bodyEl.innerText = `${soFar} You have ₹${fmt(remaining)} of this week's ₹${fmt(weeklyBudget)} risk budget left before either move kicks in — keep trading your plan.`;
      statsEl.classList.add('hidden');
    }
  }

  function renderWithdrawMilestone(capital, weekResult) {
    const startEl = document.getElementById('ws-milestone-start');
    const currentEl = document.getElementById('ws-milestone-current');
    const targetEl = document.getElementById('ws-milestone-target');
    const fillEl = document.getElementById('ws-milestone-fill');
    const statusEl = document.getElementById('ws-milestone-status');
    const headlineEl = document.getElementById('ws-milestone-headline');
    const bodyEl = document.getElementById('ws-milestone-body');
    if (!startEl || !currentEl || !targetEl || !fillEl || !statusEl || !headlineEl || !bodyEl) return;

    if (!capital) {
      startEl.innerText = '—';
      currentEl.innerText = '—';
      targetEl.innerText = '—';
      fillEl.style.width = '0%';
      statusEl.innerText = 'HOLD';
      statusEl.classList.remove('calc-ws-milestone-status-done');
      headlineEl.innerText = "Don't increase lot size yet";
      bodyEl.innerText = 'Enter your starting capital to see your scale-up milestone.';
      return;
    }

    const target = capital * 1.5;
    const current = capital + weekResult;
    const pct = Math.max(0, Math.min(100, ((current - capital) / (target - capital)) * 100));

    startEl.innerText = `₹${fmt(capital)}`;
    startEl.classList.toggle('calc-ws-milestone-struck', current < capital);
    currentEl.innerText = `₹${fmt(current)}`;
    targetEl.innerText = `₹${fmt(target)}`;
    fillEl.style.width = `${pct}%`;

    if (current >= target) {
      statusEl.innerText = 'SCALE UP';
      statusEl.classList.add('calc-ws-milestone-status-done');
      headlineEl.innerText = "You've hit your scale-up milestone";
      bodyEl.innerText = `You're ₹${fmt(current - target)} past ₹${fmt(target)} (+50%). This is where a disciplined trader considers sizing up — slowly, one step at a time.`;
    } else {
      statusEl.innerText = 'HOLD';
      statusEl.classList.remove('calc-ws-milestone-status-done');
      headlineEl.innerText = "Don't increase lot size yet";
      const remaining = target - current;
      bodyEl.innerText = `Keep the same size and withdraw profit above your cushion. ₹${fmt(remaining)} more to reach ₹${fmt(target)} (+50%), where you scale up.`;
    }
  }

  function recalcWithdraw() {
    const capital = num('ws-capital');
    const limitPct = num('ws-limit-pct');
    const days = num('ws-days');

    const cap = isNaN(capital) ? 0 : capital;
    const lp = isNaN(limitPct) ? 0 : limitPct;
    const d = (isNaN(days) || days <= 0) ? 5 : days;

    const weeklyBudget = cap * lp / 100;
    const perDay = weeklyBudget / d;
    const perMonth = weeklyBudget * 4; // 4 trading weeks/month, same assumption the screenshots' numbers imply

    setText('ws-out-perday', `₹${fmt(perDay)}`);
    setText('ws-out-perweek', `₹${fmt(weeklyBudget)}`);
    setText('ws-out-permonth', `₹${fmt(perMonth)}`);

    let weekResult = 0;
    if (withdrawSource === 'trades') {
      weekResult = renderWithdrawTradesBlock() || 0;
    } else {
      const amt = num('ws-manual-amount');
      const a = isNaN(amt) ? 0 : Math.abs(amt);
      weekResult = withdrawManualSign === 'profit' ? a : -a;
    }

    renderWithdrawMove(cap, weeklyBudget, d, weekResult);
    renderWithdrawMilestone(cap, weekResult);
  }

  // ---------- Init ----------
  function renderAll() {
    ensureSharedEquitySeeded();
    applySharedEquityToInputs();
    renderRecoveryMatrix();
    recalcPosition();
    recalcExpectancy();
    recalcDrawdown();
    recalcEquitySim();
    recalcWithdraw();
  }

  window.setCalcTab = setCalcTab;
  window.onSharedEquityInput = onSharedEquityInput;
  window.recalcPosition = recalcPosition;
  window.setExpectancyMode = setExpectancyMode;
  window.recalcExpectancy = recalcExpectancy;
  window.recalcDrawdown = recalcDrawdown;
  window.setEquitySimHorizon = setEquitySimHorizon;
  window.recalcEquitySim = recalcEquitySim;
  window.setWithdrawSource = setWithdrawSource;
  window.setWithdrawSign = setWithdrawSign;
  window.recalcWithdraw = recalcWithdraw;
  window.renderCalculators = renderAll;

  renderAll();

})();
/* === END COMPONENT: calculators === */
