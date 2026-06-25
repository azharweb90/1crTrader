/* ===========================================================
   COMPONENT: strategies (logic)
   Loaded lazily by dashboard.js the first time this tab opens.

   DEMO SCOPE: single-session model. Strategies live only in this browser
   tab's memory (STRATEGIES array below). No backend/multi-user sharing yet.
   Each strategy's checklist is interactive — checking items off is a live
   self-check against the viewer's own setup, not tied to any saved record.
   =========================================================== */

(function () {

  // Seed a couple of example strategies so the list isn't empty on first load.
  let STRATEGIES = [
    {
      id: "strat-seed-1",
      name: "Opening Range Breakout",
      author: "Trader Alpha",
      description: "Trade the breakout of the first 15-minute range on index options, entering on a retest with volume confirmation.",
      winRate: 68,
      rrRatio: "1:2.5",
      sampleSize: 120,
      checklist: [
        "Price breaks the opening 15-min range high or low",
        "Breakout candle has above-average volume",
        "No major news/event scheduled in the next hour",
        "Broader index trend agrees with breakout direction",
        "Risk per trade does not exceed today's max loss limit",
      ],
    },
    {
      id: "strat-seed-2",
      name: "VWAP Reversal",
      author: "Trader Gamma",
      description: "Fade extended moves back toward VWAP on low-conviction days, using rejection candles at a key support/resistance zone.",
      winRate: 61,
      rrRatio: "1:1.8",
      sampleSize: 95,
      checklist: [
        "Price is extended 1%+ away from VWAP",
        "Clear rejection candle (wick) at the zone",
        "Volume declining on the extension, not increasing",
        "Stop loss placed beyond the rejection wick",
      ],
    },
  ];

  let activeStrategyId = null;

  function getStrategy(id) {
    return STRATEGIES.find(s => s.id === id);
  }

  function renderList() {
    const container = document.getElementById('strategies-list-area');
    if (!container) return;

    if (STRATEGIES.length === 0) {
      container.innerHTML = '<div class="roadmap-empty-state">No strategies shared yet.</div>';
      return;
    }

    container.innerHTML = `<div class="learn-card-grid">${STRATEGIES.map(s => `
      <button type="button" class="strategy-card" onclick="openStrategyDetail('${s.id}')">
        <div class="strategy-card-name">${s.name}</div>
        <div class="strategy-card-author">by ${s.author}</div>
        <div class="strategy-card-stats">
          <span class="strategy-card-stat"><strong>${s.winRate}%</strong> win rate</span>
          <span class="strategy-card-stat"><strong>${s.rrRatio}</strong> R:R</span>
          <span class="strategy-card-stat"><strong>${s.sampleSize}</strong> trades</span>
        </div>
        <div class="strategy-card-desc">${s.description}</div>
      </button>
    `).join('')}</div>`;
  }

  function openStrategyDetail(id) {
    const strat = getStrategy(id);
    if (!strat) return;

    activeStrategyId = id;

    document.getElementById('strat-detail-name').innerText = strat.name;
    document.getElementById('strat-detail-author').innerText = `by ${strat.author}`;
    document.getElementById('strat-detail-description').innerText = strat.description;
    document.getElementById('strat-detail-winrate').innerText = `${strat.winRate}%`;
    document.getElementById('strat-detail-rr').innerText = strat.rrRatio;
    document.getElementById('strat-detail-sample').innerText = strat.sampleSize;

    renderChecklist(strat.checklist);

    const wrap = document.getElementById('strategy-detail-wrap');
    if (wrap) {
      wrap.classList.remove('hidden');
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function closeStrategyDetail() {
    activeStrategyId = null;
    const wrap = document.getElementById('strategy-detail-wrap');
    if (wrap) wrap.classList.add('hidden');
  }

  function renderChecklist(items) {
    const container = document.getElementById('strategy-checklist-area');
    if (!container) return;

    container.innerHTML = items.map((item, idx) => `
      <label class="journal-checklist-item">
        <input type="checkbox" data-checklist-idx="${idx}" onchange="onStrategyChecklistToggle(${items.length})">
        <span>${item}</span>
      </label>
    `).join('');

    updateChecklistResult(0, items.length);
  }

  function onStrategyChecklistToggle(totalItems) {
    const checked = document.querySelectorAll('#strategy-checklist-area input[type="checkbox"]:checked').length;
    updateChecklistResult(checked, totalItems);
  }

  function updateChecklistResult(checked, total) {
    const resultEl = document.getElementById('strategy-checklist-result');
    if (!resultEl) return;

    const allMet = total > 0 && checked === total;
    resultEl.innerHTML = `
      <span class="journal-grade-score">${checked} / ${total} conditions met</span>
      <span class="journal-grade-letter" style="color:${allMet ? '#1d9e75' : '#5f6b7a'}; font-size:16px;">${allMet ? 'Setup Valid \u2713' : 'Not Yet Confirmed'}</span>
    `;
  }

  function addStrategy() {
    const name = document.getElementById('st-name').value.trim();
    const author = document.getElementById('st-author').value.trim();
    const winRate = document.getElementById('st-winrate').value;
    const rrRatio = document.getElementById('st-rr').value.trim();
    const sampleSize = document.getElementById('st-sample').value;
    const description = document.getElementById('st-description').value.trim();
    const checklistRaw = document.getElementById('st-checklist').value.trim();

    const statusEl = document.getElementById('st-add-status');

    if (!name || !author || !checklistRaw) {
      if (statusEl) {
        statusEl.innerText = 'Strategy name, author, and at least one checklist item are required.';
        statusEl.style.color = '#d9381e';
      }
      return;
    }

    const checklist = checklistRaw.split('\n').map(line => line.trim()).filter(Boolean);

    STRATEGIES.push({
      id: `strat-${Date.now()}`,
      name,
      author,
      description: description || 'No description provided.',
      winRate: winRate ? parseFloat(winRate) : 0,
      rrRatio: rrRatio || '\u2014',
      sampleSize: sampleSize ? parseInt(sampleSize, 10) : 0,
      checklist,
    });

    if (statusEl) {
      statusEl.innerText = `"${name}" added to this session's strategy list.`;
      statusEl.style.color = '#1d9e75';
    }

    ['st-name', 'st-author', 'st-winrate', 'st-rr', 'st-sample', 'st-description', 'st-checklist'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    renderList();
  }

  window.openStrategyDetail = openStrategyDetail;
  window.closeStrategyDetail = closeStrategyDetail;
  window.onStrategyChecklistToggle = onStrategyChecklistToggle;
  window.addStrategy = addStrategy;

  renderList();

})();
/* === END COMPONENT: strategies (logic) === */