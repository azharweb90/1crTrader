/* ===========================================================
   COMPONENT: risk-calculator (logic)
   Loaded lazily by dashboard.js the first time this tab opens.

   MODEL: each trade is submitted individually, right where it's logged.
   - Trade 1 has its own outcome buttons + amount + "Submit Trade 1" button.
     Submitting it locks Trade 1's inputs and evaluates the kill-switch rules:
       - Profit -> day over, Trade 2 stays locked.
       - Loss >= 100% of max daily loss -> day over, Trade 2 stays locked.
       - Loss >= 75% (soft block) -> day over, Trade 2 stays locked.
       - Loss < 75% -> Trade 2 unlocks.
   - Trade 2 (only reachable after a sub-cutoff Trade 1 loss) has its own
     outcome buttons + amount + "Submit Trade 2" button. Submitting it always
     ends the day, regardless of outcome.
   - Each submitted trade is recorded as its OWN history entry (not combined
     into one per-day entry), via window.recordCompletedDay().
   =========================================================== */

(function () {

  // ---------- Tier rules matrix ----------
  // loss = max daily loss amount in rupees, pct = that loss as % of tier capital
  // NOTE: Small tier uses a FLAT Rs. 1,800 max loss at every sub-level (not % of capital).
  // Medium/Large/Pro scale at 2% of capital per sub-level.
  const tierRulesMatrix = {
    "small-1":  { cap: 25000,    pct: 7.20, loss: 1800 },
    "small-2":  { cap: 50000,    pct: 3.60, loss: 1800 },
    "small-3":  { cap: 75000,    pct: 2.40, loss: 1800 },
    "medium-1": { cap: 100000,   pct: 2,  loss: 2000 },
    "medium-2": { cap: 200000,   pct: 2,  loss: 4000 },
    "medium-3": { cap: 500000,   pct: 2,  loss: 10000 },
    "large-1":  { cap: 500000,   pct: 2,  loss: 10000 },
    "large-2":  { cap: 750000,   pct: 2,  loss: 15000 },
    "large-3":  { cap: 1000000,  pct: 2,  loss: 20000 },
    "pro-1":    { cap: 1000000,  pct: 2,  loss: 20000 },
    "pro-2":    { cap: 1500000,  pct: 2,  loss: 30000 },
    "pro-3":    { cap: 2000000,  pct: 2,  loss: 40000 },
  };

  const SOFT_BLOCK_RATIO = 0.75; // 75% of max daily loss blocks Trade 2 (soft block)

  // ---------- State ----------
  let trade1Status = null;     // 'profit' | 'loss' | null
  let trade1Amount = 0;        // rupees, always a positive number entered by user
  let trade1Submitted = false; // true once Trade 1 has been individually submitted
  let trade1Instrument = '';   // label of the instrument picked for Trade 1
  let trade1TradeId = null;    // history id assigned once Trade 1 is submitted
  let trade2Status = null;
  let trade2Amount = 0;
  let trade2Submitted = false; // true once Trade 2 has been individually submitted
  let trade2Unlocked = false;  // true once Trade 1 was submitted as a sub-cutoff loss
  let trade2Instrument = '';
  let trade2TradeId = null;
  let quickJournalTradeId = null; // which trade's quick-note modal is currently open (after submit)
  let quickJournalDraftSlot = null; // which trade SLOT (1 or 2) the modal is drafting for, before that trade has a real id
  let journalDrafts = { 1: null, 2: null }; // { strategy, emotion } per slot, written before submit

  function fmt(n) {
    return Math.round(n).toLocaleString('en-IN');
  }

  function currentRule() {
    const key = document.getElementById('calc-tier').value;
    return tierRulesMatrix[key];
  }

  // ---------- Instrument dropdowns ----------
  function populateInstrumentDropdowns() {
    const options = (typeof window.getAllTradableInstruments === 'function') ? window.getAllTradableInstruments() : [];
    [1, 2].forEach(tradeNum => {
      const select = document.getElementById(`t${tradeNum}-instrument`);
      if (!select) return;
      const placeholder = '<option value="">Select instrument</option>';
      select.innerHTML = placeholder + options.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
    });
  }

  function onTradeInstrumentChange(tradeNum) {
    const select = document.getElementById(`t${tradeNum}-instrument`);
    const label = select && select.selectedOptions.length ? select.selectedOptions[0].text : '';
    if (tradeNum === 1) {
      trade1Instrument = select && select.value ? label : '';
    } else {
      trade2Instrument = select && select.value ? label : '';
    }
  }

  // ---------- Always-visible log date ----------
  function initLogDate() {
    const input = document.getElementById('log-date-input');
    const hint = document.getElementById('log-date-hint');
    if (!input) return;

    const state = (typeof window.getProfileState === 'function') ? window.getProfileState() : {};
    const today = state.today || '';
    const joinDate = state.joinDate || '';

    input.min = joinDate;
    input.max = today;
    if (!input.value) {
      input.value = today;
    }

    if (hint) {
      hint.innerText = joinDate
        ? `Defaults to today. You can backfill any day from ${joinDate} (when you joined) through today.`
        : `Defaults to today.`;
    }
  }

  function onLogDateInput() {
    const input = document.getElementById('log-date-input');
    const errorEl = document.getElementById('log-date-error');
    if (!input) return;

    const state = (typeof window.getProfileState === 'function') ? window.getProfileState() : {};
    const today = state.today || '';
    const joinDate = state.joinDate || '';
    const chosen = input.value;

    const outOfRange = chosen && ((joinDate && chosen < joinDate) || (today && chosen > today));

    if (outOfRange) {
      input.classList.add('input-error');
      if (errorEl) {
        errorEl.classList.remove('hidden');
        errorEl.innerText = `Date must be between ${joinDate || 'your join date'} and ${today || 'today'}.`;
      }
    } else {
      input.classList.remove('input-error');
      if (errorEl) {
        errorEl.classList.add('hidden');
        errorEl.innerText = '';
      }
    }
    updateTradeSubmitButtons();
  }

  function getSelectedLogDate() {
    const input = document.getElementById('log-date-input');
    return input ? input.value : null;
  }

  function isLogDateValid() {
    const input = document.getElementById('log-date-input');
    if (!input) return true;
    return !input.classList.contains('input-error') && !!input.value;
  }

  function onTierChange() {
    resetTracker();
    updateYourLimitCallout();
    if (typeof window.renderInstrumentSlTable === 'function') {
      window.renderInstrumentSlTable();
    }
  }

  function updateYourLimitCallout() {
    const rule = currentRule();
    const el = document.getElementById('your-limit-value');
    if (rule && el) {
      el.innerText = `Rs. ${fmt(rule.loss)} (${rule.pct.toFixed(2)}%)`;
    }
    const maxLossEl = document.getElementById('out-max-loss');
    if (maxLossEl) {
      maxLossEl.innerText = rule ? `Rs. ${fmt(rule.loss)} (${rule.pct.toFixed(2)}%)` : '—';
    }
  }

  // ---------- Outcome button handlers ----------
  function setOutcome(tradeNum, outcome) {
    if (tradeNum === 1) {
      if (trade1Submitted) return;
      trade1Status = outcome;
      trade1Amount = 0;
      document.getElementById('t1-amount').value = '';
    } else {
      if (trade2Submitted || !trade2Unlocked) return;
      trade2Status = outcome;
      trade2Amount = 0;
      document.getElementById('t2-amount').value = '';
    }
    showAmountBox(tradeNum, outcome);

    // Journal note becomes available as soon as an outcome is chosen —
    // before submitting — so the trader can write their reasoning while
    // it's fresh, rather than only after the trade is already locked in.
    const journalBtn = document.getElementById(`t${tradeNum}-journal-btn`);
    if (journalBtn) journalBtn.disabled = false;

    renderTradeState();
  }

  function showAmountBox(tradeNum, outcome) {
    const wrap = document.getElementById(`t${tradeNum}-amount-wrap`);
    const label = document.getElementById(`t${tradeNum}-amount-label`);
    if (outcome === 'profit') {
      // Profit amount isn't needed for rule evaluation, but we still let the
      // user log it for their own record (label adjusts accordingly).
      label.innerText = 'Enter profit amount (Rs.) — optional';
      wrap.classList.remove('hidden');
    } else {
      label.innerText = 'Enter loss amount (Rs.)';
      wrap.classList.remove('hidden');
    }
  }

  function onAmountInput(tradeNum) {
    const input = document.getElementById(`t${tradeNum}-amount`);
    const val = parseFloat(input.value);
    const amount = isNaN(val) || val < 0 ? 0 : val;

    if (tradeNum === 1) {
      if (trade1Submitted) return;
      trade1Amount = amount;
    } else {
      if (trade2Submitted) return;
      trade2Amount = amount;
    }
    input.classList.remove('input-error');
    renderTradeState();
  }

  function resetTracker() {
    trade1Status = null;
    trade1Amount = 0;
    trade1Submitted = false;
    trade1Instrument = '';
    trade1TradeId = null;
    trade2Status = null;
    trade2Amount = 0;
    trade2Submitted = false;
    trade2Unlocked = false;
    trade2Instrument = '';
    trade2TradeId = null;
    journalDrafts = { 1: null, 2: null };

    populateInstrumentDropdowns();
    const t1Instr = document.getElementById('t1-instrument');
    const t2Instr = document.getElementById('t2-instrument');
    if (t1Instr) { t1Instr.value = ''; t1Instr.disabled = false; }
    if (t2Instr) { t2Instr.value = ''; t2Instr.disabled = true; }

    const t1JournalBtn = document.getElementById('t1-journal-btn');
    const t2JournalBtn = document.getElementById('t2-journal-btn');
    if (t1JournalBtn) t1JournalBtn.disabled = true;
    if (t2JournalBtn) t2JournalBtn.disabled = true;

    ['t1-amount', 't2-amount'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.value = '';
        el.classList.remove('input-error');
        el.disabled = false;
      }
    });
    const w1 = document.getElementById('t1-amount-wrap');
    const w2 = document.getElementById('t2-amount-wrap');
    if (w1) w1.classList.add('hidden');
    if (w2) w2.classList.add('hidden');

    const t1ProfitBtn = document.getElementById('t1-profit');
    const t1LossBtn = document.getElementById('t1-loss');
    if (t1ProfitBtn) { t1ProfitBtn.disabled = false; t1ProfitBtn.className = "outcome-btn"; }
    if (t1LossBtn) { t1LossBtn.disabled = false; t1LossBtn.className = "outcome-btn"; }

    const t2Container = document.getElementById('t2-container');
    if (t2Container) t2Container.classList.add('locked');
    const t2ProfitBtn = document.getElementById('t2-profit');
    const t2LossBtn = document.getElementById('t2-loss');
    if (t2ProfitBtn) { t2ProfitBtn.disabled = true; t2ProfitBtn.className = "outcome-btn"; }
    if (t2LossBtn) { t2LossBtn.disabled = true; t2LossBtn.className = "outcome-btn"; }

    setAlert(
      document.getElementById('calc-alert'),
      document.getElementById('alert-status'),
      document.getElementById('alert-message'),
      'success', 'Parameters Normal',
      "Select a tier and log Trade #1 to begin evaluating today's session."
    );
    const pnlDisplay = document.getElementById('out-daily-pnl');
    if (pnlDisplay) {
      pnlDisplay.innerText = 'No Trades Run';
      pnlDisplay.style.color = '#5f6b7a';
    }

    const t2Status = document.getElementById('t2-submit-status');
    if (t2Status) t2Status.innerText = 'Submit Trade 1 as a loss under the cutoff to unlock this.';

    renderTradeState();
  }

  // ---------- Live preview (before submitting) ----------
  // Reflects button styling and the live "amount entered so far" display,
  // but does NOT evaluate kill-switch rules — those fire only at submit time.
  function renderTradeState() {
    const t1ProfitBtn = document.getElementById('t1-profit');
    const t1LossBtn = document.getElementById('t1-loss');
    const t2ProfitBtn = document.getElementById('t2-profit');
    const t2LossBtn = document.getElementById('t2-loss');

    if (!trade1Submitted) {
      t1ProfitBtn.className = "outcome-btn" + (trade1Status === 'profit' ? " active-profit" : "");
      t1LossBtn.className = "outcome-btn" + (trade1Status === 'loss' ? " active-loss" : "");
    }
    if (trade2Unlocked && !trade2Submitted) {
      t2ProfitBtn.className = "outcome-btn" + (trade2Status === 'profit' ? " active-profit" : "");
      t2LossBtn.className = "outcome-btn" + (trade2Status === 'loss' ? " active-loss" : "");
    }

    updateTradeSubmitButtons();

    // Live P&L preview reflecting whatever is submitted so far.
    let pnlText = 'No Trades Run';
    let pnlColor = '#5f6b7a';

    if (trade1Submitted) {
      const t1Net = trade1Status === 'profit' ? trade1Amount : -trade1Amount;
      if (trade2Submitted) {
        const t2Net = trade2Status === 'profit' ? trade2Amount : -trade2Amount;
        const combined = t1Net + t2Net;
        pnlText = `${combined >= 0 ? '+' : '-'}Rs. ${fmt(Math.abs(combined))} (Day Complete)`;
        pnlColor = combined >= 0 ? '#1d9e75' : '#d9381e';
      } else {
        pnlText = `${t1Net >= 0 ? '+' : '-'}Rs. ${fmt(Math.abs(t1Net))} (Trade 1 Submitted)`;
        pnlColor = t1Net >= 0 ? '#1d9e75' : '#d9381e';
      }
    }

    const pnlDisplay = document.getElementById('out-daily-pnl');
    if (pnlDisplay) {
      pnlDisplay.innerText = pnlText;
      pnlDisplay.style.color = pnlColor;
    }
  }

  function setAlert(box, titleEl, msgEl, type, title, message) {
    box.className = `alert-banner ${type}`;
    titleEl.innerText = title;
    msgEl.innerText = message;
  }

  // ---------- Per-trade submit button state ----------
  function updateTradeSubmitButtons() {
    const t1Btn = document.getElementById('t1-submit-btn');
    const t1Status = document.getElementById('t1-submit-status');
    const t2Btn = document.getElementById('t2-submit-btn');
    const t2Status = document.getElementById('t2-submit-status');
    const dateOk = isLogDateValid();

    if (t1Btn && t1Status) {
      if (trade1Submitted) {
        t1Btn.disabled = true;
        t1Btn.innerText = 'Trade 1 Submitted ✓';
        t1Status.innerText = 'Locked in and added to your balance and history below.';
      } else {
        t1Btn.innerText = 'Submit Trade 1';
        if (trade1Status === null) {
          t1Btn.disabled = true;
          t1Status.innerText = 'Pick an outcome to continue.';
        } else if (trade1Status === 'loss' && trade1Amount <= 0) {
          t1Btn.disabled = true;
          t1Status.innerText = 'Enter the loss amount to continue.';
        } else if (!dateOk) {
          t1Btn.disabled = true;
          t1Status.innerText = 'Fix the date above before submitting.';
        } else {
          t1Btn.disabled = false;
          t1Status.innerText = 'Ready to submit Trade 1.';
        }
      }
    }

    if (t2Btn && t2Status) {
      if (!trade2Unlocked) {
        t2Btn.disabled = true;
        // status text left as the "locked" message set elsewhere
      } else if (trade2Submitted) {
        t2Btn.disabled = true;
        t2Btn.innerText = 'Trade 2 Submitted ✓';
      } else {
        t2Btn.innerText = 'Submit Trade 2';
        if (trade2Status === null) {
          t2Btn.disabled = true;
          t2Status.innerText = 'Pick an outcome for this final trade.';
        } else if (trade2Status === 'loss' && trade2Amount <= 0) {
          t2Btn.disabled = true;
          t2Status.innerText = 'Enter the loss amount to continue.';
        } else if (!dateOk) {
          t2Btn.disabled = true;
          t2Status.innerText = 'Fix the date above before submitting.';
        } else {
          t2Btn.disabled = false;
          t2Status.innerText = 'Ready to submit Trade 2 — this ends the day.';
        }
      }
    }
  }

  // ---------- Submit Trade 1 ----------
  function submitTrade1() {
    if (trade1Submitted || trade1Status === null || !isLogDateValid()) return;
    if (trade1Status === 'loss' && trade1Amount <= 0) return;

    const rule = currentRule();
    if (!rule) return;

    trade1Submitted = true;

    document.getElementById('t1-profit').disabled = true;
    document.getElementById('t1-loss').disabled = true;
    document.getElementById('t1-amount').disabled = true;
    document.getElementById('t1-instrument').disabled = true;

    const alertBox = document.getElementById('calc-alert');
    const alertTitle = document.getElementById('alert-status');
    const alertMsg = document.getElementById('alert-message');
    const t2Container = document.getElementById('t2-container');
    const t2Status = document.getElementById('t2-submit-status');

    const netResult = trade1Status === 'profit' ? trade1Amount : -trade1Amount;

    if (trade1Status === 'profit') {
      setAlert(alertBox, alertTitle, alertMsg, "danger",
        "Kill Switch Activated — Day Over",
        "Trade #1 closed in profit. No further trades allowed today. Close the day and protect this profit — that discipline is the win.");
      trade2Unlocked = false;
    } else {
      const lossRatio = rule.loss > 0 ? (trade1Amount / rule.loss) : 0;

      if (trade1Amount >= rule.loss) {
        setAlert(alertBox, alertTitle, alertMsg, "danger",
          "Kill Switch Activated — Day Over",
          `Trade #1 loss has reached or exceeded your maximum daily loss of Rs. ${fmt(rule.loss)}. Shut down the system. Come back fresh tomorrow.`);
        trade2Unlocked = false;
      } else if (lossRatio >= SOFT_BLOCK_RATIO) {
        setAlert(alertBox, alertTitle, alertMsg, "warning",
          "Trade #2 Not Allowed Today",
          `Trade #1 loss has used ${(lossRatio * 100).toFixed(0)}% of today's Rs. ${fmt(rule.loss)} limit — at or above the 75% cutoff. Trade #2 is blocked as a precaution, even though the full limit isn't breached yet.`);
        trade2Unlocked = false;
      } else {
        setAlert(alertBox, alertTitle, alertMsg, "success",
          "Trade #2 Window Open",
          "Trade #1 loss is below the 75% cutoff. You may take exactly one more trade today. This is your final trade regardless of outcome.");
        trade2Unlocked = true;
      }
    }

    if (t2Container) t2Container.classList.toggle('locked', !trade2Unlocked);
    if (trade2Unlocked) {
      document.getElementById('t2-profit').disabled = false;
      document.getElementById('t2-loss').disabled = false;
      if (t2Status) t2Status.innerText = 'Pick an outcome for this final trade.';
    }

    const chosenDate = getSelectedLogDate();
    if (typeof window.recordCompletedDay === 'function') {
      trade1TradeId = window.recordCompletedDay(netResult, chosenDate, trade1Instrument);
    }
    commitJournalDraft(1, trade1TradeId);
    if (typeof window.renderCalculatorHistory === 'function') {
      window.renderCalculatorHistory();
    }

    const t1JournalBtn = document.getElementById('t1-journal-btn');
    if (t1JournalBtn) t1JournalBtn.disabled = false;

    renderTradeState();
  }

  // ---------- Submit Trade 2 ----------
  function submitTrade2() {
    if (!trade2Unlocked || trade2Submitted || trade2Status === null || !isLogDateValid()) return;
    if (trade2Status === 'loss' && trade2Amount <= 0) return;

    trade2Submitted = true;

    document.getElementById('t2-profit').disabled = true;
    document.getElementById('t2-loss').disabled = true;
    document.getElementById('t2-amount').disabled = true;
    document.getElementById('t2-instrument').disabled = true;

    const alertBox = document.getElementById('calc-alert');
    const alertTitle = document.getElementById('alert-status');
    const alertMsg = document.getElementById('alert-message');

    const netResult = trade2Status === 'profit' ? trade2Amount : -trade2Amount;

    setAlert(alertBox, alertTitle, alertMsg, "danger",
      "Kill Switch Activated — Day Over",
      "Trade #2 has been completed. Maximum of 2 trades reached for today — no further trades, regardless of this result.");

    const chosenDate = getSelectedLogDate();
    if (typeof window.recordCompletedDay === 'function') {
      trade2TradeId = window.recordCompletedDay(netResult, chosenDate, trade2Instrument);
    }
    commitJournalDraft(2, trade2TradeId);
    if (typeof window.renderCalculatorHistory === 'function') {
      window.renderCalculatorHistory();
    }

    const t2JournalBtn = document.getElementById('t2-journal-btn');
    if (t2JournalBtn) t2JournalBtn.disabled = false;

    renderTradeState();
  }

  // Dispatcher used by the HTML's onclick="submitTrade(1)" / submitTrade(2)
  function submitTrade(tradeNum) {
    if (tradeNum === 1) {
      submitTrade1();
    } else {
      submitTrade2();
    }
  }

  // ---------- Compact history table embedded on this screen ----------
  function formatDateShort(isoDateString) {
    const d = new Date(isoDateString);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function renderCalculatorHistory() {
    const container = document.getElementById('calc-history-area');
    if (!container) return;

    const history = (typeof window.getTradeHistory === 'function') ? window.getTradeHistory() : [];

    if (!history || history.length === 0) {
      container.innerHTML = '<div class="roadmap-empty-state">No trades submitted yet. Submit Trade 1 above to see it here.</div>';
      return;
    }

    // Most recent submission first; show the last 5 for a compact view.
    const rows = history.slice().reverse().slice(0, 5);

    let html = '<div class="calc-history-grid">';
    html += `
      <div class="calc-history-cell calc-history-head">Date</div>
      <div class="calc-history-cell calc-history-head num">Net Result</div>
      <div class="calc-history-cell calc-history-head num">Balance After</div>
    `;

    rows.forEach(entry => {
      const isWin = entry.netResult > 0;
      const sign = isWin ? '+' : (entry.netResult < 0 ? '-' : '');
      const resultClass = isWin ? 'calc-history-win' : (entry.netResult < 0 ? 'calc-history-loss' : '');
      html += `
        <div class="calc-history-cell">${formatDateShort(entry.date)}</div>
        <div class="calc-history-cell num ${resultClass}">${sign}Rs. ${fmt(Math.abs(entry.netResult))}</div>
        <div class="calc-history-cell num">Rs. ${fmt(entry.balanceAfter)}</div>
      `;
    });

    html += '</div>';

    if (history.length > 5) {
      html += `<p class="foot-note" style="margin-top:8px;">Showing the 5 most recent of ${history.length} logged trades. See the full history on the Roadmap tab.</p>`;
    }

    container.innerHTML = html;
  }

  // ---------- Quick journal note modal ----------
  // Lightweight note (Strategy/Reason + Emotion) for a trade. Available as
  // soon as an outcome is picked for that trade slot — BEFORE it's
  // submitted — so the trader can write down their reasoning while it's
  // still fresh, not as an afterthought once the trade is already logged.
  //
  // Before submit: held as a draft in journalDrafts[slot] (no trade id yet).
  // After submit: the draft (if any) is merged into the real journal entry
  // via window.saveJournalEntry, and editing reopens against the real id —
  // matching the same record used by the full Trading Journal tab.
  function openQuickJournalModal(tradeNum) {
    const tradeId = tradeNum === 1 ? trade1TradeId : trade2TradeId;
    const strategyEl = document.getElementById('qj-strategy');
    const emotionEl = document.getElementById('qj-emotion');
    const statusEl = document.getElementById('qj-save-status');

    if (tradeId) {
      // Trade already submitted — edit the real, saved journal entry.
      quickJournalTradeId = tradeId;
      quickJournalDraftSlot = null;

      const existing = (typeof window.getJournalEntry === 'function') ? window.getJournalEntry(tradeId) : null;
      strategyEl.value = existing ? (existing.setupReason || '') : '';
      emotionEl.value = existing ? (existing.emotion || '') : '';
      if (statusEl) statusEl.innerText = existing ? 'Editing this trade\u2019s existing note.' : '';
    } else {
      // Not submitted yet — open/edit the in-memory draft for this slot.
      quickJournalTradeId = null;
      quickJournalDraftSlot = tradeNum;

      const draft = journalDrafts[tradeNum];
      strategyEl.value = draft ? draft.strategy : '';
      emotionEl.value = draft ? draft.emotion : '';
      if (statusEl) statusEl.innerText = 'Draft note \u2014 saved automatically with this trade once you submit it.';
    }

    const overlay = document.getElementById('quick-journal-modal-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  function closeQuickJournalModal() {
    quickJournalTradeId = null;
    quickJournalDraftSlot = null;
    const overlay = document.getElementById('quick-journal-modal-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function onQuickJournalOverlayClick(event) {
    // Close only when the dark backdrop itself is clicked, not the modal card.
    if (event.target.id === 'quick-journal-modal-overlay') {
      closeQuickJournalModal();
    }
  }

  function saveQuickJournalNote() {
    const strategy = document.getElementById('qj-strategy').value.trim();
    const emotion = document.getElementById('qj-emotion').value.trim();
    const statusEl = document.getElementById('qj-save-status');

    if (quickJournalTradeId) {
      // Editing an already-submitted trade's real entry.
      if (typeof window.saveJournalEntry === 'function') {
        window.saveJournalEntry(quickJournalTradeId, { setupReason: strategy, emotion: emotion });
      }
      if (statusEl) statusEl.innerText = 'Saved. You can expand this into the full entry anytime from the Trading Journal tab.';
      if (typeof window.renderJournalList === 'function') {
        window.renderJournalList();
      }
    } else if (quickJournalDraftSlot) {
      // Trade not submitted yet — hold this as a draft for that slot.
      journalDrafts[quickJournalDraftSlot] = { strategy, emotion };
      if (statusEl) statusEl.innerText = 'Draft saved \u2014 it will attach automatically when you submit this trade.';
    } else {
      return;
    }

    setTimeout(closeQuickJournalModal, 700);
  }

  // Called right after a trade is submitted, to transfer any pre-submit
  // draft note for that slot onto the trade's now-real history id.
  function commitJournalDraft(tradeNum, tradeId) {
    const draft = journalDrafts[tradeNum];
    if (!draft || !tradeId) return;
    if ((draft.strategy || draft.emotion) && typeof window.saveJournalEntry === 'function') {
      window.saveJournalEntry(tradeId, { setupReason: draft.strategy, emotion: draft.emotion });
      if (typeof window.renderJournalList === 'function') {
        window.renderJournalList();
      }
    }
    journalDrafts[tradeNum] = null;
  }

  // Expose the handlers the inline HTML markup calls via onclick/onchange.
  // Scoped onto window since the component HTML is injected via innerHTML
  // and its inline event attributes resolve against the global scope.
  window.onTierChange = onTierChange;
  window.setOutcome = setOutcome;
  window.onAmountInput = onAmountInput;
  window.resetTracker = resetTracker;
  window.onLogDateInput = onLogDateInput;
  window.submitTrade = submitTrade;
  window.renderCalculatorHistory = renderCalculatorHistory;
  window.onTradeInstrumentChange = onTradeInstrumentChange;
  window.openQuickJournalModal = openQuickJournalModal;
  window.closeQuickJournalModal = closeQuickJournalModal;
  window.onQuickJournalOverlayClick = onQuickJournalOverlayClick;
  window.saveQuickJournalNote = saveQuickJournalNote;

  // Run once on load so the panel reflects "no trades yet" immediately.
  resetTracker();
  updateYourLimitCallout();
  initLogDate();
  renderCalculatorHistory();

})();
/* === END COMPONENT: risk-calculator (logic) === */