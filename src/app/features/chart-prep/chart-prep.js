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

  // Placeholder examples shown (greyed) in the 5 empty "My rules" step
  // inputs — steps 1/2/5 read the same either direction; only the
  // stop-loss/target steps (3/4) mirror for a short.
  const RULE_PLACEHOLDERS_LONG = [
    'e.g. I will find a 5-min FVG',
    'e.g. Refine it down to a 1-min FVG',
    'e.g. Stop-loss just below the order block',
    'e.g. Reward target = the swing high',
    'e.g. Only enter at the Point of Interest',
  ];
  const RULE_PLACEHOLDERS_SHORT = [
    'e.g. I will find a 5-min FVG',
    'e.g. Refine it down to a 1-min FVG',
    'e.g. Stop-loss just above the order block',
    'e.g. Reward target = the swing low',
    'e.g. Only enter at the Point of Interest',
  ];
  const RULE_STEP_COUNT = 5;

  const LEVEL_IDS = { yh: 'cp-yh', yl: 'cp-yl', sh: 'cp-sh', sl: 'cp-sl', f5h: 'cp-f5h', f5l: 'cp-f5l' };

  let cpOpen = null;   // 'gap-up' | 'flat' | 'gap-down' | null
  let cpBias = null;   // 'bullish' | 'neutral' | 'bearish' | null
  let cpSideCollapsed = false; // local only, not persisted
  let levels = { yh: '', yl: '', sh: '', sl: '', f5h: '', f5l: '' };
  let ruleSteps = ['', '', '', '', '']; // "My rules" 5-step entry checklist for today
  let ruleName = ''; // "Save these rules as a strategy" name field
  let cpSetupsTab = 'mine'; // 'mine' | 'strategy' — local only, not persisted
  let lmrText = ''; // Pre-market read textarea — persisted like everything else here

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
      ruleSteps = Array.isArray(parsed.ruleSteps) && parsed.ruleSteps.length === RULE_STEP_COUNT
        ? parsed.ruleSteps
        : ['', '', '', '', ''];
      ruleName = parsed.ruleName || '';
      lmrText = parsed.lmrText || '';
    } catch (e) {
      // corrupted storage — ignore and start fresh rather than throwing
    }
  }

  function saveState() {
    const payload = {
      date: today(), open: cpOpen, bias: cpBias, ruleSteps, ruleName, lmrText,
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

  // ---------- Pre-market read (shared matcher with Trade Manager) ----------
  let lmrDebounceTimer = null;
  function onChartPrepLiveReadInput() {
    const el = document.getElementById('cp-lmr-input');
    lmrText = el ? el.value : '';
    saveState();
    clearTimeout(lmrDebounceTimer);
    lmrDebounceTimer = setTimeout(renderChartPrepLiveRead, 550);
  }

  function renderChartPrepLiveRead() {
    const chipsEl = document.getElementById('cp-lmr-chips');
    if (!chipsEl) return;
    if (!lmrText.trim()) { chipsEl.innerHTML = ''; return; }
    if (typeof window.analyzeLiveMarketRead !== 'function' || typeof window.renderLiveMarketReadChips !== 'function') return;
    const matches = window.analyzeLiveMarketRead(lmrText);
    window.renderLiveMarketReadChips(chipsEl, matches, "Add more detail — trend direction, a key level, or how you're feeling — for a sharper read.");
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
  // Ensures Strategies' script is loaded (it's a separate lazy-loaded tab)
  // before calling one of its window.* functions — see the comment on
  // window.preloadTab in app-shell.js for why this is safe to call
  // repeatedly and can't double-load or reset that tab's state.
  function ensureStrategiesReady() {
    if (typeof window.preloadTab === 'function') {
      return Promise.resolve(window.preloadTab('tab-strategies'));
    }
    return Promise.resolve();
  }

  function biasForStrategyLookup() {
    return cpBias === 'bullish' ? 'Long' : (cpBias === 'bearish' ? 'Short' : 'all');
  }

  function renderSetupsCard() {
    const labelEl = document.getElementById('cp-setups-label');
    const pillEl = document.getElementById('cp-setups-pill');
    const emptyEl = document.getElementById('cp-setups-empty');
    const bodyEl = document.getElementById('cp-setups-body');
    const insetEl = document.getElementById('cp-setups-inset');
    const browseBtn = document.getElementById('cp-browse-btn');
    if (!labelEl || !bodyEl || !emptyEl) return;

    if (cpBias === 'bullish' || cpBias === 'bearish') {
      const isLong = cpBias === 'bullish';

      labelEl.innerText = isLong ? 'LONG SETUPS TO HUNT' : 'SHORT SETUPS TO HUNT';
      if (pillEl) {
        pillEl.classList.remove('hidden');
        pillEl.classList.toggle('cp-setups-pill-short', !isLong);
        pillEl.innerText = isLong ? 'Min 3% upside to target' : 'Min 3% downside to target';
      }
      emptyEl.classList.add('hidden');
      bodyEl.classList.remove('hidden');

      renderRulesList();
      updateSaveButtonState();
      if (cpSetupsTab === 'strategy') renderStrategyPanel();

      if (insetEl) {
        insetEl.classList.remove('hidden');
        insetEl.innerText = `Only take the ${isLong ? 'long' : 'short'} when price reaches the Point of Interest — never chase it mid-range.`;
      }
      if (browseBtn) browseBtn.classList.remove('hidden');
    } else {
      labelEl.innerText = 'SETUPS TO HUNT';
      if (pillEl) pillEl.classList.add('hidden');
      emptyEl.classList.remove('hidden');
      bodyEl.classList.add('hidden');
      if (insetEl) insetEl.classList.add('hidden');
      if (browseBtn) browseBtn.classList.add('hidden');
    }
  }

  function setChartPrepSetupsTab(tab) {
    cpSetupsTab = tab;
    document.querySelectorAll('#cp-setups-tab-toggle .cp-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.setupstab === tab);
    });
    const rulesPanel = document.getElementById('cp-rules-panel');
    const strategyPanel = document.getElementById('cp-strategy-panel');
    if (rulesPanel) rulesPanel.classList.toggle('hidden', tab !== 'mine');
    if (strategyPanel) strategyPanel.classList.toggle('hidden', tab !== 'strategy');
    if (tab === 'strategy') renderStrategyPanel();
  }

  // ---------- "My rules": 5-step entry checklist for today ----------
  function renderRulesList() {
    const wrap = document.getElementById('cp-rules-list');
    if (!wrap) return;
    const placeholders = cpBias === 'bearish' ? RULE_PLACEHOLDERS_SHORT : RULE_PLACEHOLDERS_LONG;
    wrap.innerHTML = ruleSteps.map((val, i) => `
      <div class="cp-rule-row">
        <span class="cp-rule-num">${i + 1}</span>
        <input type="text" class="cp-input cp-rule-input" data-rule-index="${i}" placeholder="${placeholders[i] || ''}" oninput="onChartPrepRuleStepInput(${i})">
      </div>
    `).join('');
    ruleSteps.forEach((val, i) => {
      const input = wrap.querySelector(`.cp-rule-input[data-rule-index="${i}"]`);
      if (input && document.activeElement !== input) input.value = val;
    });
  }

  function onChartPrepRuleStepInput(index) {
    const input = document.querySelector(`.cp-rule-input[data-rule-index="${index}"]`);
    ruleSteps[index] = input ? input.value : '';
    saveState();
    updateSaveButtonState();
  }

  function onChartPrepRuleNameInput() {
    const el = document.getElementById('cp-rules-name');
    ruleName = el ? el.value : '';
    saveState();
    updateSaveButtonState();
  }

  function updateSaveButtonState() {
    const btn = document.getElementById('cp-rules-save-btn');
    if (!btn) return;
    const hasStep = ruleSteps.some(s => s.trim());
    btn.disabled = !(ruleName.trim() && hasStep);
  }

  // Publishes today's rule steps into the REAL Strategies catalog (via
  // window.publishStrategyFromChartPrep, strategies.js) rather than just
  // saving them locally — per the design, "your filled steps become a
  // reusable strategy in your library."
  async function saveChartPrepRulesAsStrategy() {
    const name = ruleName.trim();
    const checklist = ruleSteps.map(s => s.trim()).filter(Boolean);
    if (!name || checklist.length === 0) return;

    const btn = document.getElementById('cp-rules-save-btn');
    const statusEl = document.getElementById('cp-rules-save-status');
    if (btn) { btn.disabled = true; btn.innerText = 'Saving…'; }

    await ensureStrategiesReady();

    if (typeof window.publishStrategyFromChartPrep !== 'function') {
      if (btn) { btn.disabled = false; btn.innerText = 'Save as strategy'; }
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.innerText = "Couldn't reach your strategy library — try again.";
      }
      return;
    }

    const bias = cpBias === 'bullish' ? 'Long' : (cpBias === 'bearish' ? 'Short' : 'Both');
    const newId = window.publishStrategyFromChartPrep({ name, bias, checklist });

    if (btn) { btn.disabled = false; btn.innerText = 'Save as strategy'; }

    if (newId) {
      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.innerText = `Saved as "${name}" in your strategy library.`;
      }
      renderSavedRulesBullets(checklist);
    } else if (statusEl) {
      statusEl.classList.remove('hidden');
      statusEl.innerText = "Your strategy library is full for your tier — free up a slot on the Strategies tab first.";
    }
  }

  function renderSavedRulesBullets(checklist) {
    const wrap = document.getElementById('cp-rules-saved-list');
    if (!wrap) return;
    wrap.classList.remove('hidden');
    wrap.innerHTML = checklist.map(step => `
      <div class="cp-setup-row">
        <span class="cp-setup-dot ${cpBias === 'bearish' ? 'cp-setup-dot-short' : ''}"></span>
        <div class="cp-setup-desc">${step}</div>
      </div>
    `).join('');
  }

  // ---------- "From strategy": reference an existing playbook's checklist ----------
  function renderStrategyPanel() {
    const select = document.getElementById('cp-strategy-select');
    const checklistWrap = document.getElementById('cp-strategy-checklist');
    if (!select) return;

    const applyOptions = (list) => {
      const previousValue = select.value;
      select.innerHTML = '<option value="">Select a strategy</option>' + list.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      if (list.some(s => s.id === previousValue)) {
        select.value = previousValue;
      } else if (checklistWrap) {
        checklistWrap.innerHTML = '';
      }
    };

    if (typeof window.getStrategiesForBias === 'function') {
      applyOptions(window.getStrategiesForBias(biasForStrategyLookup()));
    } else {
      select.innerHTML = '<option value="">Loading…</option>';
      ensureStrategiesReady().then(() => {
        if (typeof window.getStrategiesForBias === 'function') {
          applyOptions(window.getStrategiesForBias(biasForStrategyLookup()));
        }
      });
    }
  }

  function onChartPrepStrategySelect() {
    const select = document.getElementById('cp-strategy-select');
    const checklistWrap = document.getElementById('cp-strategy-checklist');
    if (!select || !checklistWrap) return;
    const id = select.value;
    if (!id || typeof window.getStrategiesForBias !== 'function') {
      checklistWrap.innerHTML = '';
      return;
    }
    const list = window.getStrategiesForBias(biasForStrategyLookup());
    const strategy = list.find(s => s.id === id);
    if (!strategy || strategy.checklist.length === 0) {
      checklistWrap.innerHTML = '<div class="roadmap-empty-state">No checklist saved for this strategy.</div>';
      return;
    }
    checklistWrap.innerHTML = strategy.checklist.map(step => `
      <div class="cp-setup-row">
        <span class="cp-setup-dot ${cpBias === 'bearish' ? 'cp-setup-dot-short' : ''}"></span>
        <div class="cp-setup-desc">${step}</div>
      </div>
    `).join('');
  }

  // Deep-links into Strategies filtered to today's direction.
  async function browseMatchingStrategies() {
    const bias = biasForStrategyLookup();
    await ensureStrategiesReady();
    if (typeof window.switchTab === 'function') {
      window.switchTab(null, 'tab-strategies');
    }
    if (typeof window.setBiasFilter === 'function') {
      window.setBiasFilter(bias);
    }
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
    const nameEl = document.getElementById('cp-rules-name');
    if (nameEl && document.activeElement !== nameEl) nameEl.value = ruleName;
    const lmrEl = document.getElementById('cp-lmr-input');
    if (lmrEl && document.activeElement !== lmrEl) lmrEl.value = lmrText;

    renderOpenHint();
    renderSideCard();
    renderSetupsCard();
    renderChartPrepLiveRead();
  }

  function renderAll() {
    loadState();
    renderDatePill();
    applyStateToDom();
  }

  window.onChartPrepLiveReadInput = onChartPrepLiveReadInput;
  window.setChartPrepOpen = setChartPrepOpen;
  window.setChartPrepBias = setChartPrepBias;
  window.onChartPrepLevelInput = onChartPrepLevelInput;
  window.toggleChartPrepSide = toggleChartPrepSide;
  window.setChartPrepSetupsTab = setChartPrepSetupsTab;
  window.onChartPrepRuleStepInput = onChartPrepRuleStepInput;
  window.onChartPrepRuleNameInput = onChartPrepRuleNameInput;
  window.saveChartPrepRulesAsStrategy = saveChartPrepRulesAsStrategy;
  window.onChartPrepStrategySelect = onChartPrepStrategySelect;
  window.browseMatchingStrategies = browseMatchingStrategies;
  window.renderChartPrep = renderAll;

  renderAll();

})();
/* === END COMPONENT: chart-prep === */