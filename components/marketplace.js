/* ===========================================================
   COMPONENT: marketplace (logic)
   Loaded lazily by dashboard.js the first time this tab opens.

   DEMO SCOPE: single-session working model. Tips live only in this
   browser tab's memory (TIPS array below). No backend/multi-user sharing
   or admin approval flow exists yet.

   RULES MODELED:
   - Each trader can post max 2 tips PER INSTRUMENT PER DAY.
   - Viewing defaults to today; any other date must be explicitly picked.
   - Each tip's outcome is self-reported by the trader (Pending, Stopped
     Out, Closed at 1:1 / 1:2 / ... , Hit Target) rather than computed from
     live market data, since no price feed exists here.
   - Win Rate (Target Hit) = Hit Target / all resolved tips.
   - Win Rate (1:1+) = (all outcomes except Stopped Out) / all resolved
     tips — i.e. any tip that covered at least 1x its risk counts here,
     even if it didn't reach full target. Pending tips are excluded from
     both denominators until resolved.
   =========================================================== */

(function () {

  const TRADERS = [
    { id: "trader-alpha", name: "Trader Alpha", tagline: "Index options, 5+ yrs" },
    { id: "trader-beta", name: "Trader Beta", tagline: "Intraday Nifty/BankNifty" },
    { id: "trader-gamma", name: "Trader Gamma", tagline: "Swing options, weekly expiries" },
  ];

  // Outcome options a trader can self-report once a tip plays out.
  const OUTCOME_OPTIONS = [
    { value: "pending", label: "Pending" },
    { value: "stopped_out", label: "Stopped Out (Loss)" },
    { value: "r1", label: "Closed at 1:1" },
    { value: "r1_5", label: "Closed at 1:1.5" },
    { value: "r2", label: "Closed at 1:2" },
    { value: "target", label: "Hit Target" },
  ];

  function todayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Seed a few example tips (today + a past date) so the feed and stats
  // aren't empty on first load, and the date picker has something to find.
  const TODAY = todayDateString();
  let TIPS = [
    {
      id: "tip-seed-1",
      traderId: "trader-alpha",
      date: TODAY,
      instrument: "Nifty",
      side: "CALL",
      strike: 22500,
      entry: 145,
      target: 175,
      stopLoss: 135,
      outcome: "pending",
      postedAt: Date.now() - 1000 * 60 * 45,
    },
    {
      id: "tip-seed-2",
      traderId: "trader-beta",
      date: TODAY,
      instrument: "Bank Nifty",
      side: "PUT",
      strike: 48000,
      entry: 220,
      target: 280,
      stopLoss: 190,
      outcome: "r1",
      postedAt: Date.now() - 1000 * 60 * 20,
    },
    {
      id: "tip-seed-3",
      traderId: "trader-alpha",
      date: "2026-05-20",
      instrument: "Nifty",
      side: "CALL",
      strike: 22300,
      entry: 130,
      target: 160,
      stopLoss: 115,
      outcome: "target",
      postedAt: new Date("2026-05-20T10:00:00").getTime(),
    },
    {
      id: "tip-seed-4",
      traderId: "trader-alpha",
      date: "2026-05-20",
      instrument: "Bank Nifty",
      side: "PUT",
      strike: 47500,
      entry: 200,
      target: 250,
      stopLoss: 175,
      outcome: "stopped_out",
      postedAt: new Date("2026-05-20T11:30:00").getTime(),
    },
  ];

  let activeTraderFilter = "";
  let activeDate = TODAY;

  function fmt(n) {
    const num = parseFloat(n);
    return isNaN(num) ? n : num.toLocaleString('en-IN');
  }

  function getTrader(traderId) {
    return TRADERS.find(t => t.id === traderId);
  }

  function getOutcomeInfo(value) {
    return OUTCOME_OPTIONS.find(o => o.value === value) || OUTCOME_OPTIONS[0];
  }

  function formatTimeAgo(timestamp) {
    const diffMs = Date.now() - timestamp;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // R-multiple of the full target, used for display ("this tip targets 1:3").
  function targetRMultiple(tip) {
    const slDist = Math.abs(tip.entry - tip.stopLoss);
    const targetDist = Math.abs(tip.target - tip.entry);
    if (slDist === 0) return null;
    return targetDist / slDist;
  }

  // ---------- Trader stats (Win Rate Target Hit / Win Rate 1:1+) ----------
  function computeTraderStats(traderId) {
    const tips = TIPS.filter(t => t.traderId === traderId && t.outcome !== 'pending');
    const total = tips.length;

    if (total === 0) {
      return { totalResolved: 0, winRateTarget: null, winRate1to1: null };
    }

    const targetHits = tips.filter(t => t.outcome === 'target').length;
    const atLeast1to1 = tips.filter(t => t.outcome !== 'stopped_out').length;

    return {
      totalResolved: total,
      winRateTarget: (targetHits / total) * 100,
      winRate1to1: (atLeast1to1 / total) * 100,
    };
  }

  function renderTraderStats() {
    const container = document.getElementById('market-trader-stats-area');
    if (!container) return;

    const tradersToShow = activeTraderFilter ? TRADERS.filter(t => t.id === activeTraderFilter) : TRADERS;

    container.innerHTML = `<div class="learn-card-grid">${tradersToShow.map(t => {
      const stats = computeTraderStats(t.id);
      return `
        <div class="market-trader-stat-card">
          <div class="market-trader-stat-header">
            <span class="market-trader-avatar">${t.name.charAt(0)}</span>
            <div>
              <div class="market-trader-name">${t.name}</div>
              <div class="market-trader-tagline">${t.tagline}</div>
            </div>
          </div>
          <div class="market-trader-stat-grid">
            <div>
              <div class="market-tip-stat-label">Win Rate (Target Hit)</div>
              <div class="market-tip-stat-value">${stats.winRateTarget !== null ? stats.winRateTarget.toFixed(0) + '%' : '\u2014'}</div>
            </div>
            <div>
              <div class="market-tip-stat-label">Win Rate (1:1+)</div>
              <div class="market-tip-stat-value">${stats.winRate1to1 !== null ? stats.winRate1to1.toFixed(0) + '%' : '\u2014'}</div>
            </div>
            <div>
              <div class="market-tip-stat-label">Resolved Tips</div>
              <div class="market-tip-stat-value">${stats.totalResolved}</div>
            </div>
          </div>
        </div>
      `;
    }).join('')}</div>`;
  }

  // ---------- Filters ----------
  function renderTraderFilterBar() {
    const bar = document.getElementById('market-trader-filter-bar');
    if (!bar) return;
    const allBtn = `<button type="button" class="learn-filter-btn ${activeTraderFilter === '' ? 'active' : ''}" onclick="setMarketTraderFilter('')">All Traders</button>`;
    const traderBtns = TRADERS.map(t => `
      <button type="button" class="learn-filter-btn ${activeTraderFilter === t.id ? 'active' : ''}" onclick="setMarketTraderFilter('${t.id}')">${t.name}</button>
    `).join('');
    bar.innerHTML = allBtn + traderBtns;
  }

  function setMarketTraderFilter(traderId) {
    activeTraderFilter = traderId;
    renderTraderFilterBar();
    renderTraderStats();
    renderFeed();
  }

  function onMarketDateChange() {
    const input = document.getElementById('market-date-picker');
    activeDate = input ? input.value : TODAY;
    renderFeed();
  }

  // ---------- Feed (filtered by date + trader) ----------
  function renderFeed() {
    const container = document.getElementById('market-feed-area');
    if (!container) return;

    let tips = TIPS.filter(t => t.date === activeDate);
    if (activeTraderFilter) {
      tips = tips.filter(t => t.traderId === activeTraderFilter);
    }
    tips = tips.slice().sort((a, b) => b.postedAt - a.postedAt);

    if (tips.length === 0) {
      const dateLabel = activeDate === TODAY ? 'today' : activeDate;
      container.innerHTML = `<div class="roadmap-empty-state">No tips ${activeTraderFilter ? 'from this trader ' : ''}for ${dateLabel}.</div>`;
      return;
    }

    container.innerHTML = tips.map(tip => {
      const trader = getTrader(tip.traderId);
      const sideClass = tip.side === 'CALL' ? 'market-side-call' : 'market-side-put';
      const outcomeInfo = getOutcomeInfo(tip.outcome);
      const rTarget = targetRMultiple(tip);
      const outcomeClass = tip.outcome === 'pending' ? 'market-outcome-pending'
        : tip.outcome === 'stopped_out' ? 'market-outcome-loss' : 'market-outcome-win';

      return `
        <div class="market-tip-card">
          <div class="market-tip-header">
            <div class="market-tip-trader">
              <span class="market-trader-avatar">${trader ? trader.name.charAt(0) : '?'}</span>
              <div>
                <div class="market-trader-name">${trader ? trader.name : 'Unknown trader'}</div>
                <div class="market-trader-tagline">${trader ? trader.tagline : ''}</div>
              </div>
            </div>
            <div class="market-tip-time">${formatTimeAgo(tip.postedAt)}</div>
          </div>
          <div class="market-tip-body">
            <span class="market-side-tag ${sideClass}">${tip.side}</span>
            <span class="market-tip-instrument">${tip.instrument} ${fmt(tip.strike)} ${tip.side}</span>
            ${rTarget !== null ? `<span class="market-tip-rratio">Targets 1:${rTarget.toFixed(1)}</span>` : ''}
          </div>
          <div class="market-tip-grid">
            <div><span class="market-tip-stat-label">Entry</span><span class="market-tip-stat-value">${fmt(tip.entry)}</span></div>
            <div><span class="market-tip-stat-label">Target</span><span class="market-tip-stat-value market-tip-target">${fmt(tip.target)}</span></div>
            <div><span class="market-tip-stat-label">Stop Loss</span><span class="market-tip-stat-value market-tip-sl">${fmt(tip.stopLoss)}</span></div>
          </div>
          <div class="market-outcome-row">
            <span class="market-outcome-badge ${outcomeClass}">${outcomeInfo.label}</span>
            <select class="market-outcome-select" onchange="onOutcomeChange('${tip.id}', this.value)">
              ${OUTCOME_OPTIONS.map(o => `<option value="${o.value}" ${o.value === tip.outcome ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
          </div>
        </div>
      `;
    }).join('');
  }

  function onOutcomeChange(tipId, newOutcome) {
    const tip = TIPS.find(t => t.id === tipId);
    if (!tip) return;
    tip.outcome = newOutcome;
    renderFeed();
    renderTraderStats();
  }

  // ---------- Posting ----------
  function populateTraderDropdown() {
    const select = document.getElementById('mk-trader');
    if (!select) return;
    select.innerHTML = TRADERS.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  }

  function countTipsToday(traderId, instrument) {
    return TIPS.filter(t => t.traderId === traderId && t.instrument === instrument && t.date === TODAY).length;
  }

  function postMarketTip() {
    const traderId = document.getElementById('mk-trader').value;
    const instrument = document.getElementById('mk-instrument').value;
    const side = document.getElementById('mk-side').value;
    const strike = document.getElementById('mk-strike').value;
    const entry = document.getElementById('mk-entry').value;
    const target = document.getElementById('mk-target').value;
    const stopLoss = document.getElementById('mk-sl').value;

    const statusEl = document.getElementById('mk-post-status');

    if (!strike || !entry || !target || !stopLoss) {
      if (statusEl) {
        statusEl.innerText = 'Fill in strike, entry, target, and stop loss to post.';
        statusEl.style.color = '#d9381e';
      }
      return;
    }

    const tipsToday = countTipsToday(traderId, instrument);
    if (tipsToday >= 2) {
      if (statusEl) {
        const traderName = getTrader(traderId) ? getTrader(traderId).name : 'This trader';
        statusEl.innerText = `${traderName} has already posted 2 ${instrument} tips today \u2014 that's the daily limit per instrument.`;
        statusEl.style.color = '#d9381e';
      }
      return;
    }

    TIPS.push({
      id: `tip-${Date.now()}`,
      traderId,
      date: TODAY,
      instrument,
      side,
      strike: parseFloat(strike),
      entry: parseFloat(entry),
      target: parseFloat(target),
      stopLoss: parseFloat(stopLoss),
      outcome: 'pending',
      postedAt: Date.now(),
    });

    if (statusEl) {
      statusEl.innerText = 'Tip posted to this session\u2019s feed (outcome starts as Pending).';
      statusEl.style.color = '#1d9e75';
    }

    ['mk-strike', 'mk-entry', 'mk-target', 'mk-sl'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // Jump the viewer back to today so they see the tip they just posted.
    activeDate = TODAY;
    const datePicker = document.getElementById('market-date-picker');
    if (datePicker) datePicker.value = TODAY;

    renderFeed();
    renderTraderStats();
  }

  window.setMarketTraderFilter = setMarketTraderFilter;
  window.onMarketDateChange = onMarketDateChange;
  window.onOutcomeChange = onOutcomeChange;
  window.postMarketTip = postMarketTip;

  populateTraderDropdown();

  const datePickerInit = document.getElementById('market-date-picker');
  if (datePickerInit) {
    datePickerInit.value = TODAY;
    datePickerInit.max = TODAY;
  }

  renderTraderFilterBar();
  renderTraderStats();
  renderFeed();

})();
/* === END COMPONENT: marketplace (logic) === */