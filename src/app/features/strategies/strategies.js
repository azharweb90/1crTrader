/* ===========================================================
   COMPONENT: strategies (logic)
   Loaded lazily by app-shell.js the first time this tab opens.

   Rebuilt to match the Claude Design "Strategies" mockup (see
   docs/architecture/ for context): a filterable card library (category +
   "My strategies"), a rich read-only detail page per strategy (community
   win ratio, trader ratings + distribution, rate-this-playbook widget),
   and a "Create your own strategy" editor that publishes into "My
   strategies", gated by capital tier (see CREATE_CAP_BY_TIER below).

   DEMO SCOPE: single-session model, same as before — user-created
   strategies live only in this browser tab's memory (OWN_STRATEGIES
   array). No backend/multi-user sharing yet. Catalog strategies (the 9
   seeded ones) are static reference data, not user-editable.
   =========================================================== */

(function () {

  // ---------- Category display metadata (color classes map to strategies.css) ----------
  const CATEGORY_META = {
    breakout: { label: 'Breakout', cls: 'strat-cat-breakout' },
    trend: { label: 'Trend', cls: 'strat-cat-trend' },
    reversal: { label: 'Reversal', cls: 'strat-cat-reversal' },
    options: { label: 'Options', cls: 'strat-cat-options' },
    scalping: { label: 'Scalping', cls: 'strat-cat-scalping' },
  };

  const DIFFICULTY_CLS = {
    Beginner: 'strat-level-beginner',
    Intermediate: 'strat-level-intermediate',
    Advanced: 'strat-level-advanced',
  };

  // How many strategies each tier may publish to "My strategies" before
  // Create strategy is disabled and the upgrade banner shows instead.
  // Small is capped at 1 on purpose (per the design's gating requirement);
  // higher tiers get progressively more room, matching the same
  // "higher tier = more room" pattern used by the risk-rules ladder
  // elsewhere in the app (see shared/risk-engine/tier-rules.js).
  const CREATE_CAP_BY_TIER = {
    small: 1,
    medium: 3,
    large: 10,
    pro: Infinity,
  };

  // ---------- Catalog (the 9 official, non-editable strategies) ----------
  const CATALOG = [
    {
      id: 'orb', category: 'breakout', name: 'Opening Range Breakout',
      summary: 'Mark the high and low of the first 15 minutes, then trade a clean break of that range in the direction of the day’s momentum.',
      bias: 'Both', timeframe: '5-15 min', targetRR: '1:2', difficulty: 'Beginner',
      winRate: 63, sample: 412, avgR: '+0.9R', rating: 4.0, ratingCount: 412, communityFavourite: true,
      overview: 'The opening range captures the first burst of order flow for the session. A decisive break of that range often sets the tone for the next few hours of trade.',
      idealConditions: 'Works best on trending, high-volume mornings — index futures or liquid stocks. Avoid it on flat, indecisive opens where the range keeps getting swept on both sides.',
      entryStop: 'Enter on a candle close beyond the range with supporting volume. Stop sits just inside the opposite edge of the range; first target is one range-width out.',
      commonMistakes: 'Chasing the very first spike, ignoring a fake break that snaps back inside the range, and widening the stop the moment price hesitates.',
      chartCaption: 'A valid break: price coils inside the first-15-minute range, then closes decisively beyond it on a clear volume expansion — not a single wick poking through and snapping back.',
      checklist: [
        'First 15 min range high and low are clearly marked',
        'Price closed beyond the range — not just wicked through it',
        'The break came with a visible volume expansion',
        'Index / broader market is trending, not chopping sideways',
        'Stop fits inside the opposite range edge, and within my risk limit',
      ],
    },
    {
      id: 'gap-go', category: 'breakout', name: 'Gap & Go',
      summary: 'Trade the continuation of a strong opening gap once price breaks the first pullback high on volume.',
      bias: 'Long', timeframe: '1-5 min', targetRR: '1:2', difficulty: 'Intermediate',
      winRate: 58, sample: 286, avgR: '+0.6R', rating: 3.9, ratingCount: 286, communityFavourite: false,
      overview: 'A strong gap shows real overnight conviction. The first pullback after the open lets late buyers in without chasing the initial spike.',
      idealConditions: 'Best on stocks gapping 3%+ on real news with high relative volume. Avoid low-float names prone to violent whipsaws or gaps with no clear catalyst.',
      entryStop: 'Wait for the first pullback to hold above the gap-fill zone, then enter on a break of the pullback high. Stop goes below the pullback low.',
      commonMistakes: 'Buying the initial spike with no pullback, holding through a break of the pullback low hoping for a recovery, and ignoring an early full gap-fill.',
      chartCaption: 'A valid setup: a clean gap up, a shallow pullback that holds above the gap-fill line, then a break of the pullback high with volume picking back up.',
      checklist: [
        'Gap is 3%+ with a real catalyst behind it',
        'Relative volume is well above average',
        'Pullback held above the gap-fill zone',
        'Break of the pullback high on rising volume',
      ],
    },
    {
      id: 'trend-pullback', category: 'trend', name: 'Trend Pullback to 20 EMA',
      summary: 'In an established trend, buy the pullback into the 20 EMA rather than chasing the breakout highs.',
      bias: 'Both', timeframe: '15 min-1 h', targetRR: '1:2.5', difficulty: 'Beginner',
      winRate: 66, sample: 534, avgR: '+1.1R', rating: 4.2, ratingCount: 534, communityFavourite: true,
      overview: 'Established trends tend to respect a moving average on pullbacks. Buying that pullback offers a better entry price and a clean, nearby invalidation level.',
      idealConditions: 'Works best in a clear, established trend with the 20 EMA sloping steadily. Avoid it in choppy, range-bound conditions where the average keeps getting sliced through.',
      entryStop: 'Enter as price tags the 20 EMA and prints a rejection candle in the trend direction. Stop sits just beyond the EMA on the other side.',
      commonMistakes: 'Entering before the rejection candle confirms, trading it against a flattening or rolling-over average, and moving the stop further away after entry.',
      chartCaption: 'A valid pullback: price respects the 20 EMA with a clean rejection wick, then resumes in the direction of the established trend.',
      checklist: [
        'A clear, established trend is in place on the higher timeframe',
        'The 20 EMA is sloping steadily, not flat or rolling over',
        'Price tagged the EMA and printed a rejection candle',
        'Stop fits just beyond the EMA within my risk limit',
      ],
    },
    {
      id: 'bull-flag', category: 'trend', name: 'Bull Flag Continuation',
      summary: 'After a strong up-move, trade the break of the tight consolidation — the “flag” — that follows.',
      bias: 'Long', timeframe: '5-15 min', targetRR: '1:2', difficulty: 'Intermediate',
      winRate: 60, sample: 318, avgR: '+0.7R', rating: 4.0, ratingCount: 318, communityFavourite: false,
      overview: 'A sharp move followed by a tight, low-volume consolidation often means the move isn’t over — it’s just pausing before continuing.',
      idealConditions: 'Best after a strong, high-volume flagpole move with volume drying up during the flag itself. Avoid flags that are too wide or too long — they stop behaving like a pause.',
      entryStop: 'Enter on a break of the flag’s upper trendline with volume returning. Stop sits below the low of the flag.',
      commonMistakes: 'Entering inside the flag before the break, trading flags that have dragged on too long, and ignoring volume that never picks back up on the break.',
      chartCaption: 'A valid flag: a sharp flagpole move, a tight downward-drifting consolidation on fading volume, then a break of the flag high with volume returning.',
      checklist: [
        'A strong, high-volume flagpole move preceded the flag',
        'Volume dried up during the flag itself',
        'The flag stayed tight and did not drag on too long',
        'Break of the flag high came with volume returning',
      ],
    },
    {
      id: 'vwap-reversion', category: 'reversal', name: 'VWAP Reversion',
      summary: 'Fade an over-extended move back toward VWAP when price stretches far from it with no news behind the run.',
      bias: 'Both', timeframe: '5-15 min', targetRR: '1:1.5', difficulty: 'Intermediate',
      winRate: 54, sample: 241, avgR: '+0.4R', rating: 3.8, ratingCount: 241, communityFavourite: false,
      overview: 'Price rarely stays stretched far from VWAP without a real catalyst. An extended, news-less move tends to mean-revert back toward it.',
      idealConditions: 'Best when price is 1%+ away from VWAP with no news driving the move and momentum visibly fading. Avoid it on genuine news-driven trend days.',
      entryStop: 'Enter on the first clear rejection candle against the extension, targeting a move back toward VWAP. Stop sits just beyond the rejection wick.',
      commonMistakes: 'Fading a move that has real news behind it, entering before momentum actually shows signs of fading, and holding through a fresh push to new extremes.',
      chartCaption: 'A valid fade: price stretched well away from VWAP, momentum visibly fading, and a clear rejection candle forming against the extension.',
      checklist: [
        'Price is stretched 1%+ away from VWAP',
        'No real news or catalyst is driving the move',
        'Momentum is visibly fading, not accelerating',
        'A clear rejection candle has formed against the extension',
      ],
    },
    {
      id: 'sr-reversal', category: 'reversal', name: 'Support / Resistance Reversal',
      summary: 'Trade the rejection at a well-tested level, entering only after price confirms the turn instead of predicting it.',
      bias: 'Both', timeframe: '15 min', targetRR: '1:2', difficulty: 'Beginner',
      winRate: 61, sample: 377, avgR: '+0.8R', rating: 4.0, ratingCount: 377, communityFavourite: false,
      overview: 'A level tested multiple times and held builds real significance. Waiting for confirmation there beats trying to guess a reversal in advance.',
      idealConditions: 'Best at levels tested at least twice before, with a clean rejection candle on the latest touch. Avoid levels that have already been sliced through recently.',
      entryStop: 'Wait for a confirmed rejection candle at the level before entering in the reversal direction. Stop sits just beyond the level, past the rejection wick.',
      commonMistakes: 'Entering before the rejection confirms, trading a level that has already failed once recently, and placing the stop too tight to survive normal noise.',
      chartCaption: 'A valid reversal: a well-tested level, a clean rejection candle on the latest touch, and price confirming the turn before entry.',
      checklist: [
        'The level has been tested at least twice before',
        'A clean rejection candle formed on the latest touch',
        'The level has not been sliced through recently',
        'Stop fits just beyond the level within my risk limit',
      ],
    },
    {
      id: 'bull-call-spread', category: 'options', name: 'Bull Call Spread',
      summary: 'Buy a call and sell a higher strike call to take a defined-risk bullish view at a lower net cost.',
      bias: 'Long', timeframe: 'Positional', targetRR: 'Defined', difficulty: 'Intermediate',
      winRate: 57, sample: 164, avgR: '+0.5R', rating: 4.0, ratingCount: 164, communityFavourite: false,
      overview: 'Selling the higher strike call lowers the cost of the long call, trading away unlimited upside for a defined, known-in-advance max profit and max loss.',
      idealConditions: 'Best with a moderately bullish view and a target price in mind. Avoid it if you expect an explosive move well past the short strike — the spread caps that upside.',
      entryStop: 'Buy the lower strike call, sell a higher strike call in the same expiry. Max loss is the net premium paid; max profit is the strike width minus that premium.',
      commonMistakes: 'Picking a short strike too close to spot (capping upside too early), ignoring time decay working against the long leg, and holding into expiry without a plan.',
      chartCaption: 'A valid setup: spot trading below the long strike with a moderately bullish structure, room to run toward the short strike before expiry.',
      checklist: [
        'View is moderately bullish, not expecting an explosive move',
        'Strike width and net premium give an acceptable risk:reward',
        'Enough time to expiry for the thesis to play out',
        'Max loss is within today’s risk limit',
      ],
    },
    {
      id: 'iron-condor', category: 'options', name: 'Iron Condor',
      summary: 'Sell an out-of-the-money call spread and put spread to profit from a range-bound, low-volatility market.',
      bias: 'Both', timeframe: 'Positional', targetRR: 'Defined', difficulty: 'Advanced',
      winRate: 68, sample: 195, avgR: '+0.4R', rating: 4.2, ratingCount: 195, communityFavourite: false,
      overview: 'Selling both a call spread and a put spread collects premium from a market expected to stay inside a range, profiting from time decay and stable volatility.',
      idealConditions: 'Best in a low-volatility, range-bound market with no major event risk before expiry. Avoid it heading into results, policy announcements, or other known volatility spikes.',
      entryStop: 'Sell equidistant call and put spreads outside the expected range. Max loss is the wider spread’s width minus premium collected; manage or close if either side is tested.',
      commonMistakes: 'Placing strikes too close to spot for the premium collected, holding through a known event that can blow through a short strike, and not having an exit plan if one side is tested early.',
      chartCaption: 'A valid setup: price contained inside a range for several sessions, both short strikes comfortably outside recent swing highs and lows.',
      checklist: [
        'Market has been range-bound for several sessions',
        'No major event risk before expiry',
        'Both short strikes sit outside recent swing highs and lows',
        'Max loss on either side is within today’s risk limit',
      ],
    },
    {
      id: 'momentum-scalp', category: 'scalping', name: 'Momentum Scalp',
      summary: 'Take fast, small trades on lower-timeframe momentum bursts — in and out within minutes.',
      bias: 'Both', timeframe: '1-3 min', targetRR: '1:1.5', difficulty: 'Advanced',
      winRate: 49, sample: 223, avgR: '+0.2R', rating: 3.4, ratingCount: 223, communityFavourite: false,
      overview: 'Short, sharp momentum bursts on the lowest timeframes offer frequent, fast opportunities — at the cost of a lower win rate and a much higher required discipline.',
      idealConditions: 'Best on high-liquidity instruments during active session hours with visible order-flow bursts. Avoid it in thin, choppy, low-volume stretches of the day.',
      entryStop: 'Enter directly into the momentum burst with a tight, mechanical stop. Exit quickly on target or the moment momentum stalls — do not wait it out.',
      commonMistakes: 'Widening a tight stop "to give it room", overtrading in thin conditions, and holding a scalp past its intended window hoping it turns into a bigger trade.',
      chartCaption: 'A valid scalp: a sharp, high-volume momentum burst with a tight, clearly defined stop level right at entry.',
      checklist: [
        'Trading during active session hours with real liquidity',
        'A visible, high-volume momentum burst is underway',
        'Stop is tight and mechanical, decided before entry',
        'I have an exit plan the moment momentum stalls',
      ],
    },
  ];

  // Rating distributions for the detail-page bar chart. Only "orb" was
  // confirmed against the mockup directly; the rest are derived from each
  // strategy's own average rating using the same shape (skewed toward the
  // top two bars) so every strategy has a plausible-looking breakdown.
  function ratingDistribution(avg) {
    if (avg >= 4.0) return { 5: 42, 4: 33, 3: 16, 2: 6, 1: 3 };
    if (avg >= 3.8) return { 5: 34, 4: 32, 3: 20, 2: 9, 1: 5 };
    return { 5: 22, 4: 28, 3: 26, 2: 15, 1: 9 };
  }

  // ---------- User-created strategies ("My strategies") ----------
  // In-memory only, same as the rest of this prototype's user content
  // (see "Known Platform Gaps" in docs/architecture/SESSION_SUMMARY.md).
  let OWN_STRATEGIES = [];
  let ownIdCounter = 1;

  let activeFilter = 'all';   // 'all' | category key | 'mine'
  let activeStrategyId = null;
  let starRatingsGiven = {};  // { [id]: 1-5 }  local "rate this playbook" input, session-only
  let viewDensity = 'small';  // 'small' | 'large' — cosmetic grid density toggle

  function allStrategies() {
    return CATALOG.concat(OWN_STRATEGIES);
  }

  function getStrategy(id) {
    return allStrategies().find(s => s.id === id);
  }

  function getTier() {
    const state = (typeof window.getProfileState === 'function') ? window.getProfileState() : {};
    return state.tier || null;
  }

  function createCap() {
    const tier = getTier();
    if (!tier || !(tier in CREATE_CAP_BY_TIER)) return 1; // no profile yet — most conservative cap
    return CREATE_CAP_BY_TIER[tier];
  }

  function starHtml(rating, size) {
    const full = Math.round(rating);
    let out = '';
    for (let i = 1; i <= 5; i++) {
      out += `<span class="strat-star${i <= full ? ' strat-star-filled' : ''}" style="font-size:${size || 13}px;">★</span>`;
    }
    return out;
  }

  // ---------- List / grid ----------
  function renderList() {
    const grid = document.getElementById('strategies-grid');
    const empty = document.getElementById('strategies-empty');
    const counterEl = document.getElementById('strategies-created-counter');
    const createBtn = document.getElementById('strategies-create-btn');
    if (!grid) return;

    const cap = createCap();
    const ownCount = OWN_STRATEGIES.length;
    if (counterEl) counterEl.innerText = cap === Infinity ? `${ownCount} created` : `${ownCount} of ${cap} created`;
    if (createBtn) createBtn.disabled = ownCount >= cap;

    let list = allStrategies();
    if (activeFilter === 'mine') {
      list = OWN_STRATEGIES;
    } else if (activeFilter !== 'all') {
      list = list.filter(s => s.category === activeFilter);
    }

    if (list.length === 0) {
      grid.innerHTML = '';
      if (empty) {
        empty.classList.remove('hidden');
        empty.innerText = activeFilter === 'mine'
          ? 'You haven’t created a strategy yet. Use "+ Create strategy" above to write your first one.'
          : 'No strategies in this category yet.';
      }
      return;
    }
    if (empty) empty.classList.add('hidden');

    grid.className = 'strategies-grid' + (viewDensity === 'large' ? ' strategies-grid-large' : '');
    grid.innerHTML = list.map(s => {
      const cat = CATEGORY_META[s.category] || { label: s.category, cls: '' };
      const isOwn = !!s.isOwn;
      return `
      <button type="button" class="strategy-card ${cat.cls}" onclick="openStrategyDetail('${s.id}')">
        <div class="strategy-card-topbar"></div>
        <div class="strategy-card-body">
          <div class="strategy-card-head">
            <span class="strat-badge ${cat.cls}-badge">${cat.label.toUpperCase()}</span>
            <span class="strat-star-toggle">★</span>
          </div>
          <div class="strategy-card-name">${s.name}</div>
          <div class="strategy-card-desc">${s.summary}</div>
          <div class="strategy-card-metrics">
            <div class="strat-metric"><span class="strat-metric-label">Win Rate</span><span class="strat-metric-value">${s.winRate}%</span></div>
            <div class="strat-metric"><span class="strat-metric-label">Timeframe</span><span class="strat-metric-value">${s.timeframe}</span></div>
            <div class="strat-metric"><span class="strat-metric-label">Target</span><span class="strat-metric-value">${s.targetRR}</span></div>
          </div>
          <div class="strategy-card-foot">
            <div class="strat-rating-row">
              ${isOwn && !s.ratingCount ? '<span class="strat-not-rated">Not yet rated</span>' : `${starHtml(s.rating)}<span class="strat-rating-num">${s.rating.toFixed(1)}</span><span class="strat-rating-count">(${s.ratingCount})</span>`}
            </div>
            <span class="strat-level-badge ${DIFFICULTY_CLS[s.difficulty] || ''}">${s.difficulty}</span>
          </div>
        </div>
      </button>`;
    }).join('');
  }

  function setFilter(filter, btn) {
    activeFilter = filter;
    document.querySelectorAll('.strat-filter-pill').forEach(p => p.classList.remove('strat-filter-active'));
    if (btn) btn.classList.add('strat-filter-active');
    renderList();
  }

  function setViewDensity(density, btn) {
    viewDensity = density;
    document.querySelectorAll('.strat-density-btn').forEach(b => b.classList.remove('strat-density-active'));
    if (btn) btn.classList.add('strat-density-active');
    renderList();
  }

  // ---------- Detail page ----------
  function openStrategyDetail(id) {
    const s = getStrategy(id);
    if (!s) return;
    activeStrategyId = id;

    const cat = CATEGORY_META[s.category] || { label: s.category, cls: '' };
    const isOwn = !!s.isOwn;
    const dist = isOwn ? null : ratingDistribution(s.rating);
    const myRating = starRatingsGiven[id] || 0;

    document.getElementById('strat-detail-badges').innerHTML = `
      <span class="strat-badge ${cat.cls}-badge">${cat.label.toUpperCase()}</span>
      <span class="strat-level-badge ${DIFFICULTY_CLS[s.difficulty] || ''}">${s.difficulty}</span>
      ${s.communityFavourite ? '<span class="strat-fav-badge">Community Favourite</span>' : ''}
    `;
    document.getElementById('strat-detail-name').innerText = s.name;
    document.getElementById('strat-detail-summary').innerText = s.summary;
    document.getElementById('strat-detail-metrics').innerHTML = `
      <div class="strat-metric"><span class="strat-metric-label">Bias</span><span class="strat-metric-value">${s.bias}</span></div>
      <div class="strat-metric"><span class="strat-metric-label">Timeframe</span><span class="strat-metric-value">${s.timeframe}</span></div>
      <div class="strat-metric"><span class="strat-metric-label">Target R:R</span><span class="strat-metric-value">${s.targetRR}</span></div>
      <div class="strat-metric"><span class="strat-metric-label">Level</span><span class="strat-metric-value">${s.difficulty}</span></div>
    `;
    document.getElementById('strat-detail-chart-caption').innerText = s.chartCaption;
    document.getElementById('strat-detail-overview').innerText = s.overview;
    document.getElementById('strat-detail-ideal').innerText = s.idealConditions;
    document.getElementById('strat-detail-entry').innerText = s.entryStop;
    document.getElementById('strat-detail-mistakes').innerText = s.commonMistakes;

    // Right rail: community stats hidden entirely for a brand-new, unrated
    // own strategy (nothing to show yet); shown normally otherwise.
    const communityWrap = document.getElementById('strat-detail-community-wrap');
    if (isOwn && !s.ratingCount) {
      communityWrap.classList.add('hidden');
    } else {
      communityWrap.classList.remove('hidden');
      document.getElementById('strat-detail-winratio').innerText = `${s.winRate}%`;
      document.getElementById('strat-detail-sample').innerText = `${s.sample} trades`;
      document.getElementById('strat-detail-avgr').innerText = s.avgR;
      document.getElementById('strat-detail-rating-num').innerText = s.rating.toFixed(1);
      document.getElementById('strat-detail-rating-count').innerText = `${s.ratingCount} ratings`;
      document.getElementById('strat-detail-rating-stars').innerHTML = starHtml(s.rating, 15);
      document.getElementById('strat-detail-fav-pill').classList.toggle('hidden', !s.communityFavourite);
      document.getElementById('strat-detail-dist').innerHTML = dist ? [5, 4, 3, 2, 1].map(n => `
        <div class="strat-dist-row">
          <span class="strat-dist-label">${n}★</span>
          <div class="strat-dist-track"><div class="strat-dist-fill" style="width:${dist[n]}%;"></div></div>
          <span class="strat-dist-pct">${dist[n]}%</span>
        </div>`).join('') : '';
    }

    // "Rate this playbook" — session-only, updates the star display live.
    document.getElementById('strat-detail-rate-stars').innerHTML = [1, 2, 3, 4, 5].map(n => `
      <span class="strat-rate-star${n <= myRating ? ' strat-rate-star-active' : ''}" onclick="rateStrategy('${id}', ${n})">★</span>
    `).join('');

    renderChecklist(s.checklist);

    document.getElementById('strategies-grid-wrap').classList.add('hidden');
    document.getElementById('strategy-editor-wrap').classList.add('hidden');
    document.getElementById('strategy-detail-wrap').classList.remove('hidden');
    document.getElementById('strategy-detail-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function rateStrategy(id, stars) {
    starRatingsGiven[id] = stars;
    openStrategyDetail(id); // cheap re-render to reflect the new star state
  }

  function closeStrategyDetail() {
    activeStrategyId = null;
    document.getElementById('strategy-detail-wrap').classList.add('hidden');
    document.getElementById('strategies-grid-wrap').classList.remove('hidden');
    renderList();
  }

  function renderChecklist(items) {
    const container = document.getElementById('strat-detail-checklist-area');
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
    const checked = document.querySelectorAll('#strat-detail-checklist-area input[type="checkbox"]:checked').length;
    updateChecklistResult(checked, totalItems);
  }

  function updateChecklistResult(checked, total) {
    const el = document.getElementById('strat-detail-checklist-count');
    if (el) el.innerText = `${checked} / ${total} confirmed`;
  }

  // ---------- Create-strategy editor ----------
  let editorChecklistCount = 0;

  function openStrategyEditor() {
    if (OWN_STRATEGIES.length >= createCap()) return; // guarded by disabled button too
    editorChecklistCount = 0;
    ['ed-name', 'ed-timeframe', 'ed-target', 'ed-summary', 'ed-overview', 'ed-ideal', 'ed-entry', 'ed-mistakes', 'ed-chart-caption'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const checklistWrap = document.getElementById('ed-checklist-rows');
    if (checklistWrap) checklistWrap.innerHTML = '';
    addChecklistRow(); addChecklistRow(); addChecklistRow();
    updatePublishState();

    document.getElementById('strategies-grid-wrap').classList.add('hidden');
    document.getElementById('strategy-detail-wrap').classList.add('hidden');
    document.getElementById('strategy-editor-wrap').classList.remove('hidden');
    document.getElementById('strategy-editor-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeStrategyEditor() {
    document.getElementById('strategy-editor-wrap').classList.add('hidden');
    document.getElementById('strategies-grid-wrap').classList.remove('hidden');
  }

  function addChecklistRow() {
    editorChecklistCount++;
    const id = editorChecklistCount;
    const wrap = document.getElementById('ed-checklist-rows');
    if (!wrap) return;
    const row = document.createElement('div');
    row.className = 'ed-checklist-row';
    row.dataset.rowId = id;
    row.innerHTML = `
      <input type="checkbox" disabled>
      <input type="text" class="journal-input ed-checklist-input" placeholder="e.g. Break confirmed with volume expansion" oninput="updatePublishState()">
      <button type="button" class="ed-checklist-remove" onclick="removeChecklistRow(${id})">&times;</button>
    `;
    wrap.appendChild(row);
  }

  function removeChecklistRow(id) {
    const row = document.querySelector(`.ed-checklist-row[data-row-id="${id}"]`);
    if (row) row.remove();
    updatePublishState();
  }

  function updatePublishState() {
    const name = (document.getElementById('ed-name') || {}).value || '';
    const summary = (document.getElementById('ed-summary') || {}).value || '';
    const entry = (document.getElementById('ed-entry') || {}).value || '';
    const checklistItems = Array.from(document.querySelectorAll('.ed-checklist-input')).map(i => i.value.trim()).filter(Boolean);

    const ready = name.trim() && summary.trim() && entry.trim() && checklistItems.length > 0;
    const btn = document.getElementById('ed-publish-btn');
    if (btn) btn.disabled = !ready;
    return ready;
  }

  function publishStrategy() {
    if (!updatePublishState()) return;
    if (OWN_STRATEGIES.length >= createCap()) return;

    const category = document.getElementById('ed-category').value;
    const bias = document.getElementById('ed-bias').value;
    const difficulty = document.getElementById('ed-difficulty').value;
    const checklist = Array.from(document.querySelectorAll('.ed-checklist-input')).map(i => i.value.trim()).filter(Boolean);

    const id = `own-${ownIdCounter++}`;
    OWN_STRATEGIES.push({
      id, category, bias, difficulty,
      name: document.getElementById('ed-name').value.trim(),
      timeframe: document.getElementById('ed-timeframe').value.trim() || '—',
      targetRR: document.getElementById('ed-target').value.trim() || '—',
      summary: document.getElementById('ed-summary').value.trim(),
      overview: document.getElementById('ed-overview').value.trim() || 'No overview provided.',
      idealConditions: document.getElementById('ed-ideal').value.trim() || 'Not specified.',
      entryStop: document.getElementById('ed-entry').value.trim(),
      commonMistakes: document.getElementById('ed-mistakes').value.trim() || 'Not specified.',
      chartCaption: document.getElementById('ed-chart-caption').value.trim() || 'No chart pattern description provided.',
      checklist,
      winRate: 0, sample: 0, avgR: '—', rating: 0, ratingCount: 0, communityFavourite: false,
      isOwn: true,
    });

    closeStrategyEditor();
    setFilter('mine', document.querySelector('.strat-filter-pill[data-filter="mine"]'));
  }

  window.openStrategyDetail = openStrategyDetail;
  window.closeStrategyDetail = closeStrategyDetail;
  window.onStrategyChecklistToggle = onStrategyChecklistToggle;
  window.rateStrategy = rateStrategy;
  window.setFilter = setFilter;
  window.setViewDensity = setViewDensity;
  window.openStrategyEditor = openStrategyEditor;
  window.closeStrategyEditor = closeStrategyEditor;
  window.addChecklistRow = addChecklistRow;
  window.removeChecklistRow = removeChecklistRow;
  window.updatePublishState = updatePublishState;
  window.publishStrategy = publishStrategy;

  renderList();

})();
/* === END COMPONENT: strategies (logic) === */