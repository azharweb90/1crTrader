/* ===========================================================
   COMPONENT: chart-prep
   Daily pre-market homework: mark today's key levels, set a bias from
   the open (auto-suggested, always overridable), get the one side
   you're allowed to trade today, and write the plan in your own words.

   Persists per calendar day (STORAGE_KEY, keyed by today's date) — leave
   the tab and come back later today and it's still there; opens blank
   again on the next trading day. Same "one JSON blob under one key"
   pattern as the rest of this app's per-feature localStorage usage.

   "Browse matching strategies" deep-links into the Strategies tab with a
   bias filter (window.setBiasFilter, added to strategies.js alongside
   this feature) rather than duplicating the strategy catalog here.

   Loaded lazily by app-shell.js the first time this tab opens.
   =========================================================== */

(function () {

  const STORAGE_KEY = 'cp_state_v1';

  // Selecting an open type always overwrites bias with its suggestion —
  // the trader can then click a different bias button to override it.
  // Matches the copy: "we've suggested X. Override if price says otherwise."
  const OPEN_TO_BIAS = { 'gap-up': 'bullish', 'flat': 'neutral', 'gap-down': 'bearish' };

  const OPEN_HINTS = {
    'gap-up': "A gap-up open usually sets a bullish tone — we've suggested Bullish. Override if price says otherwise.",
    'flat': "A flat open doesn't lean either way — we've suggested Neutral. Override if price says otherwise.",
    'gap-down': "A gap-down open usually sets a bearish tone — we've suggested Bearish. Override if price says otherwise.",
  };

  const LONG_SETUPS = [
    { name: 'Bullish FVG + Order Block', desc: 'Price dips to fill a fair-value gap into a demand order block — your prime long POI.' },
    { name: 'Breakout + retest', desc: 'Clean break above a key level, then a retest that holds it as support.' },
    { name: 'Trendline breakout (up)', desc: 'A falling trendline breaks to the upside and price holds above it.' },
  ];
  const SHORT_SETUPS = [
    { name: 'Bearish FVG + Order Block', desc: 'Price rallies to fill a fair-value gap into a supply order block — your prime short POI.' },
    { name: 'Breakdown + retest', desc: 'Clean break below a key level, then a retest that holds it as resistance.' },
    { name: 'Trendline breakdown (down)', desc: 'A rising trendline breaks to the downside and price holds below it.' },
  ];

  const LEVEL_IDS = { yh: 'cp-yh', yl: 'cp-yl', sh: 'cp-sh', sl: 'cp-sl', f5h: 'cp-f5h', f5l: 'cp-f5l' };

  let cpOpen = null;   // 'gap-up' | 'flat' | 'gap-down' | null
  let cpBias = null;   // 'bullish' | 'neutral' | 'bearish' | null
  let cpSideCollapsed = false; // local only, not persisted
  let levels = { yh: '', yl: '', sh: '', sl: '', f5h: '', f5l: '' };
  let cpPlan = '';

  function today() {
    return (typeof window.todayDateString === 'function') ? window.todayDateString() : new Date().toISOString().slice(0, 10);
  }

  function numOrNull(v) {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  // ---------- Persistence (per calendar day) ----------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.date !== today()) return; // a previous trading day's data — start fresh
      cpOpen = parsed.open || null;
      cpBias = parsed.bias || null;
      levels = {
        yh: parsed.yh || '', yl: parsed.yl || '', sh: parsed.sh || '', sl: parsed.sl || '',
        f5h: parsed.f5h || '', f5l: parsed.f5l || '',
      };
      cpPlan = parsed.plan || '';
    } catch (e) {
      // corrupted storage — ignore and start fresh rather than throwing
    }
  }

  function saveState() {
    const payload = {
      date: today(), open: cpOpen, bias: cpBias, plan: cpPlan,
      yh: levels.yh, yl: levels.yl, sh: levels.sh, sl: levels.sl, f5h: levels.f5h, f5l: levels.f5l,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  // ---------- The Open + Bias ----------
  function setChartPrepOpen(open) {
    cpOpen = open;
    cpBias = OPEN_TO_BIAS[open] || null;
    saveState();
    applyStateToDom();
  }

  function setChartPrepBias(bias) {
    cpBias = bias;
    saveState();
    applyStateToDom();
  }

  function renderOpenHint() {
    const el = document.getElementById('cp-open-hint');
    if (!el) return;
    el.innerText = cpOpen ? OPEN_HINTS[cpOpen] : "Mark how the market opened above, and we'll suggest a starting bias.";
  }

  // ---------- Key levels + plan ----------
  function onChartPrepLevelInput() {
    Object.keys(LEVEL_IDS).forEach(key => {
      const el = document.getElementById(LEVEL_IDS[key]);
      levels[key] = el ? el.value : '';
    });
    saveState();
    renderSideCard();
    renderSetupsCard();
  }

  function onChartPrepPlanInput() {
    const el = document.getElementById('cp-plan');
    cpPlan = el ? el.value : '';
    saveState();
  }

  // ---------- Your Side Today (collapsible) ----------
  function toggleChartPrepSide() {
    cpSideCollapsed = !cpSideCollapsed;
    const body = document.getElementById('cp-side-body');
    const chevron = document.getElementById('cp-side-pill-chevron');
    if (body) body.classList.toggle('cp-side-body-collapsed', cpSideCollapsed);
    if (chevron) chevron.classList.toggle('cp-side-pill-chevron-collapsed', cpSideCollapsed);
  }

  function renderSideCard() {
    const card = document.getElementById('cp-side-card');
    const pillText = document.getElementById('cp-side-pill-text');
    const headline = document.getElementById('cp-side-headline');
    const text = document.getElementById('cp-side-text');
    const triggerBox = document.getElementById('cp-side-trigger-box');
    const warningBox = document.getElementById('cp-side-warning-box');
    const warningText = document.getElementById('cp-side-warning-text');
    if (!card || !pillText || !headline || !text || !triggerBox || !warningBox) return;

    card.classList.remove('cp-side-bullish', 'cp-side-bearish', 'cp-side-neutral');

    const f5h = numOrNull(levels.f5h);
    const f5l = numOrNull(levels.f5l);
    const yl = numOrNull(levels.yl);
    const yh = numOrNull(levels.yh);
    const sh = numOrNull(levels.sh);
    const sl = numOrNull(levels.sl);

    if (cpBias === 'bullish') {
      card.classList.add('cp-side-bullish');
      pillText.innerText = 'BUY SIDE ONLY';
      headline.innerText = 'Trade the long side today';
      text.innerText = "Your read is bullish — so only take buy-side trades. Buy pullbacks into support and breakouts that hold above your levels. Same direction, all session.";

      if (f5h !== null && yl !== null) {
        triggerBox.classList.remove('hidden');
        triggerBox.innerText = `Longs trigger on a hold above ₹${fmt(f5h)}. Stand down below ₹${fmt(yl)} — that's where the read is wrong.`;
      } else if (sh !== null && sl !== null) {
        triggerBox.classList.remove('hidden');
        triggerBox.innerText = `Longs trigger on a hold above ₹${fmt(sh)}. Stand down below ₹${fmt(sl)} — that's where the read is wrong.`;
      } else {
        triggerBox.classList.add('hidden');
      }

      warningBox.classList.remove('hidden');
      warningText.innerText = 'Price will pull back and tempt you to flip short "because it has to reverse." That\'s trading against your own homework. If longs stop working, stand aside — you don\'t flip.';
    } else if (cpBias === 'bearish') {
      card.classList.add('cp-side-bearish');
      pillText.innerText = 'SELL SIDE ONLY';
      headline.innerText = 'Trade the short side today';
      text.innerText = "Your read is bearish — so only take sell-side trades. Sell rallies into resistance and breakdowns that hold below your levels. Same direction, all session.";

      if (f5l !== null && yh !== null) {
        triggerBox.classList.remove('hidden');
        triggerBox.innerText = `Shorts trigger on a hold below ₹${fmt(f5l)}. Stand down above ₹${fmt(yh)} — that's where the read is wrong.`;
      } else if (sl !== null && sh !== null) {
        triggerBox.classList.remove('hidden');
        triggerBox.innerText = `Shorts trigger on a hold below ₹${fmt(sl)}. Stand down above ₹${fmt(sh)} — that's where the read is wrong.`;
      } else {
        triggerBox.classList.add('hidden');
      }

      warningBox.classList.remove('hidden');
      warningText.innerText = 'Price will bounce and tempt you to flip long "because it has to reverse." That\'s trading against your own homework. If shorts stop working, stand aside — you don\'t flip.';
    } else if (cpBias === 'neutral') {
      card.classList.add('cp-side-neutral');
      pillText.innerText = 'STAY FLAT';
      headline.innerText = 'No clear side today';
      text.innerText = "Your read is neutral — no directional edge from the open. Either wait for a level to break before committing size, or trade smaller in both directions until one side proves itself.";

      if (sh !== null && sl !== null) {
        triggerBox.classList.remove('hidden');
        triggerBox.innerText = `Wait for a hold above ₹${fmt(sh)} for longs, or below ₹${fmt(sl)} for shorts — until then, this is a no-trade zone.`;
      } else {
        triggerBox.classList.add('hidden');
      }
      warningBox.classList.add('hidden');
    } else {
      card.classList.add('cp-side-neutral');
      pillText.innerText = 'PICK A BIAS';
      headline.innerText = "Set your bias to see today's side";
      text.innerText = "Mark how the market opened, or pick a bias directly, and we'll lay out which side you're allowed to trade today.";
      triggerBox.classList.add('hidden');
      warningBox.classList.add('hidden');
    }
  }

  // ---------- Setups to Hunt ----------
  function renderSetupsCard() {
    const labelEl = document.getElementById('cp-setups-label');
    const pillEl = document.getElementById('cp-setups-pill');
    const listEl = document.getElementById('cp-setups-list');
    const insetEl = document.getElementById('cp-setups-inset');
    const browseBtn = document.getElementById('cp-browse-btn');
    if (!labelEl || !listEl) return;

    if (cpBias === 'bullish' || cpBias === 'bearish') {
      const isLong = cpBias === 'bullish';
      const setups = isLong ? LONG_SETUPS : SHORT_SETUPS;

      labelEl.innerText = isLong ? 'LONG SETUPS TO HUNT' : 'SHORT SETUPS TO HUNT';
      if (pillEl) {
        pillEl.classList.remove('hidden');
        pillEl.classList.toggle('cp-setups-pill-short', !isLong);
        pillEl.innerText = isLong ? 'Min 3% upside to target' : 'Min 3% downside to target';
      }

      listEl.innerHTML = setups.map(s => `
        <div class="cp-setup-row">
          <span class="cp-setup-dot ${isLong ? '' : 'cp-setup-dot-short'}"></span>
          <div>
            <div class="cp-setup-name">${s.name}</div>
            <div class="cp-setup-desc">${s.desc}</div>
          </div>
        </div>
      `).join('');

      if (insetEl) {
        insetEl.classList.remove('hidden');
        insetEl.innerText = `Only take the ${isLong ? 'long' : 'short'} when price reaches the Point of Interest — never chase it mid-range.`;
      }
      if (browseBtn) browseBtn.classList.remove('hidden');
    } else {
      labelEl.innerText = 'SETUPS TO HUNT';
      if (pillEl) pillEl.classList.add('hidden');
      listEl.innerHTML = '<div class="roadmap-empty-state">Pick a bias above to see today’s setups to hunt.</div>';
      if (insetEl) insetEl.classList.add('hidden');
      if (browseBtn) browseBtn.classList.add('hidden');
    }
  }

  // Deep-links into Strategies filtered to today's direction. strategies.js
  // is lazy-loaded (only once that tab has been opened at least once this
  // session), so window.setBiasFilter may not exist yet the instant this
  // fires — poll briefly rather than assuming a fixed load time.
  function browseMatchingStrategies() {
    const bias = cpBias === 'bullish' ? 'Long' : (cpBias === 'bearish' ? 'Short' : 'all');
    if (typeof window.switchTab === 'function') {
      window.switchTab(null, 'tab-strategies');
    }
    let attempts = 0;
    const tryApply = () => {
      attempts++;
      if (typeof window.setBiasFilter === 'function') {
        window.setBiasFilter(bias);
      } else if (attempts < 20) {
        setTimeout(tryApply, 50);
      }
    };
    setTimeout(tryApply, 50);
  }

  // ---------- Date pill ----------
  function renderDatePill() {
    const el = document.getElementById('cp-date-pill');
    if (!el) return;
    const d = new Date();
    const weekday = d.toLocaleDateString('en-IN', { weekday: 'long' });
    const month = d.toLocaleDateString('en-IN', { month: 'long' });
    el.innerText = `${weekday} · ${d.getDate()} ${month} ${d.getFullYear()}`;
  }

  // ---------- Init ----------
  function applyStateToDom() {
    document.querySelectorAll('#cp-open-toggle .cp-open-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.open === cpOpen);
    });
    document.querySelectorAll('#cp-bias-toggle .cp-bias-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bias === cpBias);
    });
    Object.keys(LEVEL_IDS).forEach(key => {
      const el = document.getElementById(LEVEL_IDS[key]);
      if (el && document.activeElement !== el) el.value = levels[key];
    });
    const planEl = document.getElementById('cp-plan');
    if (planEl && document.activeElement !== planEl) planEl.value = cpPlan;

    renderOpenHint();
    renderSideCard();
    renderSetupsCard();
  }

  function renderAll() {
    loadState();
    renderDatePill();
    applyStateToDom();
  }

  window.setChartPrepOpen = setChartPrepOpen;
  window.setChartPrepBias = setChartPrepBias;
  window.onChartPrepLevelInput = onChartPrepLevelInput;
  window.onChartPrepPlanInput = onChartPrepPlanInput;
  window.toggleChartPrepSide = toggleChartPrepSide;
  window.browseMatchingStrategies = browseMatchingStrategies;
  window.renderChartPrep = renderAll;

  renderAll();

})();
/* === END COMPONENT: chart-prep === */
