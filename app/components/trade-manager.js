/* ===========================================================
   COMPONENT LOGIC: trade-manager
   A manual, check-in-when-you-want tool for an OPEN trade. No live price
   feed — the trader enters their current price whenever they choose to
   look, and this tells them where their stop-loss should sit and whether
   they've hit target or been stopped out.

   Deliberately NOT auto-refreshing or nagging — the trader explicitly
   asked for this to support discipline ("a trader must not micromanage"),
   so there's no polling, no notifications, no encouragement to check more
   often. The foot-note on the page says this directly.

   State is in-memory only (resets on tab reload), same as the rest of
   this app's "no real backend yet" prototype scope.
   =========================================================== */
(function () {

  let instrumentName = null;  // raw text, e.g. "23200 CE" or "Infosys" — kept for display only
  let direction = null;       // 'call' | 'put' — inferred, see inferDirection() below
  let entry = null;           // price
  let slPrice = null;         // original stop-loss price (fixed, for reference)
  let targetPrice = null;     // price
  let riskPoints = null;      // R, derived: |entry - slPrice|
  let targetPoints = null;    // derived: |targetPrice - entry|
  let highestPointsInFavor = null; // ratchet — the single highest favorable
                                    // move ever seen for this trade, used for
                                    // both the trailing SL calc and "was any
                                    // profit ever locked in" on stop-out.
                                    // (See the user's confirmed rule: stop-out
                                    // messaging depends on whether ANY profit
                                    // was EVER locked, not just the final price.)
  let isActive = false;
  let isClosed = false;       // true once target hit or stopped out — stays
                              // visible until the trader navigates away and
                              // back, or clicks "End this trade".

  // How many candlesticks to draw in the decorative chart — fixed once per
  // trade (seeded from entry price) so re-renders during check-ins don't
  // visibly reshuffle the candles under the trader.
  let candleSeed = [];

  function fmtPts(n) {
    const rounded = Math.round(n * 100) / 100;
    return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  // Same trailing-zero-stripping as fmtPts, used for the realized R:R
  // figure shown on closed trades (e.g. "1.25" not "1.2500000001",
  // "5" not "5.00").
  function fmtRatio(n) {
    return fmtPts(n);
  }

  // Direction inference, confirmed with the trader: an instrument name
  // ending in CE/PE (case-insensitive, with or without a space before it)
  // is an option — direction is explicit from the name. Anything else
  // (futures/equity — "Infosys", "Nifty Fut") has no such marker, so
  // direction is inferred from where the trader puts their stop-loss
  // relative to entry: SL below entry => long ("call-like"), SL above
  // entry => short ("put-like"). No extra UI needed for that case.
  function inferDirectionFromName(name) {
    const trimmed = (name || '').trim().toUpperCase();
    if (/CE$/.test(trimmed)) return 'call';
    if (/PE$/.test(trimmed)) return 'put';
    return null; // unknown — caller falls back to SL-position inference
  }

  function pointsInFavorFor(currentPrice) {
    return direction === 'put' ? (entry - currentPrice) : (currentPrice - entry);
  }

  function priceFromPointsInFavor(points) {
    return direction === 'put' ? (entry - points) : (entry + points);
  }

  // Renders the 1:1..1:10 quick-pick buttons and the collapsible 1:10..1:100
  // (step 10) extended table, the moment Entry + SL are both valid numbers.
  // Confirmed with the trader: consistent R:R discipline is what makes a
  // trader successful long term, so the target should be CHOSEN from
  // proven ratios, not guessed — these are clickable, filling Target price.
  function onSetupPriceInput() {
    const entryEl = document.getElementById('tm-entry');
    const slEl = document.getElementById('tm-sl');
    const wrap = document.getElementById('tm-rr-suggest-wrap');
    const grid = document.getElementById('tm-rr-suggest-grid');
    const extendedGrid = document.getElementById('tm-rr-extended-grid');
    if (!entryEl || !slEl || !wrap || !grid || !extendedGrid) return;

    const e = parseFloat(entryEl.value);
    const sl = parseFloat(slEl.value);

    if (isNaN(e) || isNaN(sl) || e === sl) {
      wrap.classList.add('hidden');
      grid.innerHTML = '';
      extendedGrid.innerHTML = '';
      return;
    }

    const r = Math.abs(e - sl);
    // SL below entry => trade is long-style (target goes up); SL above
    // entry => short-style (target goes down). This is the SAME rule used
    // as the direction fallback for non-CE/PE names — applied here purely
    // for "which way is the target" math, independent of what direction
    // ends up being stored once the trade actually starts.
    const targetGoesUp = sl < e;

    wrap.classList.remove('hidden');

    let buttonsHtml = '';
    for (let ratio = 1; ratio <= 10; ratio++) {
      const targetPts = r * ratio;
      const targetPx = targetGoesUp ? e + targetPts : e - targetPts;
      buttonsHtml += `
        <button type="button" class="tm-rr-suggest-btn" onclick="applyRrSuggestion(${targetPx})">
          <span class="tm-rr-suggest-ratio">1:${ratio}</span>
          <span class="tm-rr-suggest-price">${fmtPts(targetPx)}</span>
        </button>
      `;
    }
    grid.innerHTML = buttonsHtml;

    let tableHtml = `
      <div class="mini-ladder-cell mini-ladder-head">Ratio</div>
      <div class="mini-ladder-cell mini-ladder-head num">Target Price</div>
      <div class="mini-ladder-cell mini-ladder-head num">Points</div>
    `;
    for (let ratio = 10; ratio <= 100; ratio += 10) {
      const targetPts = r * ratio;
      const targetPx = targetGoesUp ? e + targetPts : e - targetPts;
      tableHtml += `
        <div class="mini-ladder-cell mini-ladder-label">1:${ratio}</div>
        <div class="mini-ladder-cell num">${fmtPts(targetPx)}</div>
        <div class="mini-ladder-cell num">${fmtPts(targetPts)}</div>
      `;
    }
    extendedGrid.innerHTML = tableHtml;
  }

  // Fills the Target price field when a trader taps an R:R suggestion
  // button or table row. Exposed on window for the inline onclick above.
  function applyRrSuggestion(targetPx) {
    const targetEl = document.getElementById('tm-target');
    if (targetEl) targetEl.value = fmtPts(targetPx);
  }

  // Decorative candlesticks for the vertical R:R chart — illustrative
  // visual texture only (confirmed with the trader, modeled on their
  // reference image), NOT real market data. Generated once per trade from
  // a simple seeded random walk centered near entry, so it looks like a
  // plausible recent price history without claiming to be one. Seeded
  // from entry/risk so the SAME trade always draws the same candles
  // (stable across re-renders), but different trades look different.
  function generateCandleSeed() {
    let seedValue = Math.round((entry || 1) * 97 + (riskPoints || 1) * 13) % 2147483647;
    function nextRandom() {
      seedValue = (seedValue * 48271) % 2147483647;
      return seedValue / 2147483647;
    }

    const count = 16;
    const candles = [];
    let level = 0; // walks roughly within +-riskPoints*0.6 of entry, just for shape
    const step = (riskPoints || 1) * 0.18;
    for (let i = 0; i < count; i++) {
      const open = level;
      const drift = (nextRandom() - 0.5) * step * 2;
      const close = open + drift;
      const wickHigh = Math.max(open, close) + nextRandom() * step * 0.6;
      const wickLow = Math.min(open, close) - nextRandom() * step * 0.6;
      candles.push({ open, close, high: wickHigh, low: wickLow });
      level = close;
    }
    return candles;
  }

  function startTradeManager() {
    const instrumentEl = document.getElementById('tm-instrument');
    const entryEl = document.getElementById('tm-entry');
    const slEl = document.getElementById('tm-sl');
    const targetEl = document.getElementById('tm-target');
    const errorEl = document.getElementById('tm-setup-error');
    if (!instrumentEl || !entryEl || !slEl || !targetEl || !errorEl) return;

    const name = instrumentEl.value;
    const e = parseFloat(entryEl.value);
    const sl = parseFloat(slEl.value);
    const target = parseFloat(targetEl.value);

    function showError(msg) {
      errorEl.innerText = msg;
      errorEl.classList.remove('hidden');
    }

    if (isNaN(e) || isNaN(sl) || isNaN(target)) {
      showError('Enter entry, stop-loss, and target prices.');
      return;
    }
    if (sl === e) {
      showError('Stop-loss can\'t be the same as your entry price.');
      return;
    }

    // CE/PE names declare direction explicitly, so a mismatched SL/target
    // is a genuine input error worth catching. Futures/equity names (no
    // CE/PE) have no such declaration — whichever side the SL lands on
    // simply DEFINES the direction, so there's nothing to validate there.
    const namedDirection = inferDirectionFromName(name);
    if (namedDirection) {
      const slValid = namedDirection === 'put' ? sl > e : sl < e;
      const targetValid = namedDirection === 'put' ? target < e : target > e;
      if (!slValid) {
        showError(namedDirection === 'put'
          ? 'For a Put (PE), your stop-loss should be ABOVE your entry price.'
          : 'For a Call (CE), your stop-loss should be BELOW your entry price.');
        return;
      }
      if (!targetValid) {
        showError(namedDirection === 'put'
          ? 'For a Put (PE), your target should be BELOW your entry price.'
          : 'For a Call (CE), your target should be ABOVE your entry price.');
        return;
      }
    }

    // Target must still sit on the same side as the (now known) direction,
    // even for futures/equity trades — direction inferred from SL position.
    const finalDirection = namedDirection || (sl < e ? 'call' : 'put');
    const targetValidForFinal = finalDirection === 'put' ? target < e : target > e;
    if (!targetValidForFinal) {
      showError(finalDirection === 'put'
        ? 'Your stop-loss is above entry (a short-style trade) — target should be BELOW entry too.'
        : 'Your stop-loss is below entry (a long-style trade) — target should be ABOVE entry too.');
      return;
    }

    instrumentName = name.trim();
    direction = finalDirection;
    entry = e;
    slPrice = sl;
    targetPrice = target;
    riskPoints = Math.abs(entry - slPrice);
    targetPoints = Math.abs(targetPrice - entry);
    highestPointsInFavor = 0;
    isActive = true;
    isClosed = false;
    candleSeed = generateCandleSeed();

    errorEl.classList.add('hidden');
    ['tm-instrument', 'tm-entry', 'tm-sl', 'tm-target', 'tm-start-btn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
    document.getElementById('tm-active-wrap').classList.remove('hidden');
    const priceEl = document.getElementById('tm-current-price');
    priceEl.value = '';
    priceEl.disabled = false; // re-enable in case a previously closed trade had disabled it

    renderRrSummary();
    renderRrAnimation(0);
    renderResultArea(null);
  }

  function endTradeManager() {
    instrumentName = null;
    direction = null;
    entry = null;
    slPrice = null;
    targetPrice = null;
    riskPoints = null;
    targetPoints = null;
    highestPointsInFavor = null;
    isActive = false;
    isClosed = false;
    candleSeed = [];

    document.getElementById('tm-active-wrap').classList.add('hidden');
    ['tm-instrument', 'tm-entry', 'tm-sl', 'tm-target'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.value = '';
        el.disabled = false; // re-enable for editing the next trade's setup
      }
    });
    const startBtn = document.getElementById('tm-start-btn');
    if (startBtn) startBtn.disabled = false;
    document.getElementById('tm-setup-error').classList.add('hidden');
    document.getElementById('tm-rr-suggest-wrap').classList.add('hidden');
    document.getElementById('tm-rr-suggest-grid').innerHTML = '';
    document.getElementById('tm-rr-extended-grid').innerHTML = '';
  }

  // PREVIEW — fires on every keystroke (oninput). Updates the chart's
  // current-price line AND the open-status result message live, so the
  // trader sees their R:R progress the moment they cross a round number
  // (1:2, 1:3, etc.) without needing to click away first. Critically, this
  // NEVER closes the trade (never sets isClosed, never mutates
  // highestPointsInFavor) — that decision still waits for commit (Enter or
  // blur). This is the fix for the earlier bug: evaluating target/stop-out
  // CLOSURE on every keystroke meant a partial number mid-type (e.g.
  // typing "1" on the way to "180") could read as a huge adverse move and
  // trigger a false stop-out that then permanently blocked re-evaluation.
  // Showing a live STATUS preview carries none of that risk, since it
  // never locks anything in — only onTradeManagerCheckIn (commit) does.
  function onTradeManagerPricePreview() {
    if (!isActive) return;
    const priceEl = document.getElementById('tm-current-price');
    if (!priceEl) return;

    const currentPrice = parseFloat(priceEl.value);
    if (priceEl.value.trim() === '' || isNaN(currentPrice)) {
      renderRrAnimation(highestPointsInFavor);
      if (!isClosed) renderResultArea(null);
      return;
    }

    const previewPointsInFavor = pointsInFavorFor(currentPrice);
    // The current-price line always shows the EXACT typed value, including
    // a real pullback below a previous high — it answers "where is price
    // right now", not "where has it ever been". The trailing-SL line's own
    // "never preview a regression" logic lives inside renderRrAnimation
    // itself (it separately compares against highestPointsInFavor), so it
    // stays correctly clamped even though this current-price value isn't.
    renderRrAnimation(previewPointsInFavor);

    // Live status preview — read-only, mirrors the commit logic's
    // calculations WITHOUT setting isClosed or touching
    // highestPointsInFavor. If a committed value already closed the
    // trade, leave whatever the committed result card is showing alone
    // (don't show a misleading "still open" preview over a real outcome).
    if (isClosed) return;

    const previewHighest = Math.max(highestPointsInFavor || 0, previewPointsInFavor);
    const trailing = (typeof window.computeTrailingSl === 'function')
      ? window.computeTrailingSl(riskPoints, previewHighest)
      : null;
    const previewTrailingSlPoints = trailing ? trailing.slFromEntry : -riskPoints;
    renderResultArea('open', { pointsInFavor: previewPointsInFavor, trailingSlPoints: previewTrailingSlPoints });
  }

  // COMMIT — fires on Enter or on losing focus (blur), i.e. once the
  // trader has actually finished entering a price, not mid-keystroke. This
  // is the only place highestPointsInFavor, isClosed, and the
  // target/stop-out result are allowed to change.
  function onTradeManagerCheckIn() {
    if (!isActive) return;
    const priceEl = document.getElementById('tm-current-price');
    if (!priceEl) return;

    const currentPrice = parseFloat(priceEl.value);
    if (priceEl.value.trim() === '' || isNaN(currentPrice)) {
      renderResultArea(null);
      renderRrAnimation(highestPointsInFavor);
      return;
    }

    const pointsInFavor = pointsInFavorFor(currentPrice);
    if (!isClosed && pointsInFavor > highestPointsInFavor) {
      highestPointsInFavor = pointsInFavor;
    }

    // Priority confirmed with the trader: check TARGET first, then
    // stopped-out — in practice a single price can't satisfy both, since
    // target is far in favor and the stop sits at/behind the trailing SL.
    if (!isClosed && pointsInFavor >= targetPoints) {
      isClosed = true;
      renderRrAnimation(Math.max(pointsInFavor, 0)); // re-render AFTER isClosed flips, so the disabled overlay actually shows
      renderResultArea('target');
      disablePriceInputIfClosed();
      return;
    }

    const trailing = (typeof window.computeTrailingSl === 'function')
      ? window.computeTrailingSl(riskPoints, highestPointsInFavor)
      : null;
    const trailingSlPoints = trailing ? trailing.slFromEntry : -riskPoints;

    if (!isClosed && pointsInFavor <= trailingSlPoints) {
      isClosed = true;
      renderRrAnimation(Math.max(pointsInFavor, 0)); // re-render AFTER isClosed flips, so the disabled overlay actually shows
      const everLockedProfit = trailing && trailing.lockedProfit !== null;
      renderResultArea(everLockedProfit ? 'stopped-locked' : 'stopped-neutral', { trailingSlPoints });
      disablePriceInputIfClosed();
      return;
    }

    renderRrAnimation(Math.max(pointsInFavor, 0));
    if (!isClosed) {
      renderResultArea('open', { pointsInFavor, trailingSlPoints });
    }
  }

  // Disables the price input once a trade has closed (target hit or
  // stopped out) — there's nothing left to check in on, and leaving it
  // editable invited exactly the kind of "still typing into a finished
  // trade" confusion the disabled chart overlay is meant to resolve.
  function disablePriceInputIfClosed() {
    const priceEl = document.getElementById('tm-current-price');
    if (priceEl && isClosed) {
      priceEl.disabled = true;
    }
  }

  function renderRrSummary() {
    const el = document.getElementById('tm-rr-summary');
    if (!el) return;
    const ratio = (targetPoints / riskPoints).toFixed(1).replace(/\.0$/, '');
    const nameChip = instrumentName
      ? `<span class="tm-rr-chip">${instrumentName}</span>`
      : '';
    el.innerHTML = `
      ${nameChip}
      <span class="tm-rr-chip">Risk: <strong>${fmtPts(riskPoints)} pts</strong></span>
      <span class="tm-rr-chip">Target: <strong>${fmtPts(targetPoints)} pts</strong></span>
      <span class="tm-rr-chip">Risk:Reward <strong>1:${ratio}</strong></span>
    `;
  }

  function renderResultArea(state, extra) {
    const el = document.getElementById('tm-result-area');
    if (!el) return;

    if (state === null) {
      el.innerHTML = '';
      return;
    }

    if (state === 'target') {
      const confettiPieces = ['#1d9e75', '#2e75b6', '#f2a623', '#d4537e', '#7f77dd']
        .map((color, i) => `<span class="tm-confetti-piece" style="left:${10 + i * 18}%; background:${color}; animation-delay:${i * 0.08}s;"></span>`)
        .join('');
      // Target hit captures the FULL planned move by definition — even if
      // the trader's actual typed check-in price ran a bit past target
      // (no live feed, so they may have checked in late), the realized
      // numbers shown here are the planned target distance itself.
      const realizedRatio = fmtRatio(targetPoints / riskPoints);
      el.innerHTML = `
        <div class="tm-result-card tm-result-target tm-result-celebrate">
          <div class="tm-confetti-burst">${confettiPieces}</div>
          <div class="tm-result-icon" style="font-size:42px;">🎉</div>
          <div class="tm-result-title" style="font-size:19px;">Target reached — congratulations!</div>
          <div class="tm-result-message">You followed the plan all the way through. This is exactly the kind of trade that compounds over time — letting a winner run its full distance instead of cutting it short.</div>
          <div class="tm-result-stats">
            <span class="tm-result-stat"><strong>${fmtPts(targetPoints)} pts</strong> captured</span>
            <span class="tm-result-stat">Realized <strong>1:${realizedRatio}</strong></span>
          </div>
        </div>
      `;
      return;
    }

    if (state === 'stopped-locked' && extra) {
      // Captured points = the trailing SL LEVEL ITSELF (where the trade
      // actually closed), not the trader's typed check-in price — there's
      // no live feed, so a late check-in could read a bit past the SL;
      // the SL level is what the system treats as the real exit.
      const capturedPoints = extra.trailingSlPoints;
      const realizedRatio = fmtRatio(capturedPoints / riskPoints);
      el.innerHTML = `
        <div class="tm-result-card tm-result-stopped-locked">
          <div class="tm-result-icon">🛡️</div>
          <div class="tm-result-title">Stopped out — but you banked a win</div>
          <div class="tm-result-message">The trade didn't reach target, but your trailing stop did its job: you're walking away with profit, not a loss. That's the system working as intended, even when a trade doesn't go the whole distance.</div>
          <div class="tm-result-stats">
            <span class="tm-result-stat"><strong>${fmtPts(capturedPoints)} pts</strong> captured</span>
            <span class="tm-result-stat">Realized <strong>1:${realizedRatio}</strong></span>
          </div>
        </div>
      `;
      return;
    }

    if (state === 'stopped-neutral') {
      // Points lost = the full original planned risk, shown factually
      // (not framed as a failure) — the trade hit its original SL, never
      // having locked in any profit along the way.
      el.innerHTML = `
        <div class="tm-result-card tm-result-stopped-neutral">
          <div class="tm-result-icon">↩️</div>
          <div class="tm-result-title">Stopped out at your planned risk</div>
          <div class="tm-result-message">This one didn't work out, and that's a normal part of trading — your plan limited the damage to exactly what you decided it would, before you ever entered. That discipline is what keeps you in the game for the next one.</div>
          <div class="tm-result-stats">
            <span class="tm-result-stat"><strong>${fmtPts(riskPoints)} pts</strong> lost (your planned risk)</span>
            <span class="tm-result-stat">Realized <strong>-1:1</strong></span>
          </div>
        </div>
      `;
      return;
    }

    if (state === 'open' && extra) {
      const pct = Math.max(0, Math.min(100, (extra.pointsInFavor / targetPoints) * 100));
      const isRiskFree = extra.trailingSlPoints > 0;
      el.innerHTML = `
        <div class="tm-result-card ${isRiskFree ? 'tm-result-open-profit' : 'tm-result-open'}">
          <div class="tm-result-title">${fmtPts(extra.pointsInFavor)} pts in favor (${Math.round(pct)}% of the way to target)</div>
          <div class="tm-result-message">Current trailing stop-loss: ${fmtPts(priceFromPointsInFavor(extra.trailingSlPoints))} (${extra.trailingSlPoints >= 0 ? '+' : ''}${fmtPts(extra.trailingSlPoints)} pts from entry).${isRiskFree ? ' This trade is risk-free right now.' : ''} No action needed unless price reaches this level or your target.</div>
        </div>
      `;
    }
  }

  // Vertical risk/reward chart — green zone above entry (reward), red zone
  // below entry (risk), decorative candlesticks for texture (NOT real
  // price data), with SL/Entry/Target levels and 1:1/1:2/1:3 reference
  // lines marked, plus an animated current-price marker. Modeled on the
  // trader's own reference image. "Up" on screen always means "favorable"
  // — points-in-favor drives vertical position, not raw price, so Call
  // and Put trades both read the same way (green always above entry).
  function renderRrAnimation(pointsInFavor) {
    const container = document.getElementById('tm-rr-animation-area');
    if (!container || riskPoints === null || targetPoints === null) return;

    const clampedPoints = Math.max(-riskPoints, Math.min(targetPoints, pointsInFavor || 0));

    // Trailing SL preview uses whichever is more favorable: the already
    // COMMITTED highestPointsInFavor, or the live-typed value passed in
    // here — same "never preview a regression" principle as the
    // current-price line itself. This makes the SL line update live as
    // the trader types, exactly like the current-price line already does,
    // without actually committing that as the permanent ratchet value
    // until they press Enter or click away (only onTradeManagerCheckIn
    // mutates highestPointsInFavor — this function only ever reads it).
    const previewHighest = Math.max(highestPointsInFavor || 0, clampedPoints);
    const trailing = (typeof window.computeTrailingSl === 'function')
      ? window.computeTrailingSl(riskPoints, previewHighest)
      : null;
    const trailingSlPoints = trailing ? trailing.slFromEntry : -riskPoints;

    // Chart spans from -riskPoints (bottom) to +targetPoints (top), in
    // points-in-favor terms, mapped onto SVG y (0 = top, H = bottom).
    const W = 600;
    const H = 320;
    const padTop = 16;
    const padBottom = 16;
    const plotH = H - padTop - padBottom;
    const totalSpan = riskPoints + targetPoints;

    function yFor(points) {
      const frac = (points + riskPoints) / totalSpan; // 0 at SL, 1 at target
      return padTop + (1 - frac) * plotH; // invert: higher points = higher on screen
    }

    const ySl = yFor(-riskPoints);
    const yEntry = yFor(0);
    const yTarget = yFor(targetPoints);
    const yTrailingSl = yFor(Math.max(trailingSlPoints, -riskPoints));
    const yCurrent = yFor(clampedPoints);

    // 1:1, 1:2, 1:3 reference lines — only drawn if they fall within the
    // chart's span (a low-ratio target might not have room for all three).
    const refRatios = [1, 2, 3].filter(r => r * riskPoints <= targetPoints + 0.0001);
    const refLines = refRatios.map(r => ({ ratio: r, y: yFor(r * riskPoints) }));

    // Plain points scale, every riskPoints interval (e.g. risk=20 -> ticks
    // at 20, 40, 60... points above entry) — confirmed with the trader as
    // a separate, additional scale alongside the 1:1/1:2/1:3 ratio lines
    // above, not a replacement. These mathematically land on the SAME
    // levels as the ratio lines (1R = the risk amount, by definition), so
    // they're drawn as short tick marks on the LEFT edge (vs. the ratio
    // lines' full-width dashed lines + right-aligned labels) to stay
    // visually distinct even where both coincide.
    const pointsScaleTicks = [];
    for (let pts = riskPoints; pts <= targetPoints + 0.0001; pts += riskPoints) {
      pointsScaleTicks.push({ points: pts, y: yFor(pts) });
    }

    // Decorative candlesticks spread across the chart width, mapped from
    // the seeded random walk (centered near 0, i.e. near entry) onto the
    // same y-scale as everything else.
    const candleCount = candleSeed.length || 1;
    const candleWidth = (W - 40) / candleCount;
    const candlesSvg = candleSeed.map((c, i) => {
      const x = 20 + i * candleWidth + candleWidth * 0.15;
      const bodyW = candleWidth * 0.7;
      const yOpen = yFor(Math.max(-riskPoints, Math.min(targetPoints, c.open)));
      const yClose = yFor(Math.max(-riskPoints, Math.min(targetPoints, c.close)));
      const yHigh = yFor(Math.max(-riskPoints, Math.min(targetPoints, c.high)));
      const yLow = yFor(Math.max(-riskPoints, Math.min(targetPoints, c.low)));
      const bullish = c.close >= c.open;
      const color = bullish ? '#5dcaa5' : '#f0997b';
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(Math.abs(yClose - yOpen), 1.5);
      return `
        <line x1="${x + bodyW / 2}" y1="${yHigh}" x2="${x + bodyW / 2}" y2="${yLow}" stroke="${color}" stroke-width="1" opacity="0.55"/>
        <rect x="${x}" y="${bodyTop}" width="${bodyW}" height="${bodyH}" fill="${color}" opacity="0.55" rx="1"/>
      `;
    }).join('');

    const refLinesSvg = refLines.map(line => `
      <line x1="0" y1="${line.y}" x2="${W}" y2="${line.y}" stroke="#9aa5b1" stroke-width="0.75" stroke-dasharray="3 4" opacity="0.6"/>
      <text x="${W - 6}" y="${line.y - 4}" text-anchor="end" font-size="10.5" fill="#5f6b7a">1:${line.ratio}</text>
    `).join('');

    const pointsScaleSvg = pointsScaleTicks.map(tick => `
      <line x1="70" y1="${tick.y}" x2="84" y2="${tick.y}" stroke="#2e75b6" stroke-width="1.5" opacity="0.55"/>
      <text x="88" y="${tick.y + 3.5}" font-size="10" fill="#2e75b6" opacity="0.85">+${fmtPts(tick.points)}</text>
    `).join('');

    // Red zone disappears ENTIRELY, the instant the trailing SL itself
    // moves into profit territory (trailing.lockedProfit !== null) — not
    // just whenever current price happens to be momentarily above entry.
    // Confirmed with the trader: this should reflect whether the trade is
    // ACTUALLY risk-free right now (the SL itself guarantees a win even on
    // a pullback to entry), not a price snapshot that could itself pull
    // back below entry a moment later while the SL hasn't caught up yet.
    // Hard cutover, not gradual — full intensity until that instant, then
    // gone.
    const slIsRiskFree = trailing && trailing.lockedProfit !== null;
    const riskZoneOpacity = slIsRiskFree ? 0 : 0.4;

    container.innerHTML = `
      <div style="position:relative;">
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block; overflow:visible;">
          <rect x="0" y="${padTop}" width="${W}" height="${yEntry - padTop}" fill="#9fe1cb" opacity="0.55"/>
          <rect x="0" y="${yEntry}" width="${W}" height="${H - padBottom - yEntry}" fill="#f0997b" opacity="${riskZoneOpacity}"/>
          ${candlesSvg}
          ${refLinesSvg}
          ${pointsScaleSvg}
          <line x1="0" y1="${ySl}" x2="${W}" y2="${ySl}" stroke="#d9381e" stroke-width="1.5"/>
          <line x1="0" y1="${yEntry}" x2="${W}" y2="${yEntry}" stroke="#5f6b7a" stroke-width="1.5"/>
          <line x1="0" y1="${yTarget}" x2="${W}" y2="${yTarget}" stroke="#1d9e75" stroke-width="1.5"/>
          <line x1="0" y1="${yTrailingSl}" x2="${W}" y2="${yTrailingSl}" stroke="#2e75b6" stroke-width="3.5"/>
          <line x1="0" y1="${yCurrent}" x2="${W}" y2="${yCurrent}" stroke="#1f3a5f" stroke-width="2"
            stroke-dasharray="6 3" style="transition: y1 0.4s ease, y2 0.4s ease;"/>
        </svg>
        <div style="position:absolute; left:8px; top:${ySl - 8}px; font-size:11px; color:#d9381e; font-weight:600;">SL ${fmtPts(slPrice)}</div>
        <div style="position:absolute; left:8px; top:${yEntry - 8}px; font-size:11px; color:#5f6b7a; font-weight:600;">Entry ${fmtPts(entry)}</div>
        <div style="position:absolute; left:8px; top:${yTarget - 8}px; font-size:11px; color:#1d9e75; font-weight:600;">Target ${fmtPts(targetPrice)}</div>
        <div style="position:absolute; right:8px; top:${yTrailingSl - 8}px; font-size:11px; color:#2e75b6; font-weight:700; text-align:right;">Trailing SL ${fmtPts(priceFromPointsInFavor(trailingSlPoints))}</div>
        <div style="position:absolute; right:8px; top:${yCurrent - 8}px; font-size:11px; color:#1f3a5f; font-weight:700; text-align:right; transition: top 0.4s ease;">Price ${fmtPts(priceFromPointsInFavor(clampedPoints))}</div>
        ${isClosed ? `
          <div style="position:absolute; inset:0; background:rgba(248,250,252,0.78); display:flex; flex-direction:column;
            align-items:center; justify-content:center; border-radius:8px;">
            <div style="width:44px; height:44px; border-radius:50%; background:#1d9e75; color:#fff;
              display:flex; align-items:center; justify-content:center; font-size:24px; margin-bottom:8px;">&#10003;</div>
            <div style="font-size:14px; font-weight:700; color:#1f3a5f;">Trade closed</div>
          </div>
        ` : ''}
      </div>
      <p class="foot-note" style="margin-top:6px;">
        <span style="color:#2e75b6;">&#9644;</span> solid blue line = your current trailing stop-loss.
        <span style="color:#1f3a5f;">&#9472;&#9472;</span> dashed navy line = current price.
        Green = reward zone, red = risk zone.
      </p>
    `;
  }

  window.startTradeManager = startTradeManager;
  window.endTradeManager = endTradeManager;
  window.onTradeManagerCheckIn = onTradeManagerCheckIn;
  window.onTradeManagerPricePreview = onTradeManagerPricePreview;
  window.onSetupPriceInput = onSetupPriceInput;
  window.applyRrSuggestion = applyRrSuggestion;

  if (typeof window.applyReferenceSectionState === 'function') {
    window.applyReferenceSectionState('tm-rr-extended');
  }

})();