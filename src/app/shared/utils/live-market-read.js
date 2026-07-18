/* ===========================================================
   SHARED — Live Market Read matcher
   Local, rule-based read on whatever the trader types — no external
   calls. Two categories of rule: 'structure' (what the market is doing)
   and 'emotion' (what the trader is feeling). Every rule whose pattern
   matches the text returns its own chip, so a single sentence can
   surface both a structure read and an emotional flag at once.

   Originally built inline in trade-manager.js for the DURING-a-trade
   "Live market read" panel, then extracted here so the same rules also
   power Chart Prep's PRE-market version (submit a read/emotion before
   taking a trade) without the two copies drifting apart.

   Loaded BEFORE app-shell.js and before any lazily-loaded feature file
   that uses it (trade-manager.js, chart-prep.js) — see app-shell.html —
   same pattern as formatters.js.
   =========================================================== */

(function () {

  const LMR_RULES = [
    { id:'uptrend',    cat:'structure', tone:'green',  label:'UPTREND STRUCTURE',
      test:/\b(higher highs?|higher lows?|hh|hl|break(?:ing|s)?\s+above|breakout|bullish|uptrend|buying the dip)\b/i,
      advice:'Structure favors the bulls — look for buying opportunities and enter on pullbacks, not chases.' },
    { id:'downtrend',  cat:'structure', tone:'red',    label:'DOWNTREND STRUCTURE',
      test:/\b(lower highs?|lower lows?|lh|ll|break(?:ing|s)?\s+below|breakdown|bearish|downtrend)\b/i,
      advice:'Structure favors the bears — look for selling opportunities and enter on retracements, not chases.' },
    { id:'range',      cat:'structure', tone:'blue',   label:'RANGE-BOUND',
      test:/\b(range|ranging|sideways|consolidat\w*|choppy|no clear trend|chop)\b/i,
      advice:"No clear trend yet — fade the edges of the range, don't chase the middle." },
    { id:'smartmoney', cat:'structure', tone:'purple', label:'SMART-MONEY PATTERN NOTED',
      test:/\b(fvg|fair value gap|order block|\bob\b|liquidity|smart money|imbalance|supply zone|demand zone|gap fill)\b/i,
      advice:'These zones often get revisited before continuation — treat as a magnet level, not a standalone signal. Wait for reaction/confirmation there.' },
    { id:'volume',     cat:'structure', tone:'blue',   label:'VOLUME NOTED',
      test:/\b(volume spike|high volume|low volume|volume climax|thin volume)\b/i,
      advice:"Volume alone isn't a trigger — pair it with price reaction at a level before acting on it." },
    { id:'fomo',       cat:'emotion',   tone:'amber',  label:'FOMO DETECTED',
      test:/\b(fomo|missing out|chasing|chase it|don'?t want to miss)\b/i,
      advice:'Pause. FOMO entries are usually late entries — wait for a pullback or let this one go.' },
    { id:'fear',       cat:'emotion',   tone:'amber',  label:'FEAR DETECTED',
      test:/\b(scared|afraid|fear\w*|nervous|anxious|worried)\b/i,
      advice:"Fear usually means the size feels too big or the setup isn't clear — reduce size or wait for confirmation." },
    { id:'revenge',    cat:'emotion',   tone:'red',    label:'REVENGE-TRADE RISK',
      test:/\b(revenge|get (it|my money) back|make it back|frustrat\w*)\b/i,
      advice:'Trading to recover a loss is how one loss becomes three. Step away or cut size in half.' },
    { id:'greed',      cat:'emotion',   tone:'amber',  label:'GREED DETECTED',
      test:/\b(greedy|greed|double down|more lots|all[- ]?in|yolo)\b/i,
      advice:"Sizing up mid-euphoria is how winners give profits back. Stick to the plan you made calm." },
    { id:'calm',       cat:'emotion',   tone:'green',  label:'CLEAR-HEADED',
      test:/\b(calm|confident|clear head|patient|in control|following (my|the) plan)\b/i,
      advice:"Good state to be trading from. Keep the same size and rules you'd use on any other day." },
  ];

  function analyzeLiveMarketRead(text) {
    const t = (text || '').toLowerCase();
    if (!t.trim()) return [];
    return LMR_RULES.filter(rule => rule.test.test(t));
  }

  // Shared chip-list renderer — same markup/classes (.tm-lmr-chip*, see
  // trade-manager.css) used by both Trade Manager and Chart Prep, so a
  // caller just hands it an array of matches from analyzeLiveMarketRead()
  // plus the target element and gets consistent chips either place.
  function renderLiveMarketReadChips(chipsEl, matches, emptyText) {
    if (!chipsEl) return;
    if (!matches || matches.length === 0) {
      chipsEl.innerHTML = emptyText ? `
        <div class="tm-lmr-chip tm-lmr-chip-neutral">
          <div class="tm-lmr-chip-label">No clear signal yet</div>
          <div class="tm-lmr-chip-text">${emptyText}</div>
        </div>
      ` : '';
      return;
    }
    chipsEl.innerHTML = matches.map(m => `
      <div class="tm-lmr-chip tm-lmr-chip-${m.tone}">
        <div class="tm-lmr-chip-label">${m.label}</div>
        <div class="tm-lmr-chip-text">${m.advice}</div>
      </div>
    `).join('');
  }

  window.LMR_RULES = LMR_RULES;
  window.analyzeLiveMarketRead = analyzeLiveMarketRead;
  window.renderLiveMarketReadChips = renderLiveMarketReadChips;

})();
