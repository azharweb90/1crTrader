/* ===========================================================
   COMPONENT: risk-calculator (logic)
   Loaded lazily by dashboard.js the first time this tab opens.

   MODEL: each trade is submitted individually, right where it's logged.
   - Trade 1 has its own outcome buttons + amount + "Submit Trade 1" button.
     Submitting it evaluates the kill-switch + cooldown rules:
       - Loss >= 100% of max daily loss -> kill switch, day over, no cooldown shown.
       - Loss >= 75% (soft block) -> kill switch, day over, no cooldown shown.
       - Otherwise (profit, OR a loss below 75%) -> a mandatory 30-minute
         cooldown starts. Trade 2 stays locked and a "step away from the
         chart" banner with a live countdown is shown until it elapses.
   - Trade 2 only becomes enterable once the cooldown finishes. It has its
     own outcome buttons + amount + "Submit Trade 2" button. Submitting it
     always ends the day, regardless of outcome.
   - Each submitted trade is recorded as its OWN history entry (not combined
     into one per-day entry), via window.recordCompletedDay().
   - The cooldown deadline is persisted to localStorage (not just an in-memory
     timer) so refreshing the page or closing the tab doesn't let someone
     dodge the wait — it resumes counting down from the stored deadline.
   =========================================================== */

(function () {

  // ---------- Tier rules matrix ----------
  // loss = max daily loss amount in rupees, pct = that loss as % of tier capital
  // NOTE: Small tier uses a FLAT Rs. 1,800 max loss at every sub-level (not % of capital).
  // Medium/Large/Pro scale at 2% of capital per sub-level.
  // tierRulesMatrix itself now lives in dashboard.js (window.tierRulesMatrix)
  // — that's always loaded, so the Dashboard and other screens can read tier
  // rules without this component ever having been opened. Kept as a local
  // alias here so the rest of this file's `tierRulesMatrix` references don't
  // all need rewriting.
  const tierRulesMatrix = window.tierRulesMatrix || {};

  const SOFT_BLOCK_RATIO = 0.75; // 75% of max daily loss blocks Trade 2 (soft block)
  const COOLDOWN_MINUTES = 30;   // mandatory break before Trade 2 unlocks (profit or sub-cutoff loss)
  const COOLDOWN_MS = COOLDOWN_MINUTES * 60 * 1000;
  const COOLDOWN_STORAGE_KEY = 'tradeCooldownDeadline'; // persisted so a refresh can't skip the wait

  // ---------- Collapsible reference tables ----------
  // The tier/instrument reference tables are static rules, not today's
  // action items — collapsed by default after a user's first visit so
  // returning users get a shorter page, while staying one click away since
  // they're genuinely useful to check while sizing a trade. State persists
  // across visits via localStorage, per section, keyed by id.
  const REFERENCE_COLLAPSE_STORAGE_PREFIX = 'refCollapsed:';

  function isReferenceSectionCollapsed(sectionId) {
    const stored = localStorage.getItem(REFERENCE_COLLAPSE_STORAGE_PREFIX + sectionId);
    // No stored value yet = genuine first-ever visit: show it expanded once,
    // then immediately record that it's been seen so every visit AFTER this
    // one defaults to collapsed (manual toggles afterward are respected via
    // the stored 'true'/'false' value going forward).
    if (stored === null) {
      setReferenceSectionCollapsed(sectionId, true);
      return false;
    }
    return stored === 'true';
  }

  function setReferenceSectionCollapsed(sectionId, collapsed) {
    localStorage.setItem(REFERENCE_COLLAPSE_STORAGE_PREFIX + sectionId, String(collapsed));
  }

  function applyReferenceSectionState(sectionId) {
    const body = document.getElementById(`${sectionId}-body`);
    const chevron = document.getElementById(`${sectionId}-chevron`);
    if (!body || !chevron) return;
    const collapsed = isReferenceSectionCollapsed(sectionId);
    body.classList.toggle('mini-ladder-collapsed', collapsed);
    chevron.classList.toggle('mini-ladder-chevron-collapsed', collapsed);
  }

  function toggleReferenceSection(sectionId) {
    const nowCollapsed = !isReferenceSectionCollapsed(sectionId);
    setReferenceSectionCollapsed(sectionId, nowCollapsed);
    applyReferenceSectionState(sectionId);
  }

  // ---------- State ----------
  let cooldownIntervalId = null; // setInterval handle for the live countdown, or null when not running
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

  // ---------- Cooldown engine ----------
  // Deadline is stored as an absolute epoch ms timestamp in localStorage, so
  // the countdown survives a page refresh instead of silently resetting.
  function getStoredCooldownDeadline() {
    const raw = localStorage.getItem(COOLDOWN_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return isNaN(parsed) ? null : parsed;
  }

  function setStoredCooldownDeadline(deadlineMs) {
    if (deadlineMs === null) {
      localStorage.removeItem(COOLDOWN_STORAGE_KEY);
    } else {
      localStorage.setItem(COOLDOWN_STORAGE_KEY, String(deadlineMs));
    }
  }

  function startCooldown() {
    const deadline = Date.now() + COOLDOWN_MS;
    setStoredCooldownDeadline(deadline);
    runCooldownLoop(deadline);
  }

  // Called on load in case a cooldown was already in progress before a
  // refresh — resumes counting down from the stored deadline rather than
  // restarting the full 30 minutes. Note: Trade 1's submitted state itself
  // is NOT persisted (this app keeps no other state across reloads either),
  // so a refresh during cooldown still shows a fresh, empty Trade #1 card —
  // but the cooldown banner reappears and Trade #2 stays locked until the
  // SAME stored deadline elapses, so the wait itself can't be dodged.
  function resumeCooldownIfActive() {
    const deadline = getStoredCooldownDeadline();
    if (!deadline) return;

    if (Date.now() >= deadline) {
      setStoredCooldownDeadline(null);
      return;
    }

    trade2Unlocked = false;
    const t2Container = document.getElementById('t2-container');
    if (t2Container) t2Container.classList.add('locked');
    runCooldownLoop(deadline);
  }

  function runCooldownLoop(deadlineMs) {
    const banner = document.getElementById('cooldown-banner');
    const timerEl = document.getElementById('cooldown-timer');
    const fillEl = document.getElementById('cooldown-progress-fill');
    if (banner) banner.classList.remove('hidden');

    if (cooldownIntervalId) clearInterval(cooldownIntervalId);

    function tick() {
      const remainingMs = deadlineMs - Date.now();

      if (remainingMs <= 0) {
        clearInterval(cooldownIntervalId);
        cooldownIntervalId = null;
        setStoredCooldownDeadline(null);
        onCooldownComplete();
        return;
      }

      const totalSeconds = Math.ceil(remainingMs / 1000);
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      if (timerEl) timerEl.innerText = `${mins}:${String(secs).padStart(2, '0')}`;
      if (fillEl) {
        const elapsedRatio = 1 - (remainingMs / COOLDOWN_MS);
        fillEl.style.width = `${Math.min(100, Math.max(0, elapsedRatio * 100))}%`;
      }
    }

    tick();
    cooldownIntervalId = setInterval(tick, 1000);
  }

  function onCooldownComplete() {
    const banner = document.getElementById('cooldown-banner');
    if (banner) banner.classList.add('hidden');

    trade2Unlocked = true;
    const t2Container = document.getElementById('t2-container');
    if (t2Container) t2Container.classList.remove('locked');
    document.getElementById('t2-instrument').disabled = false;
    document.getElementById('t2-profit').disabled = false;
    document.getElementById('t2-loss').disabled = false;

    const t2Status = document.getElementById('t2-submit-status');
    if (t2Status) t2Status.innerText = 'Cooldown complete. Pick an outcome for this final trade.';

    renderTradeState();
  }

  function clearCooldown() {
    if (cooldownIntervalId) {
      clearInterval(cooldownIntervalId);
      cooldownIntervalId = null;
    }
    setStoredCooldownDeadline(null);
    const banner = document.getElementById('cooldown-banner');
    if (banner) banner.classList.add('hidden');
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

  function resetTracker(keepCooldown) {
    if (!keepCooldown) clearCooldown();
    const decisionCard = document.getElementById('profit-decision-card');
    if (decisionCard) decisionCard.classList.add('hidden');
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
    if (t2Status) t2Status.innerText = 'Submit Trade 1 to see if Trade 2 becomes available.';

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
      setAlert(alertBox, alertTitle, alertMsg, "cooldown",
        "Trade #1 Closed In Profit",
        "Decide below: lock in the win and stop for today, or take the 30-minute cooldown and go for Trade #2.");
      trade2Unlocked = false;
      const decisionCard = document.getElementById('profit-decision-card');
      if (decisionCard) decisionCard.classList.remove('hidden');
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
        setAlert(alertBox, alertTitle, alertMsg, "cooldown",
          "Cooldown Started",
          `Trade #1 loss is below the 75% cutoff, so Trade #2 is still available — but only after a 30-minute cooldown. Step away, reset, then come back.`);
        trade2Unlocked = false;
        startCooldown();
      }
    }

    if (t2Container) t2Container.classList.toggle('locked', !trade2Unlocked);
    if (trade2Unlocked) {
      document.getElementById('t2-profit').disabled = false;
      document.getElementById('t2-loss').disabled = false;
      if (t2Status) t2Status.innerText = 'Pick an outcome for this final trade.';
    }

    const chosenDate = getSelectedLogDate();
    let t1RuleStatus;
    if (trade1Status === 'profit') {
      t1RuleStatus = { compliant: true, label: 'Profit \u2014 awaiting stop/continue decision', source: 'manual' };
    } else if (trade1Amount >= rule.loss) {
      t1RuleStatus = { compliant: true, label: 'Kill switch \u2014 100% of daily loss', source: 'manual' };
    } else if ((rule.loss > 0 ? trade1Amount / rule.loss : 0) >= SOFT_BLOCK_RATIO) {
      t1RuleStatus = { compliant: true, label: 'Soft block \u2014 75%+ of daily loss', source: 'manual' };
    } else {
      t1RuleStatus = { compliant: true, label: 'Sub-cutoff loss \u2014 cooldown started', source: 'manual' };
    }
    if (typeof window.recordCompletedDay === 'function') {
      trade1TradeId = window.recordCompletedDay(netResult, chosenDate, trade1Instrument, t1RuleStatus);
    }
    commitJournalDraft(1, trade1TradeId);
    if (typeof window.renderCalculatorHistory === 'function') {
      window.renderCalculatorHistory();
    }

    const t1JournalBtn = document.getElementById('t1-journal-btn');
    if (t1JournalBtn) t1JournalBtn.disabled = false;

    renderTradeState();
  }

  // ---------- Profit decision: stop for today, or push for Trade 2 ----------
  // Only reachable after a profitable Trade 1 (see submitTrade1). The
  // default-framed, recommended choice is to stop; pushing for Trade 2 still
  // requires the full 30-minute cooldown, same as it always has.
  function chooseStopForToday() {
    const decisionCard = document.getElementById('profit-decision-card');
    if (decisionCard) decisionCard.classList.add('hidden');

    trade2Unlocked = false;
    const t2Container = document.getElementById('t2-container');
    if (t2Container) t2Container.classList.add('locked');
    const t2Status = document.getElementById('t2-submit-status');
    if (t2Status) t2Status.innerText = 'You chose to stop for today after Trade #1\u2019s profit. Trade #2 stays locked for the rest of the day.';

    const alertBox = document.getElementById('calc-alert');
    const alertTitle = document.getElementById('alert-status');
    const alertMsg = document.getElementById('alert-message');
    setAlert(alertBox, alertTitle, alertMsg, "success",
      "Win Locked In \u2014 Day Over",
      "Smart call. You banked the win without giving the market a chance to take it back. Same time tomorrow.");

    if (trade1TradeId && typeof window.updateTradeRuleStatus === 'function') {
      window.updateTradeRuleStatus(trade1TradeId, {
        compliant: true,
        label: 'Profit \u2014 chose to stop for today',
        source: 'manual',
      });
    }
  }

  function choosePushForTrade2() {
    const decisionCard = document.getElementById('profit-decision-card');
    if (decisionCard) decisionCard.classList.add('hidden');

    const alertBox = document.getElementById('calc-alert');
    const alertTitle = document.getElementById('alert-status');
    const alertMsg = document.getElementById('alert-message');
    setAlert(alertBox, alertTitle, alertMsg, "cooldown",
      "Cooldown Started",
      "Going for Trade #2 \u2014 step away for 30 minutes first. This protects the win from a rushed re-entry.");

    trade2Unlocked = false;
    startCooldown();

    if (trade1TradeId && typeof window.updateTradeRuleStatus === 'function') {
      window.updateTradeRuleStatus(trade1TradeId, {
        compliant: true,
        label: 'Profit \u2014 chose Trade 2, cooldown started',
        source: 'manual',
      });
    }
  }

  // ---------- Submit Trade 2 ----------
  function submitTrade2() {
    if (!trade2Unlocked || trade2Submitted || trade2Status === null || !isLogDateValid()) return;
    if (trade2Status === 'loss' && trade2Amount <= 0) return;

    trade2Submitted = true;
    setStoredCooldownDeadline(null); // day is over either way; nothing left to count down to

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
    const t2RuleStatus = { compliant: true, label: 'Final trade \u2014 day over after this', source: 'manual' };
    if (typeof window.recordCompletedDay === 'function') {
      trade2TradeId = window.recordCompletedDay(netResult, chosenDate, trade2Instrument, t2RuleStatus);
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

  // Local copy of dashboard.js's todayDateString() — kept self-contained
  // rather than reaching into another component's closure. Used by the
  // broker-sync functions below to find "today's" trades in history.
  function todayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function renderCalculatorHistory() {
    const container = document.getElementById('calc-history-area');
    if (!container) return;

    const history = (typeof window.getTradeHistory === 'function') ? window.getTradeHistory() : [];

    if (!history || history.length === 0) {
      container.innerHTML = '<div class="roadmap-empty-state">No trades submitted yet. Submit Trade 1 above to see it here.</div>';
      return;
    }

    // Show the most recently DATED trades first — sort by date, and within
    // the same date preserve submission order (submittedAt) so same-day
    // sequencing (cooldown/overtrading evaluation order) still reads top to
    // bottom correctly. Sorting by raw insertion order alone breaks once a
    // user imports broker days out of chronological order (e.g. importing
    // 11 Jun after already having a 1 Jun entry) — insertion order and date
    // order can diverge.
    const rows = history
      .slice()
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1; // newest date first
        return (a.submittedAt || 0) < (b.submittedAt || 0) ? 1 : -1; // newest submission first within a date
      })
      .slice(0, 5);

    let html = '<div class="calc-history-grid calc-history-grid-4col">';
    html += `
      <div class="calc-history-cell calc-history-head">Date</div>
      <div class="calc-history-cell calc-history-head num">Net Result</div>
      <div class="calc-history-cell calc-history-head num">Balance After</div>
      <div class="calc-history-cell calc-history-head">Rule Status</div>
    `;

    rows.forEach(entry => {
      const isWin = entry.netResult > 0;
      const sign = isWin ? '+' : (entry.netResult < 0 ? '-' : '');
      const resultClass = isWin ? 'calc-history-win' : (entry.netResult < 0 ? 'calc-history-loss' : '');
      const status = entry.ruleStatus || { compliant: true, label: 'Within rules' };
      const statusHtml = status.compliant
        ? `<span class="rule-status-badge rule-status-ok">${status.label}</span>`
        : `<span class="rule-status-badge rule-status-violation" title="${(status.message || '').replace(/"/g, '&quot;')}">\u26a0 ${status.label}</span>`;
      html += `
        <div class="calc-history-cell">${formatDateShort(entry.date)}</div>
        <div class="calc-history-cell num ${resultClass}">${sign}Rs. ${fmt(Math.abs(entry.netResult))}</div>
        <div class="calc-history-cell num">Rs. ${fmt(entry.balanceAfter)}</div>
        <div class="calc-history-cell">${statusHtml}</div>
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

  // ---------- Broker P&L browser + day import (prototype mock) ----------
  // When connected, this panel replaces manual entry. It mirrors a real
  // broker's P&L report: stat cards for the selected range, a multi-month
  // dot grid (one column per month), and a day-detail + import flow that's
  // unchanged from before — only the browsing UI around it changed. NO rule
  // evaluation happens in the browser itself. Importing a day is a separate,
  // explicit action — each scrip row becomes its own trade slot and is
  // evaluated against the daily-loss / soft-block / cooldown rules IN ORDER,
  // same as the manual entry flow, so a day with 3+ broker trades will
  // correctly trip the overtrading flag, and a same day's second trade taken
  // inside the cooldown window will correctly trip the cooldown-broken flag.
  let brokerActiveRange = 'fy'; // 'month' | '3months' | 'fy'
  let brokerSelectedDate = null;  // 'YYYY-MM-DD' of the day currently shown in detail
  let brokerImportPendingDate = null; // date awaiting confirm/cancel

  function renderCalculatorBrokerMode() {
    const state = (typeof window.getProfileState === 'function') ? window.getProfileState() : {};
    const manualPanel = document.getElementById('manual-entry-panel');
    const brokerPanel = document.getElementById('broker-synced-panel');
    if (!manualPanel || !brokerPanel) return;

    // Keep the on-screen "Connect/Disconnect" widget in sync regardless of
    // which screen triggered the change (Settings or here).
    if (typeof window.renderBrokerArea === 'function') {
      window.renderBrokerArea();
    }

    if (state.brokerConnected) {
      manualPanel.classList.add('hidden');
      brokerPanel.classList.remove('hidden');
      const nameEl = document.getElementById('broker-synced-name');
      if (nameEl) nameEl.innerText = state.connectedBrokerName || 'your broker';
      renderBrokerRangeView();
    } else {
      manualPanel.classList.remove('hidden');
      brokerPanel.classList.add('hidden');
    }
  }

  function ymdLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Returns the start of the current Indian financial year (Apr 1) as of
  // `today` — matches the logic in dashboard.js used to generate mock data.
  function startOfFinancialYearLocal(today) {
    const aprFirstThisCalendarYear = new Date(today.getFullYear(), 3, 1);
    if (today >= aprFirstThisCalendarYear) return aprFirstThisCalendarYear;
    return new Date(today.getFullYear() - 1, 3, 1);
  }

  function resolveBrokerRange(range) {
    const today = new Date();
    let from;
    if (range === 'month') {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (range === '3months') {
      from = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    } else {
      from = startOfFinancialYearLocal(today);
    }
    return { from, to: today };
  }

  function setBrokerRange(range) {
    brokerActiveRange = range;
    renderBrokerRangeView();
  }

  function dailyTradeCountForDate(dateString) {
    const history = (typeof window.getTradeHistory === 'function') ? window.getTradeHistory() : [];
    return history.filter(t => t.date === dateString).length;
  }

  function renderBrokerRangeView() {
    ['month', '3months', 'fy'].forEach(r => {
      const pillId = r === '3months' ? 'broker-range-3months' : (r === 'fy' ? 'broker-range-fy' : 'broker-range-month');
      const pillEl = document.getElementById(pillId);
      if (pillEl) pillEl.classList.toggle('broker-range-pill-active', r === brokerActiveRange);
    });

    const { from, to } = resolveBrokerRange(brokerActiveRange);
    const fromStr = ymdLocal(from);
    const toStr = ymdLocal(to);

    const rangeLabelEl = document.getElementById('broker-range-label');
    if (rangeLabelEl) {
      const fmtLabel = (d) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      rangeLabelEl.innerText = `${fmtLabel(from)} - ${fmtLabel(to)}`;
    }

    // Stat cards for the selected range.
    const summary = (typeof window.getBrokerPnlSummary === 'function')
      ? window.getBrokerPnlSummary(fromStr, toStr)
      : { realizedPnl: 0, totalCharges: 0, netRealizedPnl: 0 };

    const fmtSigned = (n) => {
      const sign = n < 0 ? '-' : '';
      return `${sign}\u20b9${fmt(Math.abs(n))}`;
    };
    const realizedEl = document.getElementById('broker-stat-realized');
    const chargesEl = document.getElementById('broker-stat-charges');
    const netEl = document.getElementById('broker-stat-net');
    if (realizedEl) {
      realizedEl.innerText = fmtSigned(summary.realizedPnl);
      realizedEl.className = 'broker-stat-value ' + (summary.realizedPnl >= 0 ? 'calc-history-win' : 'calc-history-loss');
    }
    if (chargesEl) chargesEl.innerText = `\u20b9${fmt(summary.totalCharges)}`;
    if (netEl) {
      netEl.innerText = fmtSigned(summary.netRealizedPnl);
      netEl.className = 'broker-stat-value ' + (summary.netRealizedPnl >= 0 ? 'calc-history-win' : 'calc-history-loss');
    }

    renderBrokerMultiMonthGrid(from, to);
  }

  function renderBrokerMultiMonthGrid(from, to) {
    const gridEl = document.getElementById('broker-multi-month-grid');
    if (!gridEl) return;

    const pnlData = (typeof window.getBrokerPnlHistory === 'function') ? window.getBrokerPnlHistory() : {};

    // Build the list of months spanning [from, to], oldest first.
    const months = [];
    let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    const lastMonth = new Date(to.getFullYear(), to.getMonth(), 1);
    while (cursor <= lastMonth) {
      months.push(new Date(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    let html = '';
    months.forEach(monthDate => {
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const monthLabel = monthDate.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

      let monthTotal = 0;
      let hasAnyTrade = false;
      let dotsHtml = '';

      for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month, day);
        if (dateObj < from || dateObj > to) {
          dotsHtml += '<span class="broker-month-dot broker-month-dot-empty"></span>';
          continue;
        }
        const dateStr = ymdLocal(dateObj);
        const rows = pnlData[dateStr] || [];
        const netForDay = rows.reduce((sum, r) => sum + r.netPnl, 0);

        let dotClass = 'broker-month-dot-gray';
        if (rows.length > 0) {
          dotClass = netForDay >= 0 ? 'broker-month-dot-green' : 'broker-month-dot-red';
          monthTotal += netForDay;
          hasAnyTrade = true;
        }

        const selectedClass = dateStr === brokerSelectedDate ? 'broker-month-dot-selected' : '';
        dotsHtml += `<button type="button" class="broker-month-dot ${dotClass} ${selectedClass}" title="${dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}" onclick="showBrokerDayDetail('${dateStr}')"></button>`;
      }

      const totalClass = monthTotal >= 0 ? 'calc-history-win' : 'calc-history-loss';
      const totalText = hasAnyTrade ? `${monthTotal >= 0 ? '+' : '-'}\u20b9${fmt(Math.abs(monthTotal))}` : '\u2014';

      html += `
        <div class="broker-month-column">
          <div class="broker-month-column-label">${monthLabel}</div>
          <div class="broker-month-dots">${dotsHtml}</div>
          <div class="broker-month-column-total ${hasAnyTrade ? totalClass : ''}">${totalText}</div>
        </div>
      `;
    });

    gridEl.innerHTML = html;
  }

  function showBrokerDayDetail(dateString) {
    brokerSelectedDate = dateString;
    brokerImportPendingDate = null;
    renderBrokerRangeView(); // re-render to highlight the selected dot

    const detailWrap = document.getElementById('broker-day-detail');
    const titleEl = document.getElementById('broker-day-detail-title');
    const tableEl = document.getElementById('broker-day-scrip-table');
    const confirmWrap = document.getElementById('broker-import-confirm');
    if (confirmWrap) confirmWrap.classList.add('hidden');
    if (!detailWrap || !titleEl || !tableEl) return;

    detailWrap.classList.remove('hidden');
    const niceDate = new Date(dateString + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    titleEl.innerText = niceDate;

    const rows = (typeof window.getBrokerPnlHistory === 'function') ? window.getBrokerPnlHistory(dateString) : [];
    const importBtn = document.getElementById('broker-import-btn');

    if (rows.length === 0) {
      tableEl.innerHTML = '<div class="roadmap-empty-state">No trades reported by your broker on this day.</div>';
      if (importBtn) importBtn.disabled = true;
      return;
    }

    if (importBtn) importBtn.disabled = false;

    const alreadyLogged = dailyTradeCountForDate(dateString) > 0;

    let html = '<div class="broker-scrip-grid"><div class="broker-scrip-grid-head">Scrip</div><div class="broker-scrip-grid-head num">Qty</div><div class="broker-scrip-grid-head num">Buy</div><div class="broker-scrip-grid-head num">Sell</div><div class="broker-scrip-grid-head num">Charges</div><div class="broker-scrip-grid-head num">Net P&amp;L</div></div>';
    let dayTotal = 0;
    rows.forEach(r => {
      dayTotal += r.netPnl;
      const isWin = r.netPnl >= 0;
      const cls = isWin ? 'calc-history-win' : 'calc-history-loss';
      const sign = isWin ? '+' : '-';
      html += `<div class="broker-scrip-grid">
        <div>${r.scrip}</div>
        <div class="num">${fmt(r.qty)}</div>
        <div class="num">\u20b9${r.buyPrice.toFixed(2)}</div>
        <div class="num">\u20b9${r.sellPrice.toFixed(2)}</div>
        <div class="num">\u20b9${r.charges.toFixed(2)}</div>
        <div class="num ${cls}">${sign}\u20b9${fmt(Math.abs(r.netPnl))}</div>
      </div>`;
    });
    tableEl.innerHTML = html;

    const totalIsWin = dayTotal >= 0;
    tableEl.insertAdjacentHTML('beforeend', `
      <div class="broker-day-total ${totalIsWin ? 'calc-history-win' : 'calc-history-loss'}">
        Net for the day: ${totalIsWin ? '+' : '-'}\u20b9${fmt(Math.abs(dayTotal))} across ${rows.length} trade${rows.length === 1 ? '' : 's'}
      </div>
    `);

    if (alreadyLogged) {
      tableEl.insertAdjacentHTML('beforeend', '<p class="foot-note" style="margin-top:8px;">Heads up: this date already has trades in your Trade Log. Importing will add these as additional entries alongside them.</p>');
    }
  }

  function requestImportBrokerDay() {
    if (!brokerSelectedDate) return;
    const rows = (typeof window.getBrokerPnlHistory === 'function') ? window.getBrokerPnlHistory(brokerSelectedDate) : [];
    if (rows.length === 0) return;

    brokerImportPendingDate = brokerSelectedDate;
    const confirmWrap = document.getElementById('broker-import-confirm');
    const confirmText = document.getElementById('broker-import-confirm-text');
    if (!confirmWrap || !confirmText) return;

    const niceDate = new Date(brokerSelectedDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    let warning = '';
    if (rows.length > 2) {
      warning = ` This is more than your 2-trade daily limit, so trade${rows.length - 2 === 1 ? '' : 's'} #3${rows.length > 3 ? ' onward' : ''} will be logged as an overtrading rule violation \u2014 that's intentional, it reflects what actually happened.`;
    }
    confirmText.innerText = `Import ${rows.length} trade${rows.length === 1 ? '' : 's'} from ${niceDate} into your Trade Log? Each one will be checked against your daily-loss, soft-block, and cooldown rules in order.${warning}`;
    confirmWrap.classList.remove('hidden');
  }

  function cancelImportBrokerDay() {
    brokerImportPendingDate = null;
    const confirmWrap = document.getElementById('broker-import-confirm');
    if (confirmWrap) confirmWrap.classList.add('hidden');
  }

  // Evaluates a trade about to be imported AGAINST the rules as they stood
  // at that moment — this is what makes the log meaningful: it doesn't ask
  // "did our UI allow this," it asks "should this trade have happened."
  // tradesAlreadyThatDay/cooldownActive are passed in (rather than read from
  // live storage) because we're evaluating a SEQUENCE of rows for a single
  // day, replaying them in order as if they happened one after another.
  function evaluateBrokerTradeCompliance(netResult, tradesAlreadyThatDay, cooldownActive) {
    const tierKey = document.getElementById('calc-tier') ? document.getElementById('calc-tier').value : 'small-1';
    const rule = tierRulesMatrix[tierKey] || tierRulesMatrix['small-1'];
    const isProfit = netResult > 0;
    const lossRatio = (!isProfit && rule.loss > 0) ? Math.abs(netResult) / rule.loss : 0;

    if (tradesAlreadyThatDay >= 2) {
      return {
        compliant: false,
        label: 'Overtrading \u2014 3rd+ trade that day',
        message: 'You\u2019d already hit your 2-trade limit for the day. Taking another trade anyway is overtrading, and it\u2019s exactly the pattern that erodes accounts over the long run. The edge isn\u2019t in this extra trade \u2014 it\u2019s in not taking it.',
        source: 'broker',
      };
    }

    if (cooldownActive) {
      return {
        compliant: false,
        label: 'Cooldown broken \u2014 traded too soon',
        message: 'This trade was taken before the 30-minute reset from the previous one finished. Re-entering this fast, win or lose, is usually emotion driving the trade, not a setup. Traders who survive long-term are the ones who can sit on their hands \u2014 protect that habit.',
        source: 'broker',
      };
    }

    if (!isProfit && lossRatio >= 1) {
      return { compliant: true, label: 'Kill switch \u2014 100% of daily loss', message: null, source: 'broker' };
    }
    if (!isProfit && lossRatio >= SOFT_BLOCK_RATIO) {
      return { compliant: true, label: 'Soft block \u2014 75%+ of daily loss', message: null, source: 'broker' };
    }
    return {
      compliant: true,
      label: isProfit ? 'Profit \u2014 within rules' : 'Sub-cutoff loss \u2014 within rules',
      message: null,
      source: 'broker',
    };
  }

  function confirmImportBrokerDay() {
    if (!brokerImportPendingDate) return;
    if (typeof window.getBrokerPnlHistory !== 'function' || typeof window.recordBrokerSyncedTrade !== 'function') return;

    const dateString = brokerImportPendingDate;
    const rows = window.getBrokerPnlHistory(dateString);
    const tierKey = document.getElementById('calc-tier') ? document.getElementById('calc-tier').value : 'small-1';
    const rule = tierRulesMatrix[tierKey] || tierRulesMatrix['small-1'];

    let tradesSoFar = dailyTradeCountForDate(dateString);
    let cooldownActive = false; // simulated, replaying the day's rows in order
    let dayEnded = false; // true once a row hits the kill switch or 2-trade cap

    const violations = [];

    rows.forEach(row => {
      if (dayEnded) {
        // Trades after the day "should" have ended still get imported (the
        // broker reported them, they really happened) but are flagged.
      }

      const compliance = evaluateBrokerTradeCompliance(row.netPnl, tradesSoFar, cooldownActive);
      window.recordBrokerSyncedTrade(row.netPnl, row.instrumentLabel, compliance, dateString);
      if (!compliance.compliant) violations.push(compliance);

      tradesSoFar += 1;
      const isProfit = row.netPnl > 0;
      const lossRatio = (!isProfit && rule.loss > 0) ? Math.abs(row.netPnl) / rule.loss : 0;

      if (tradesSoFar >= 2 || (!isProfit && lossRatio >= SOFT_BLOCK_RATIO)) {
        dayEnded = true;
        cooldownActive = false;
      } else {
        cooldownActive = true; // next row in sequence would need the 30-min gap
      }
    });

    brokerImportPendingDate = null;
    const confirmWrap = document.getElementById('broker-import-confirm');
    if (confirmWrap) confirmWrap.classList.add('hidden');

    const statusEl = document.getElementById('broker-sync-status');
    if (statusEl) {
      if (violations.length > 0) {
        statusEl.innerHTML = `<span class="rule-violation-inline">\u26a0 Imported with ${violations.length} rule violation${violations.length === 1 ? '' : 's'} flagged.</span> Check the Trade Log below for details.`;
      } else {
        statusEl.innerText = `Imported ${rows.length} trade${rows.length === 1 ? '' : 's'} \u2014 all within your rules.`;
      }
    }

    renderCalculatorHistory();
    showBrokerDayDetail(dateString); // refresh the "already logged" note
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
  window.chooseStopForToday = chooseStopForToday;
  window.choosePushForTrade2 = choosePushForTrade2;
  window.renderCalculatorHistory = renderCalculatorHistory;
  window.onTradeInstrumentChange = onTradeInstrumentChange;
  window.openQuickJournalModal = openQuickJournalModal;
  window.closeQuickJournalModal = closeQuickJournalModal;
  window.onQuickJournalOverlayClick = onQuickJournalOverlayClick;
  window.saveQuickJournalNote = saveQuickJournalNote;
  window.renderCalculatorBrokerMode = renderCalculatorBrokerMode;
  window.setBrokerRange = setBrokerRange;
  window.showBrokerDayDetail = showBrokerDayDetail;
  window.requestImportBrokerDay = requestImportBrokerDay;
  window.cancelImportBrokerDay = cancelImportBrokerDay;
  window.confirmImportBrokerDay = confirmImportBrokerDay;
  window.toggleReferenceSection = toggleReferenceSection;
  window.applyReferenceSectionState = applyReferenceSectionState;

  // Run once on load so the panel reflects "no trades yet" immediately.
  // resumeCooldownIfActive must run BEFORE resetTracker, since resetTracker
  // would otherwise clear a still-active stored deadline; passing `true`
  // tells resetTracker to leave the (just-resumed) cooldown alone.
  resumeCooldownIfActive();
  resetTracker(true);
  updateYourLimitCallout();
  initLogDate();
  renderCalculatorHistory();
  renderCalculatorBrokerMode();
  applyReferenceSectionState('tier-ref');
  // NOTE: applyReferenceSectionState('instrument-ref') is intentionally NOT
  // called here. renderInstrumentSlTable() (dashboard.js) already calls it
  // itself at the exact moment the section becomes visible — calling it here
  // too would mark the section "seen" before it's ever shown, since profile
  // setup (and therefore renderInstrumentSlTable) typically runs before this
  // component even loads.

})();
/* === END COMPONENT: risk-calculator (logic) === */