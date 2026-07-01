/* ===========================================================
   COMPONENT: trade-manager (rebuilt)
   Changes vs previous version:
   - CE/PE only (Future/Equity removed — different workflow)
   - Two-column layout: inputs left, sticky metrics right
   - R:R pill stays highlighted when manually selected
   - % gain/loss in position summary
   - Current price inline next to direction badge
   - Broker order import pre-fill
   - End-trade button styled (not plain link)
   - Result area dark-theme safe
   =========================================================== */
(function () {

  // ── State ──────────────────────────────────────────────────
  let instrumentType  = null;
  let instrumentName  = null;
  let direction       = null;
  let entry = null, slPrice = null, targetPrice = null;
  let riskPoints = null, targetPoints = null;
  let lots = 1, qtyPerLot = 65;
  let highestPointsInFavor = 0;
  let isActive = false, isClosed = false;
  let candleSeed = [];
  let setupReviewOpen = false;
  let selectedRrRatio = null; // tracks which R:R pill was tapped

  // ── Helpers ────────────────────────────────────────────────
  // fmt now shared — see /src/app/shared/utils/formatters.js
  const fmtPts  = n => (Math.round(n*100)/100).toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
  const fmtRs   = n => '₹' + fmt(n);
  const fmtPct  = n => (Math.round(n*10)/10).toFixed(1) + '%';

  const QTY_MAP = { banknifty:30, bank_nifty:30, finnifty:60, fin_nifty:60, sensex:20, nifty:65 };
  function detectQtyPerLot(name) {
    const u = (name||'').toUpperCase().replace(/\s+/g,'');
    if (u.includes('BANKNIFTY')) return 30;
    if (u.includes('FINNIFTY'))  return 60;
    if (u.includes('SENSEX'))    return 20;
    if (u.includes('NIFTY'))     return 65;
    return null;
  }

  function pointsInFavorFor(cur) { return direction==='put' ? entry-cur : cur-entry; }
  function priceFromPIF(pts)     { return direction==='put' ? entry-pts : entry+pts; }

  // ── Instrument type pills ──────────────────────────────────
  function setInstrumentType(type) {
    instrumentType = type;
    document.querySelectorAll('.tm-type-pill').forEach(b => b.classList.toggle('tm-type-pill-active', b.dataset.type===type));
    onSetupPriceInput();
  }

  // ── Lots ───────────────────────────────────────────────────
  function stepLots(d) {
    const el = document.getElementById('tm-lots');
    if (!el) return;
    lots = Math.max(1, (parseInt(el.value)||1)+d);
    el.value = lots;
    updateLotsInfo();
    updateMetricsPanel();
  }

  function onLotsInput() {
    const el = document.getElementById('tm-lots');
    if (!el) return;
    const v = parseInt(el.value);
    lots = isNaN(v)||v<1 ? 1 : v;
    updateLotsInfo();
    updateMetricsPanel();
  }

  function updateLotsInfo() {
    const el = document.getElementById('tm-lots-info');
    if (!el) return;
    const rs = typeof window.getRiskSummary === 'function' ? window.getRiskSummary() : null;
    const totalQty = lots * qtyPerLot;
    let html = `<span class="tm-lots-stat">Qty: <strong>${totalQty}</strong></span>`;
    if (rs) {
      const max = rs.maxLots || 0;
      html += `<span class="tm-lots-stat">Max allowed: <strong>${max} lot${max===1?'':'s'}</strong></span>`;
      if (lots > max) html += `<div class="tm-lots-warning">⚠ ${lots} lots exceeds your tier limit of ${max}. Useful for scenario planning — don't take this live.</div>`;
    }
    el.innerHTML = html;
  }

  // ── Price hints ────────────────────────────────────────────
  function updatePriceHints() {
    const e = parseFloat(document.getElementById('tm-entry')?.value);
    const s = parseFloat(document.getElementById('tm-sl')?.value);
    const t = parseFloat(document.getElementById('tm-target')?.value);
    const slHint    = document.getElementById('tm-sl-hint');
    const tgtHint   = document.getElementById('tm-target-hint');
    if (slHint)  slHint.innerText  = !isNaN(e)&&!isNaN(s) ? `${fmtPts(Math.abs(e-s))} pts risk` : '';
    if (tgtHint) tgtHint.innerText = !isNaN(e)&&!isNaN(t) ? `${fmtPts(Math.abs(t-e))} pts gain` : '';
  }

  // ── Setup price input ──────────────────────────────────────
  function onSetupPriceInput() {
    const nameVal = document.getElementById('tm-instrument')?.value||'';
    const det = detectQtyPerLot(nameVal);
    if (det) qtyPerLot = det;

    updatePriceHints();
    renderRrSuggestions();
    updateMetricsPanel();
  }

  // ── R:R suggestions ────────────────────────────────────────
  function renderRrSuggestions() {
    const wrap = document.getElementById('tm-rr-suggest-wrap');
    const grid = document.getElementById('tm-rr-suggest-grid');
    if (!wrap||!grid) return;

    const e  = parseFloat(document.getElementById('tm-entry')?.value);
    const sl = parseFloat(document.getElementById('tm-sl')?.value);
    if (isNaN(e)||isNaN(sl)||e===sl) { wrap.classList.add('hidden'); return; }

    const r = Math.abs(e-sl);
    const goesUp = sl < e;
    wrap.classList.remove('hidden');

    let html = '';
    for (let ratio=1; ratio<=10; ratio++) {
      const tgtPx = goesUp ? e+r*ratio : e-r*ratio;
      const isSelected = selectedRrRatio === ratio;
      html += `<button type="button" class="tm-rr-suggest-btn${isSelected?' tm-rr-suggest-btn-selected':''}"
        onclick="applyRrSuggestion(${tgtPx},${ratio})">
        <span class="tm-rr-suggest-ratio">1:${ratio}</span>
        <span class="tm-rr-suggest-price">${fmtPts(tgtPx)}</span>
      </button>`;
    }
    grid.innerHTML = html;
  }

  function applyRrSuggestion(tgtPx, ratio) {
    const el = document.getElementById('tm-target');
    if (el) { el.value = fmtPts(tgtPx); }
    selectedRrRatio = ratio;
    renderRrSuggestions();
    updatePriceHints();
    updateMetricsPanel();
  }

  // ── Metrics panel (right column) ───────────────────────────
  function updateMetricsPanel() {
    const panel   = document.getElementById('tm-position-summary');
    const empty   = document.getElementById('tm-metrics-empty');
    if (!panel||!empty) return;

    const e  = parseFloat(document.getElementById('tm-entry')?.value);
    const sl = parseFloat(document.getElementById('tm-sl')?.value);
    const t  = parseFloat(document.getElementById('tm-target')?.value);
    if (isNaN(e)||isNaN(sl)||e===sl) {
      panel.classList.add('hidden'); empty.style.display='flex'; return;
    }
    empty.style.display = 'none';
    panel.classList.remove('hidden');

    const rPts = Math.abs(e-sl);
    const totalQty = lots * qtyPerLot;
    const rsRisk   = rPts * totalQty;
    const rsPnl    = !isNaN(t) ? Math.abs(t-e)*totalQty : null;
    const rrRatio  = !isNaN(t)&&rPts>0 ? Math.abs(t-e)/rPts : null;
    const isOptionBuyer = instrumentType==='call'||instrumentType==='put';
    const marginEst = isOptionBuyer ? e*totalQty : e*totalQty*0.15;

    // % of balance
    const rs = typeof window.getRiskSummary==='function' ? window.getRiskSummary() : null;
    const balance = rs?.currentBalance || null;
    const riskPct  = balance ? (rsRisk/balance*100)  : null;
    const rwardPct = balance&&rsPnl ? (rsPnl/balance*100) : null;

    panel.innerHTML = `
      <div class="tm-metrics-summary">
        <div class="tm-metric-row tm-metric-risk">
          <div class="tm-metric-heading">Risk (1R)</div>
          <div class="tm-metric-amount">${fmtRs(rsRisk)}</div>
          <div class="tm-metric-detail">${fmtPts(rPts)} pts × ${totalQty} qty${riskPct!==null?' · '+fmtPct(riskPct)+' of balance':''}</div>
        </div>
        ${rsPnl!==null?`
        <div class="tm-metric-row tm-metric-reward">
          <div class="tm-metric-heading">Reward (1:${fmtPts(rrRatio)})</div>
          <div class="tm-metric-amount">${fmtRs(rsPnl)}</div>
          <div class="tm-metric-detail">${fmtPts(Math.abs((t||0)-e))} pts × ${totalQty} qty${rwardPct!==null?' · +'+fmtPct(rwardPct)+' of balance':''}</div>
        </div>`:''}
        <div class="tm-metric-row tm-metric-margin">
          <div class="tm-metric-heading">Est. Margin</div>
          <div class="tm-metric-amount">${fmtRs(marginEst)}</div>
          <div class="tm-metric-detail">${isOptionBuyer?'Premium × qty':'~15% of notional'}</div>
        </div>
      </div>
    `;
  }

  // ── Broker import modal ────────────────────────────────────
  function openBrokerImportModal() {
    const overlay = document.getElementById('tm-import-panel-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }
  function closeBrokerImportModal() {
    const overlay = document.getElementById('tm-import-panel-overlay');
    if (overlay) overlay.classList.add('hidden');
  }
  function closeTmImportPanel() { closeBrokerImportModal(); }
  function closeTmImportPanelIfOutside(e) {
    if (e.target===document.getElementById('tm-import-panel-overlay')) closeBrokerImportModal();
  }
  function closeBrokerImportIfOutside(e) { closeTmImportPanelIfOutside(e); }

  function applyBrokerImport() {
    const scrip  = (document.getElementById('tm-imp-scrip')?.value||'').trim();
    const buyPx  = parseFloat(document.getElementById('tm-imp-buy')?.value);
    const qty    = parseInt(document.getElementById('tm-imp-qty')?.value||'0',10);
    const type   = document.getElementById('tm-imp-type')?.value||'call';

    if (!scrip||isNaN(buyPx)) { alert('Enter scrip name and buy price to import.'); return; }

    // Pre-fill the setup form
    const instrEl = document.getElementById('tm-instrument');
    const entryEl = document.getElementById('tm-entry');
    if (instrEl) instrEl.value = scrip;
    if (entryEl) entryEl.value = fmtPts(buyPx);

    // Detect lot size from scrip name
    const det = detectQtyPerLot(scrip);
    if (det) qtyPerLot = det;

    // If qty provided, guess lots
    if (qty>0 && qtyPerLot>0) {
      const guessedLots = Math.max(1, Math.round(qty/qtyPerLot));
      lots = guessedLots;
      const lotsEl = document.getElementById('tm-lots');
      if (lotsEl) lotsEl.value = lots;
    }

    // Set instrument type
    setInstrumentType(type);

    closeBrokerImportModal();
    onSetupPriceInput();
    updateLotsInfo();

    // Focus the SL field — entry is filled, SL is what they need to set next
    setTimeout(() => document.getElementById('tm-sl')?.focus(), 100);
  }

  // ── Start trade ─────────────────────────────────────────────
  function startTradeManager() {
    const nameEl  = document.getElementById('tm-instrument');
    const entryEl = document.getElementById('tm-entry');
    const slEl    = document.getElementById('tm-sl');
    const tgtEl   = document.getElementById('tm-target');
    const lotsEl  = document.getElementById('tm-lots');
    const errEl   = document.getElementById('tm-setup-error');
    if (!entryEl||!slEl||!tgtEl||!errEl) return;

    const showErr = msg => { errEl.innerText=msg; errEl.classList.remove('hidden'); };
    errEl.classList.add('hidden');

    const e   = parseFloat(entryEl.value);
    const sl  = parseFloat(slEl.value);
    const tgt = parseFloat(tgtEl.value);
    const lv  = parseInt(lotsEl?.value||'1',10)||1;

    if (!instrumentType) { showErr('Select Call (CE) or Put (PE) above.'); return; }
    if (isNaN(e)||isNaN(sl)||isNaN(tgt)) { showErr('Enter entry, stop-loss, and target prices.'); return; }
    if (sl===e) { showErr("Stop-loss can't equal entry."); return; }

    direction = instrumentType; // 'call'=long, 'put'=short
    if (direction==='call'&&sl>=e) { showErr('For Call (CE), stop-loss must be below entry.'); return; }
    if (direction==='put' &&sl<=e) { showErr('For Put (PE), stop-loss must be above entry.'); return; }
    const tgtOk = direction==='put' ? tgt<e : tgt>e;
    if (!tgtOk) { showErr(direction==='put'?'Target must be below entry for Put.':'Target must be above entry for Call.'); return; }

    instrumentName = (nameEl?.value||'').trim();
    const det = detectQtyPerLot(instrumentName);
    if (det) qtyPerLot = det;
    lots = lv;
    entry = e; slPrice = sl; targetPrice = tgt;
    riskPoints   = Math.abs(e-sl);
    targetPoints = Math.abs(tgt-e);
    highestPointsInFavor = 0;
    isActive = true; isClosed = false;
    candleSeed = generateCandleSeed();

    collapseSetupToBar();
    document.getElementById('tm-active-wrap').classList.remove('hidden');
    const prEl = document.getElementById('tm-current-price');
    if (prEl) { prEl.value=''; prEl.disabled=false; }
    renderDirectionBadge();
    renderRrAnimation(0);
    renderResultArea(null);
  }

  function generateCandleSeed() {
    let sv = Math.round((entry||1)*97+(riskPoints||1)*13)%2147483647;
    const rnd = () => { sv=(sv*48271)%2147483647; return sv/2147483647; };
    let level=0, candles=[];
    const step = (riskPoints||1)*0.18;
    for (let i=0;i<16;i++) {
      const open=level,close=open+(rnd()-0.5)*step*2;
      const wH=Math.max(open,close)+rnd()*step*0.6;
      const wL=Math.min(open,close)-rnd()*step*0.6;
      candles.push({open,close,high:wH,low:wL}); level=close;
    }
    return candles;
  }

  function collapseSetupToBar() {
    const wrap = document.getElementById('tm-setup-wrap');
    if (!wrap) return;
    ['tm-instrument','tm-entry','tm-sl','tm-target','tm-lots','tm-start-btn'].forEach(id => {
      const el=document.getElementById(id); if(el) el.disabled=true;
    });
    document.querySelectorAll('.tm-type-pill,.tm-lots-step-btn').forEach(el=>el.disabled=true);

    const barText = document.getElementById('tm-collapsed-setup-text');
    if (barText) {
      const typeLabel = direction==='put'?'Put (PE)':'Call (CE)';
      const dirLabel  = direction==='put'?'Short':'Long';
      barText.innerHTML=`
        <span class="tm-collapsed-chip tm-collapsed-chip-${direction==='put'?'short':'long'}">${dirLabel} ${typeLabel}</span>
        <span class="tm-collapsed-chip">${instrumentName||'—'}</span>
        <span class="tm-collapsed-chip">Entry ${fmtPts(entry)}</span>
        <span class="tm-collapsed-chip">SL ${fmtPts(slPrice)}</span>
        <span class="tm-collapsed-chip">Target ${fmtPts(targetPrice)}</span>
        <span class="tm-collapsed-chip">${lots} lot${lots===1?'':'s'} × ${qtyPerLot}</span>
      `;
    }
    const rc = document.getElementById('tm-setup-review-content');
    if (rc) {
      const qty=lots*qtyPerLot;
      rc.innerHTML=`<div class="tm-review-grid">
        <div class="tm-review-item"><span class="tm-review-label">Instrument</span><span class="tm-review-value">${instrumentName||'—'}</span></div>
        <div class="tm-review-item"><span class="tm-review-label">Type</span><span class="tm-review-value">${direction==='call'?'Call (CE) — Long':'Put (PE) — Short'}</span></div>
        <div class="tm-review-item"><span class="tm-review-label">Entry</span><span class="tm-review-value">${fmtPts(entry)}</span></div>
        <div class="tm-review-item"><span class="tm-review-label">Stop-loss</span><span class="tm-review-value">${fmtPts(slPrice)}</span></div>
        <div class="tm-review-item"><span class="tm-review-label">Target</span><span class="tm-review-value">${fmtPts(targetPrice)}</span></div>
        <div class="tm-review-item"><span class="tm-review-label">Lots / Qty</span><span class="tm-review-value">${lots} × ${qtyPerLot} = ${qty}</span></div>
        <div class="tm-review-item"><span class="tm-review-label">Risk (₹)</span><span class="tm-review-value tm-review-risk">${fmtRs(riskPoints*qty)}</span></div>
        <div class="tm-review-item"><span class="tm-review-label">Reward (₹)</span><span class="tm-review-value tm-review-reward">${fmtRs(targetPoints*qty)}</span></div>
        <div class="tm-review-item"><span class="tm-review-label">R:R</span><span class="tm-review-value">1:${fmtPts(targetPoints/riskPoints)}</span></div>
      </div>`;
    }
    if (wrap) wrap.classList.add('tm-setup-collapsed');
    setupReviewOpen = false;
  }

  function toggleSetupReview() {
    if (!isActive) return;
    setupReviewOpen = !setupReviewOpen;
    const rev = document.getElementById('tm-setup-review');
    const chv = document.getElementById('tm-setup-review-chevron');
    if (rev) rev.classList.toggle('hidden',!setupReviewOpen);
    if (chv) chv.style.transform = setupReviewOpen?'rotate(180deg)':'';
  }

  function endTradeManager() {
    instrumentType=null; instrumentName=null; direction=null;
    entry=null; slPrice=null; targetPrice=null; riskPoints=null; targetPoints=null;
    lots=1; qtyPerLot=65; highestPointsInFavor=0;
    isActive=false; isClosed=false; candleSeed=[]; setupReviewOpen=false; selectedRrRatio=null;

    document.getElementById('tm-active-wrap').classList.add('hidden');
    const wrap = document.getElementById('tm-setup-wrap');
    if (wrap) wrap.classList.remove('tm-setup-collapsed');
    ['tm-instrument','tm-entry','tm-sl','tm-target','tm-lots'].forEach(id=>{
      const el=document.getElementById(id); if(el){el.value='';el.disabled=false;}
    });
    const sb = document.getElementById('tm-start-btn');
    if (sb) sb.disabled=false;
    document.querySelectorAll('.tm-type-pill,.tm-lots-step-btn').forEach(el=>el.disabled=false);
    document.querySelectorAll('.tm-type-pill').forEach(b=>b.classList.remove('tm-type-pill-active'));
    instrumentType=null;

    ['tm-setup-error','tm-rr-suggest-wrap','tm-position-summary'].forEach(id=>{
      document.getElementById(id)?.classList.add('hidden');
    });
    const rsg = document.getElementById('tm-rr-suggest-grid'); if(rsg) rsg.innerHTML='';
    const li = document.getElementById('tm-lots-info'); if(li) li.innerHTML='';
    const sr = document.getElementById('tm-setup-review'); if(sr) sr.classList.add('hidden');
    const slh = document.getElementById('tm-sl-hint'); if(slh) slh.innerText='';
    const th = document.getElementById('tm-target-hint'); if(th) th.innerText='';
    const emp = document.getElementById('tm-metrics-empty'); if(emp) emp.style.display='flex';
    const ps = document.getElementById('tm-position-summary'); if(ps){ps.innerHTML='';ps.classList.add('hidden');}
  }

  // ── Direction badge ────────────────────────────────────────
  function renderDirectionBadge() {
    const el = document.getElementById('tm-direction-badge-wrap');
    if (!el) return;
    const isLong = direction!=='put';
    el.innerHTML=`
      <div class="tm-direction-badge tm-direction-badge-${isLong?'long':'short'}">
        <span class="tm-direction-badge-icon">${isLong?'▲':'▼'}</span>
        <div>
          <span class="tm-direction-badge-label">${isLong?'Long':'Short'} — ${direction==='call'?'Call (CE)':'Put (PE)'}</span>
          <span class="tm-direction-badge-note">${isLong?'You profit when price rises. Stop-loss is below entry.':'You profit when price falls. Stop-loss is above entry.'}</span>
        </div>
      </div>
    `;
  }

  // ── Live price check-in ────────────────────────────────────
  function onTradeManagerPricePreview() {
    if (!isActive) return;
    const el = document.getElementById('tm-current-price');
    if (!el) return;
    const cur = parseFloat(el.value);
    if (el.value.trim()===''||isNaN(cur)) { renderRrAnimation(highestPointsInFavor); if(!isClosed) renderResultArea(null); return; }
    const pif = pointsInFavorFor(cur);
    renderRrAnimation(pif);
    if (isClosed) return;
    const previewH = Math.max(highestPointsInFavor||0, pif);
    const trailing = typeof window.computeTrailingSl==='function' ? window.computeTrailingSl(riskPoints,previewH) : null;
    renderResultArea('open',{pointsInFavor:pif,trailingSlPoints:trailing?trailing.slFromEntry:-riskPoints});
  }

  function onTradeManagerCheckIn() {
    if (!isActive) return;
    const el = document.getElementById('tm-current-price');
    if (!el) return;
    const cur = parseFloat(el.value);
    if (el.value.trim()===''||isNaN(cur)) { renderResultArea(null); renderRrAnimation(highestPointsInFavor); return; }
    const pif = pointsInFavorFor(cur);
    if (!isClosed&&pif>highestPointsInFavor) highestPointsInFavor=pif;
    if (!isClosed&&pif>=targetPoints) { isClosed=true; renderRrAnimation(Math.max(pif,0)); renderResultArea('target'); el.disabled=true; return; }
    const trailing = typeof window.computeTrailingSl==='function' ? window.computeTrailingSl(riskPoints,highestPointsInFavor) : null;
    const slPts = trailing?trailing.slFromEntry:-riskPoints;
    if (!isClosed&&pif<=slPts) {
      isClosed=true; renderRrAnimation(Math.max(pif,0));
      renderResultArea(trailing&&trailing.lockedProfit!==null?'stopped-locked':'stopped-neutral',{trailingSlPoints:slPts});
      el.disabled=true; return;
    }
    renderRrAnimation(Math.max(pif,0));
    if (!isClosed) renderResultArea('open',{pointsInFavor:pif,trailingSlPoints:slPts});
  }

  // ── Result cards ───────────────────────────────────────────
  function renderResultArea(state,extra) {
    const el = document.getElementById('tm-result-area');
    if (!el) return;
    if (state===null) { el.innerHTML=''; return; }
    const qty = lots*qtyPerLot;
    const rs = typeof window.getRiskSummary==='function'?window.getRiskSummary():null;
    const balance = rs?.currentBalance||null;

    if (state==='target') {
      const realRs=targetPoints*qty;
      const pct=balance?fmtPct(realRs/balance*100):null;
      el.innerHTML=`<div class="tm-result-card tm-result-target">
        <div class="tm-result-icon" style="font-size:36px;">🎉</div>
        <div class="tm-result-title">Target reached!</div>
        <div class="tm-result-stats">
          <span class="tm-result-stat"><strong>${fmtPts(targetPoints)} pts</strong> captured</span>
          <span class="tm-result-stat"><strong>${fmtRs(realRs)}</strong> realized${pct?' ('+pct+' of balance)':''}</span>
          <span class="tm-result-stat">1:${fmtPts(targetPoints/riskPoints)} R:R</span>
        </div>
      </div>`;
      return;
    }
    if (state==='stopped-locked'&&extra) {
      const capPts=extra.trailingSlPoints,capRs=capPts*qty;
      const pct=balance&&capRs>0?fmtPct(capRs/balance*100):null;
      el.innerHTML=`<div class="tm-result-card tm-result-stopped-locked">
        <div class="tm-result-icon">🛡️</div>
        <div class="tm-result-title">Stopped out — but you banked a win</div>
        <div class="tm-result-stats">
          <span class="tm-result-stat"><strong>${fmtPts(capPts)} pts</strong> captured</span>
          <span class="tm-result-stat"><strong>${fmtRs(capRs)}</strong>${pct?' ('+pct+' of balance)':''}</span>
        </div>
      </div>`;
      return;
    }
    if (state==='stopped-neutral') {
      const lossRs=riskPoints*qty;
      const pct=balance?fmtPct(lossRs/balance*100):null;
      el.innerHTML=`<div class="tm-result-card tm-result-stopped-neutral">
        <div class="tm-result-icon">↩️</div>
        <div class="tm-result-title">Stopped out at planned risk</div>
        <div class="tm-result-stats">
          <span class="tm-result-stat"><strong>${fmtPts(riskPoints)} pts</strong> lost</span>
          <span class="tm-result-stat"><strong>${fmtRs(lossRs)}</strong> loss${pct?' (−'+pct+' of balance)':''}</span>
        </div>
      </div>`;
      return;
    }
    if (state==='open'&&extra) {
      const pct=Math.max(0,Math.min(100,(extra.pointsInFavor/targetPoints)*100));
      const isRF=extra.trailingSlPoints>0;
      const curRs=extra.pointsInFavor*qty;
      const balPct=balance&&curRs!==0?fmtPct(Math.abs(curRs)/balance*100):null;
      el.innerHTML=`<div class="tm-result-card ${isRF?'tm-result-open-profit':'tm-result-open'}">
        <div class="tm-result-title">${fmtPts(extra.pointsInFavor)} pts in favor (${Math.round(pct)}% to target)${isRF?' · <strong>Risk-free</strong>':''}</div>
        <div class="tm-result-message">
          Unrealized: ${fmtRs(curRs)}${balPct?' ('+balPct+' of balance)':''}<br>
          Trailing stop: ${fmtPts(priceFromPIF(extra.trailingSlPoints))} (${extra.trailingSlPoints>=0?'+':''}${fmtPts(extra.trailingSlPoints)} pts from entry)
        </div>
      </div>`;
    }
  }

  // ── Chart ──────────────────────────────────────────────────
  function renderRrAnimation(pointsInFavor) {
    const container = document.getElementById('tm-rr-animation-area');
    if (!container||riskPoints===null||targetPoints===null) return;

    const clampedPIF=Math.max(-riskPoints,Math.min(targetPoints,pointsInFavor||0));
    const previewH=Math.max(highestPointsInFavor||0,clampedPIF);
    const trailing=typeof window.computeTrailingSl==='function'?window.computeTrailingSl(riskPoints,previewH):null;
    const trailSlPts=trailing?trailing.slFromEntry:-riskPoints;

    const W=600,H=300,padT=12,padB=12,plotH=H-padT-padB;
    const priceAtSl=priceFromPIF(-riskPoints);
    const priceAtTgt=priceFromPIF(targetPoints);
    const priceLow=Math.min(priceAtSl,priceAtTgt);
    const priceHigh=Math.max(priceAtSl,priceAtTgt);
    const span=priceHigh-priceLow;
    const yForPrice=p=>padT+(1-(p-priceLow)/span)*plotH;
    const yFor=pts=>yForPrice(priceFromPIF(pts));

    const ySl=yFor(-riskPoints),yEntry=yFor(0),yTarget=yFor(targetPoints);
    const yTrail=yFor(Math.max(trailSlPts,-riskPoints));
    const yCur=yFor(clampedPIF);

    const cW=(W-40)/(candleSeed.length||1);
    const candlesSvg=candleSeed.map((c,i)=>{
      const x=20+i*cW+cW*0.15,bW=cW*0.7;
      const cl=v=>Math.max(-riskPoints,Math.min(targetPoints,v));
      const yO=yFor(cl(c.open)),yC=yFor(cl(c.close));
      const yH=yFor(cl(c.high)),yL=yFor(cl(c.low));
      const bull=yC<yO,col=bull?'#5dcaa5':'#f0997b';
      return `<line x1="${x+bW/2}" y1="${yH}" x2="${x+bW/2}" y2="${yL}" stroke="${col}" stroke-width="1" opacity="0.4"/>
              <rect x="${x}" y="${Math.min(yO,yC)}" width="${bW}" height="${Math.max(Math.abs(yC-yO),1.5)}" fill="${col}" opacity="0.4" rx="1"/>`;
    }).join('');

    const refRatios=[1,2,3].filter(r=>r*riskPoints<=targetPoints+0.001);
    const refSvg=refRatios.map(r=>`
      <line x1="0" y1="${yFor(r*riskPoints)}" x2="${W}" y2="${yFor(r*riskPoints)}" stroke="#9aa5b1" stroke-width="0.75" stroke-dasharray="3 4" opacity="0.5"/>
      <text x="${W-6}" y="${yFor(r*riskPoints)-4}" text-anchor="end" font-size="10" fill="#5f6b7a">1:${r}</text>
    `).join('');

    const qty=lots*qtyPerLot;
    const slRs=fmtRs(riskPoints*qty),tgtRs=fmtRs(targetPoints*qty);
    const trailRs=trailSlPts>=0?'+'+fmtRs(trailSlPts*qty):'−'+fmtRs(Math.abs(trailSlPts*qty));

    container.innerHTML=`
      <div style="position:relative;">
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block;overflow:visible;">
          <rect x="0" y="${Math.min(yTarget,yEntry)}" width="${W}" height="${Math.abs(yEntry-yTarget)}" fill="#1d9e75" opacity="0.28"/>
          <rect x="0" y="${Math.min(yEntry,ySl)}"    width="${W}" height="${Math.abs(ySl-yEntry)}"    fill="#d9381e" opacity="${trailing&&trailing.lockedProfit!==null?0:0.28}"/>
          ${candlesSvg}
          ${refSvg}
          <line x1="0" y1="${ySl}"     x2="${W}" y2="${ySl}"     stroke="#d9381e" stroke-width="1.5"/>
          <line x1="0" y1="${yEntry}"  x2="${W}" y2="${yEntry}"  stroke="#5f6b7a" stroke-width="1.5"/>
          <line x1="0" y1="${yTarget}" x2="${W}" y2="${yTarget}" stroke="#1d9e75" stroke-width="1.5"/>
          <line x1="0" y1="${yTrail}"  x2="${W}" y2="${yTrail}"  stroke="#2e75b6" stroke-width="3"/>
          <line x1="0" y1="${yCur}"    x2="${W}" y2="${yCur}"    stroke="#1f3a5f" stroke-width="2" stroke-dasharray="6 3"/>
        </svg>
        <div style="position:absolute;left:8px;top:${Math.max(ySl-8,0)}px;font-size:11px;color:#d9381e;font-weight:600;white-space:nowrap;">SL ${fmtPts(slPrice)}</div>
        <div style="position:absolute;left:8px;top:${Math.max(yEntry-8,0)}px;font-size:11px;color:#5f6b7a;font-weight:600;">Entry ${fmtPts(entry)}</div>
        <div style="position:absolute;left:8px;top:${Math.max(yTarget-8,0)}px;font-size:11px;color:#1d9e75;font-weight:600;">Target ${fmtPts(targetPrice)}</div>
        <div class="tm-level-pill tm-level-pill-risk" style="top:${Math.max(ySl-14,0)}px;">
          <span class="tm-level-pill-price">${fmtPts(slPrice)}</span>
          <span class="tm-level-pill-rs">${slRs} risk</span>
        </div>
        <div class="tm-level-pill tm-level-pill-reward" style="top:${Math.max(yTarget-14,0)}px;">
          <span class="tm-level-pill-price">${fmtPts(targetPrice)}</span>
          <span class="tm-level-pill-rs">${tgtRs} reward</span>
        </div>
        <div class="tm-level-pill tm-level-pill-trail" style="top:${Math.max(yTrail-14,0)}px;">
          <span class="tm-level-pill-price">Trail ${fmtPts(priceFromPIF(trailSlPts))}</span>
          <span class="tm-level-pill-rs">${trailRs}</span>
        </div>
        <div style="position:absolute;right:8px;top:${Math.max(yCur-9,0)}px;font-size:11px;color:#1f3a5f;font-weight:700;">▶ ${fmtPts(priceFromPIF(clampedPIF))}</div>
        ${isClosed?`<div style="position:absolute;inset:0;background:rgba(248,250,252,0.78);display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:8px;">
          <div style="width:40px;height:40px;border-radius:50%;background:#1d9e75;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:6px;">✓</div>
          <div style="font-size:13px;font-weight:700;color:#1f3a5f;">Trade closed</div>
        </div>`:''}
      </div>
      <p class="foot-note" style="margin-top:6px;"><span style="color:#2e75b6;">━</span> blue = trailing stop · <span style="color:#1f3a5f;">╌</span> dashed = current price</p>
    `;
  }

  // ── Expose ─────────────────────────────────────────────────
  window.startTradeManager            = startTradeManager;
  window.endTradeManager              = endTradeManager;
  window.setInstrumentType            = setInstrumentType;
  window.stepLots                     = stepLots;
  window.onLotsInput                  = onLotsInput;
  window.onSetupPriceInput            = onSetupPriceInput;
  window.applyRrSuggestion            = applyRrSuggestion;
  window.toggleSetupReview            = toggleSetupReview;
  window.onTradeManagerPricePreview   = onTradeManagerPricePreview;
  window.onTradeManagerCheckIn        = onTradeManagerCheckIn;
  window.openBrokerImportModal        = openBrokerImportModal;
  window.closeBrokerImportModal       = closeBrokerImportModal;
  window.closeBrokerImportIfOutside   = closeBrokerImportIfOutside;
  window.closeTmImportPanel           = closeTmImportPanel;
  window.closeTmImportPanelIfOutside  = closeTmImportPanelIfOutside;
  window.applyBrokerImport            = applyBrokerImport;

})();