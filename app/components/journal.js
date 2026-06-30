/* ===========================================================
   COMPONENT: trading-journal (logic)
   Loaded lazily by dashboard.js the first time this tab opens.

   Lists every submitted trade (from window.getTradeHistory) and lets the
   user attach a structured journal entry to each one: Trade Details,
   Execution & Management, Logic, Psychology & Reflection, plus a weighted
   checklist that computes a letter grade for that trade's discipline.
   Entries persist via window.saveJournalEntry / getJournalEntry, both
   exposed by dashboard.js.
   =========================================================== */

(function () {

  // ---------- Weighted review checklist (mirrors the reference "trade review" card) ----------
  const CHECKLIST = {
    "Setup": [
      { key: "clear_strategy", label: "Clearly defined strategy", weight: 3 },
      { key: "sr_levels", label: "Support / Resistance levels set and considered", weight: 3 },
      { key: "catalyst", label: "Catalyst understood", weight: 1 },
      { key: "entry_defined", label: "Entry defined", weight: 3 },
      { key: "target_defined", label: "Target defined", weight: 2 },
      { key: "price_action_monitored", label: "Price action monitored beforehand", weight: 2 },
      { key: "level2_considered", label: "Order book / level 2 considered and supports the trade", weight: 1 },
      { key: "sector_context", label: "Broader market/sector price action taken into consideration", weight: 1 },
    ],
    "Entry": [
      { key: "timing", label: "Timing", weight: 3 },
      { key: "sizing", label: "Sizing", weight: 3 },
      { key: "sl_placement", label: "Stop loss set at a logical level (pivot / VWAP / S&R)", weight: 2 },
    ],
    "Management": [
      { key: "monitored_trade", label: "Monitored the trade (no switching away)", weight: 3 },
      { key: "exit_discipline", label: "Exited when setup stopped working (didn't just wait for SL)", weight: 3 },
      { key: "target_exit", label: "Took partials/full exit at target appropriately", weight: 2 },
      { key: "no_errors", label: "No execution errors (wrong qty, wrong order type, etc.)", weight: 3 },
    ],
    "Journaling": [
      { key: "chart_captured", label: "Captured relevant chart/setup information", weight: 2 },
      { key: "setup_explainable", label: "Setup can be fully explained to someone else", weight: 1 },
      { key: "thought_process_written", label: "Wrote up the thought process", weight: 1 },
    ],
  };

  const GRADE_BANDS = [
    { min: 37, grade: "A+" }, { min: 34, grade: "A" }, { min: 32, grade: "A-" },
    { min: 29, grade: "B+" }, { min: 27, grade: "B" }, { min: 25, grade: "B-" },
    { min: 22, grade: "C+" }, { min: 19, grade: "C" }, { min: 16, grade: "C-" },
    { min: 14, grade: "D+" }, { min: 11, grade: "D" }, { min: 9,  grade: "D-" },
    { min: 7,  grade: "E+" }, { min: 6,  grade: "E-" },
    { min: 4,  grade: "F+" }, { min: 2,  grade: "F"  }, { min: 0,  grade: "F-" },
  ];

  const TOTAL_OBTAINABLE = Object.values(CHECKLIST)
    .flat()
    .reduce((sum, item) => sum + item.weight, 0);

  let activeTradeId = null; // which trade's journal entry is currently open in the form
  let screenshotDataUrl = null; // base64 data URL of the currently attached setup screenshot, or null

  function fmt(n) {
    return Math.round(n).toLocaleString('en-IN');
  }

  function formatDate(isoDateString) {
    const d = new Date(isoDateString);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function getHistory() {
    return (typeof window.getTradeHistory === 'function') ? window.getTradeHistory() : [];
  }

  function gradeForScore(score) {
    for (const band of GRADE_BANDS) {
      if (score >= band.min) return band.grade;
    }
    return "F-";
  }

  // ---------- Rule adherence analysis (week/month) ----------
  // Reuses the ruleStatus already stamped onto every trade record (see
  // dashboard.js recordCompletedDay / calculator.js evaluateBrokerTradeCompliance)
  // — no new tracking needed, just aggregating what's already there for a
  // chosen period. Only two ruleStatus labels are ever non-compliant today:
  // "Overtrading — 3rd+ trade that day" and "Cooldown broken — traded too
  // soon" — everything else (kill switch, soft block, profit, etc.) is a
  // compliant OUTCOME even though it describes why the day ended.
  let journalAnalysisRange = 'week'; // 'week' | 'month'

  function ymdLocalJournal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function startOfWeekLocal(d) {
    const date = new Date(d);
    const day = date.getDay(); // 0 = Sunday
    date.setDate(date.getDate() - day);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function resolveJournalAnalysisRange(range) {
    const today = new Date();
    let from;
    if (range === 'week') {
      from = startOfWeekLocal(today);
    } else {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    return { from, to: today };
  }

  function setJournalAnalysisRange(range) {
    journalAnalysisRange = range;
    renderJournalAnalysis();
  }

  function renderJournalAnalysis() {
    const bodyEl = document.getElementById('journal-analysis-body');
    const labelEl = document.getElementById('journal-analysis-range-label');
    if (!bodyEl || !labelEl) return;

    document.getElementById('journal-analysis-week-btn').classList.toggle('broker-range-pill-active', journalAnalysisRange === 'week');
    document.getElementById('journal-analysis-month-btn').classList.toggle('broker-range-pill-active', journalAnalysisRange === 'month');

    const { from, to } = resolveJournalAnalysisRange(journalAnalysisRange);
    const fromStr = ymdLocalJournal(from);
    const toStr = ymdLocalJournal(to);
    const fmtLabel = (d) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    labelEl.innerText = `${fmtLabel(from)} - ${fmtLabel(to)}`;

    const history = getHistory().filter(t => t.date >= fromStr && t.date <= toStr);
    const entries = (typeof window.getAllJournalEntries === 'function') ? window.getAllJournalEntries() : {};

    if (history.length === 0) {
      bodyEl.innerHTML = `<div class="roadmap-empty-state">No trades logged ${journalAnalysisRange === 'week' ? 'this week' : 'this month'} yet.</div>`;
      return;
    }

    const compliant = history.filter(t => !t.ruleStatus || t.ruleStatus.compliant);
    const violations = history.filter(t => t.ruleStatus && !t.ruleStatus.compliant);
    const adherencePct = Math.round((compliant.length / history.length) * 100);

    const journaledTrades = history.filter(t => entries[t.id]);
    const journaledPct = Math.round((journaledTrades.length / history.length) * 100);
    const gradedTrades = journaledTrades.filter(t => typeof entries[t.id].score === 'number');
    let avgScorePct = null;
    if (gradedTrades.length > 0) {
      const totalPct = gradedTrades.reduce((sum, t) => sum + (entries[t.id].score / TOTAL_OBTAINABLE) * 100, 0);
      avgScorePct = Math.round(totalPct / gradedTrades.length);
    }

    // Group violations by their specific rule label, so the trader sees
    // WHICH habit is slipping, not just a single number.
    const violationCounts = {};
    violations.forEach(t => {
      const label = t.ruleStatus.label;
      violationCounts[label] = (violationCounts[label] || 0) + 1;
    });
    const violationBreakdownHtml = Object.keys(violationCounts).length > 0
      ? Object.entries(violationCounts).map(([label, count]) => `
          <div class="journal-violation-row">
            <span class="rule-status-badge rule-status-violation">\u26a0 ${label}</span>
            <span class="journal-violation-count">${count} time${count === 1 ? '' : 's'}</span>
          </div>
        `).join('')
      : '<div class="journal-violation-row journal-violation-none">No rule violations this period \u2014 every trade followed the daily-loss, soft-block, and cooldown rules.</div>';

    bodyEl.innerHTML = `
      <div class="journal-analysis-stats">
        <div class="journal-analysis-stat-card">
          <div class="journal-analysis-stat-value ${adherencePct === 100 ? 'calc-history-win' : (violations.length > 0 ? 'calc-history-loss' : '')}">${compliant.length} / ${history.length}</div>
          <div class="journal-analysis-stat-label">Trades within rules (${adherencePct}%)</div>
        </div>
        <div class="journal-analysis-stat-card">
          <div class="journal-analysis-stat-value">${journaledTrades.length} / ${history.length}</div>
          <div class="journal-analysis-stat-label">Trades journaled (${journaledPct}%)</div>
        </div>
        <div class="journal-analysis-stat-card">
          <div class="journal-analysis-stat-value">${avgScorePct !== null ? avgScorePct + '%' : '\u2014'}</div>
          <div class="journal-analysis-stat-label">Avg. review score</div>
        </div>
      </div>
      <div class="journal-violation-breakdown">
        <div class="journal-violation-breakdown-title">Rule violations this period</div>
        ${violationBreakdownHtml}
      </div>
    `;
  }

  let activeInstrumentFilter = ''; // '' = all instruments
  let activeGradeFilter = '';      // '' = all, 'journaled' = any graded entry, 'not-journaled' = no entry
  let activeDateFrom = '';         // '' = no lower bound, else 'YYYY-MM-DD'
  let activeDateTo = '';           // '' = no upper bound, else 'YYYY-MM-DD'

  // ---------- Summary stats bar ----------
  function renderStatsBar(history) {
    const bar = document.getElementById('journal-stats-bar');
    if (!bar) return;

    if (!history || history.length === 0) {
      bar.innerHTML = '';
      return;
    }

    const entries = (typeof window.getAllJournalEntries === 'function') ? window.getAllJournalEntries() : {};
    const journaledTrades = history.filter(t => entries[t.id]);
    const journaledPct = Math.round((journaledTrades.length / history.length) * 100);

    let avgScorePct = null;
    const gradedTrades = journaledTrades.filter(t => typeof entries[t.id].score === 'number');
    if (gradedTrades.length > 0) {
      const totalPct = gradedTrades.reduce((sum, t) => {
        return sum + (entries[t.id].score / TOTAL_OBTAINABLE) * 100;
      }, 0);
      avgScorePct = Math.round(totalPct / gradedTrades.length);
    }
    const avgGrade = (avgScorePct !== null) ? gradeForScore(Math.round((avgScorePct / 100) * TOTAL_OBTAINABLE)) : '&mdash;';

    bar.innerHTML = `
      <div class="journal-stat-card">
        <div class="journal-stat-value">${journaledTrades.length} / ${history.length}</div>
        <div class="journal-stat-label">Trades Journaled (${journaledPct}%)</div>
      </div>
      <div class="journal-stat-card">
        <div class="journal-stat-value">${avgScorePct !== null ? avgScorePct + '%' : '&mdash;'}</div>
        <div class="journal-stat-label">Avg. Review Score</div>
      </div>
      <div class="journal-stat-card">
        <div class="journal-stat-value">${avgGrade}</div>
        <div class="journal-stat-label">Avg. Grade</div>
      </div>
    `;
  }

  // ---------- List of journalable trades ----------
  function populateInstrumentFilter(history) {
    const select = document.getElementById('journal-instrument-filter');
    if (!select) return;

    const instruments = Array.from(new Set(history.map(t => t.instrument).filter(Boolean))).sort();
    const currentValue = select.value;

    select.innerHTML = '<option value="">All instruments</option>' +
      instruments.map(name => `<option value="${name}">${name}</option>`).join('');

    // Preserve the user's filter choice across re-renders if it's still valid.
    if (instruments.includes(currentValue)) {
      select.value = currentValue;
    } else {
      select.value = '';
      activeInstrumentFilter = '';
    }
  }

  function onJournalInstrumentFilterChange() {
    const select = document.getElementById('journal-instrument-filter');
    activeInstrumentFilter = select ? select.value : '';
    renderList();
  }

  function onJournalGradeFilterChange() {
    const select = document.getElementById('journal-grade-filter');
    activeGradeFilter = select ? select.value : '';
    renderList();
  }

  function onJournalDateFilterChange() {
    const fromEl = document.getElementById('journal-date-from');
    const toEl = document.getElementById('journal-date-to');
    activeDateFrom = fromEl ? fromEl.value : '';
    activeDateTo = toEl ? toEl.value : '';
    renderList();
  }

  function clearJournalFilters() {
    activeInstrumentFilter = '';
    activeGradeFilter = '';
    activeDateFrom = '';
    activeDateTo = '';

    const instrEl = document.getElementById('journal-instrument-filter');
    const gradeEl = document.getElementById('journal-grade-filter');
    const fromEl = document.getElementById('journal-date-from');
    const toEl = document.getElementById('journal-date-to');
    if (instrEl) instrEl.value = '';
    if (gradeEl) gradeEl.value = '';
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';

    renderList();
  }

  function renderList() {
    const container = document.getElementById('journal-list-area');
    if (!container) return;

    const history = getHistory();
    populateInstrumentFilter(history);
    renderStatsBar(history);

    if (!history || history.length === 0) {
      container.innerHTML = '<div class="roadmap-empty-state">No trades submitted yet. Log a trade on the Daily Limits Tool, then come back here to journal it.</div>';
      return;
    }

    // Sort by date (newest first), preserving submission order within a
    // date — same fix as the Daily Limits Tool's Trade Log, since insertion
    // order can diverge from date order once broker days are imported out
    // of chronological sequence.
    let rows = history.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.submittedAt || 0) < (b.submittedAt || 0) ? 1 : -1;
    });

    if (activeInstrumentFilter) {
      rows = rows.filter(t => t.instrument === activeInstrumentFilter);
    }
    if (activeGradeFilter === 'journaled') {
      rows = rows.filter(t => !!((typeof window.getJournalEntry === 'function') && window.getJournalEntry(t.id)));
    } else if (activeGradeFilter === 'not-journaled') {
      rows = rows.filter(t => !((typeof window.getJournalEntry === 'function') && window.getJournalEntry(t.id)));
    }
    if (activeDateFrom) {
      rows = rows.filter(t => t.date >= activeDateFrom);
    }
    if (activeDateTo) {
      rows = rows.filter(t => t.date <= activeDateTo);
    }

    if (rows.length === 0) {
      container.innerHTML = '<div class="roadmap-empty-state">No trades match the current filters.</div>';
      return;
    }

    let html = '<div class="journal-list-grid journal-list-grid-5col">';
    html += `
      <div class="journal-list-cell journal-list-head">Date</div>
      <div class="journal-list-cell journal-list-head">Instrument</div>
      <div class="journal-list-cell journal-list-head num">Result</div>
      <div class="journal-list-cell journal-list-head">Journal Status</div>
      <div class="journal-list-cell journal-list-head"></div>
    `;

    rows.forEach(trade => {
      const entry = (typeof window.getJournalEntry === 'function') ? window.getJournalEntry(trade.id) : null;
      const isWin = trade.netResult > 0;
      const sign = isWin ? '+' : (trade.netResult < 0 ? '-' : '');
      const resultClass = isWin ? 'calc-history-win' : (trade.netResult < 0 ? 'calc-history-loss' : '');

      const statusHtml = entry
        ? `<span class="journal-status-badge journal-status-done">Journaled${entry.grade ? ' &middot; ' + entry.grade : ''}</span>${entry.screenshot ? '<span class="journal-list-thumb" title="Has a screenshot">📷</span>' : ''}`
        : `<span class="journal-status-badge journal-status-pending">Not journaled</span>`;

      html += `
        <div class="journal-list-cell">${formatDate(trade.date)}</div>
        <div class="journal-list-cell">${trade.instrument || '&mdash;'}</div>
        <div class="journal-list-cell num ${resultClass}">${sign}₹${fmt(Math.abs(trade.netResult))}</div>
        <div class="journal-list-cell">${statusHtml}</div>
        <div class="journal-list-cell">
          <button type="button" class="journal-list-btn" onclick="openJournalForm('${trade.id}')">${entry ? 'Edit' : 'Write Entry'}</button>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;
  }

  // ---------- Checklist rendering ----------
  function renderChecklist(savedChecklist) {
    const container = document.getElementById('journal-checklist-area');
    if (!container) return;

    const checked = savedChecklist || {};
    let html = '';

    Object.keys(CHECKLIST).forEach(category => {
      html += `<div class="journal-checklist-category">${category}</div>`;
      CHECKLIST[category].forEach(item => {
        const isChecked = !!checked[item.key];
        html += `
          <label class="journal-checklist-item">
            <input type="checkbox" data-checklist-key="${item.key}" data-weight="${item.weight}"
                   ${isChecked ? 'checked' : ''} onchange="onChecklistToggle()">
            <span>${item.label}</span>
            <span class="journal-checklist-weight">+${item.weight}</span>
          </label>
        `;
      });
    });

    container.innerHTML = html;
    updateGradeDisplay();
  }

  function onChecklistToggle() {
    updateGradeDisplay();
  }

  function computeScore() {
    const inputs = document.querySelectorAll('#journal-checklist-area input[type="checkbox"]');
    let score = 0;
    inputs.forEach(input => {
      if (input.checked) score += parseInt(input.dataset.weight, 10);
    });
    return score;
  }

  function updateGradeDisplay() {
    const resultEl = document.getElementById('journal-grade-result');
    if (!resultEl) return;
    const score = computeScore();
    const grade = gradeForScore(score);
    resultEl.innerHTML = `
      <span class="journal-grade-score">${score} / ${TOTAL_OBTAINABLE} points</span>
      <span class="journal-grade-letter">${grade}</span>
    `;
  }

  // ---------- Open / close the entry form ----------
  function openJournalForm(tradeId) {
    activeTradeId = tradeId;
    const history = getHistory();
    const trade = history.find(t => t.id === tradeId);
    if (!trade) return;

    const formWrap = document.getElementById('journal-form-wrap');
    const metaEl = document.getElementById('journal-form-trade-meta');
    if (metaEl) {
      const isWin = trade.netResult > 0;
      const sign = isWin ? '+' : (trade.netResult < 0 ? '-' : '');
      metaEl.innerText = `${formatDate(trade.date)} \u00b7 ${sign}₹${fmt(Math.abs(trade.netResult))} \u00b7 Balance after: ₹${fmt(trade.balanceAfter)}`;
    }

    const existing = (typeof window.getJournalEntry === 'function') ? window.getJournalEntry(tradeId) : null;

    document.getElementById('jf-instrument').value = existing ? (existing.instrument || '') : '';
    document.getElementById('jf-direction').value = existing ? (existing.direction || '') : '';
    document.getElementById('jf-entry-price').value = existing ? (existing.entryPrice || '') : '';
    document.getElementById('jf-exit-price').value = existing ? (existing.exitPrice || '') : '';
    document.getElementById('jf-stop-loss').value = existing ? (existing.stopLoss || '') : '';
    document.getElementById('jf-target').value = existing ? (existing.target || '') : '';
    document.getElementById('jf-rr-ratio').value = existing ? (existing.rrRatio || '') : '';
    document.getElementById('jf-setup-reason').value = existing ? (existing.setupReason || '') : '';
    document.getElementById('jf-market-conditions').value = existing ? (existing.marketConditions || '') : '';
    document.getElementById('jf-emotion').value = existing ? (existing.emotion || '') : '';
    document.getElementById('jf-mistakes').value = existing ? (existing.mistakes || '') : '';

    renderChecklist(existing ? existing.checklist : {});
    setScreenshot(existing ? (existing.screenshot || null) : null);

    const deleteBtn = document.getElementById('journal-delete-btn');
    if (deleteBtn) deleteBtn.classList.toggle('hidden', !existing);

    const statusEl = document.getElementById('journal-save-status');
    if (statusEl) statusEl.innerText = existing ? 'Editing a saved entry — changes overwrite it on save.' : '';

    if (formWrap) {
      formWrap.classList.remove('hidden');
      formWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function closeJournalForm() {
    activeTradeId = null;
    const formWrap = document.getElementById('journal-form-wrap');
    if (formWrap) formWrap.classList.add('hidden');
  }

  // ---------- Setup screenshot: upload + paste ----------
  function triggerScreenshotPicker() {
    const input = document.getElementById('jf-screenshot-input');
    if (input) input.click();
  }

  function onScreenshotFileSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (file) {
      loadImageFile(file);
    }
    event.target.value = ''; // allow re-selecting the same file later
  }

  function onScreenshotPaste(event) {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          loadImageFile(file);
          event.preventDefault();
        }
        return;
      }
    }

    const errorEl = document.getElementById('jf-screenshot-error');
    if (errorEl) {
      errorEl.classList.remove('hidden');
      errorEl.innerText = 'No image found on the clipboard. Copy a screenshot first, then paste here.';
    }
  }

  function loadImageFile(file) {
    const errorEl = document.getElementById('jf-screenshot-error');
    if (errorEl) {
      errorEl.classList.add('hidden');
      errorEl.innerText = '';
    }

    if (!file.type.startsWith('image/')) {
      if (errorEl) {
        errorEl.classList.remove('hidden');
        errorEl.innerText = 'Please select an image file.';
      }
      return;
    }

    // Keep entries reasonably sized since everything lives in memory for
    // this session — warn rather than silently failing on huge files.
    const MAX_BYTES = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_BYTES) {
      if (errorEl) {
        errorEl.classList.remove('hidden');
        errorEl.innerText = 'Image is too large (max 5MB). Try a smaller screenshot or crop it first.';
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setScreenshot(reader.result);
    reader.onerror = () => {
      if (errorEl) {
        errorEl.classList.remove('hidden');
        errorEl.innerText = 'Could not read that image. Try a different file.';
      }
    };
    reader.readAsDataURL(file);
  }

  function setScreenshot(dataUrl) {
    screenshotDataUrl = dataUrl || null;

    const emptyEl = document.getElementById('jf-screenshot-empty');
    const previewWrap = document.getElementById('jf-screenshot-preview-wrap');
    const previewImg = document.getElementById('jf-screenshot-preview');

    if (screenshotDataUrl) {
      if (previewImg) previewImg.src = screenshotDataUrl;
      if (emptyEl) emptyEl.classList.add('hidden');
      if (previewWrap) previewWrap.classList.remove('hidden');
    } else {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (previewWrap) previewWrap.classList.add('hidden');
    }
  }

  function removeScreenshot(event) {
    if (event) event.stopPropagation(); // don't let the click bubble to the dropzone and reopen the picker
    setScreenshot(null);
  }

  function saveCurrentJournalEntry() {
    if (!activeTradeId) return;

    const checklistState = {};
    document.querySelectorAll('#journal-checklist-area input[type="checkbox"]').forEach(input => {
      checklistState[input.dataset.checklistKey] = input.checked;
    });

    const score = computeScore();
    const grade = gradeForScore(score);

    const entryData = {
      instrument: document.getElementById('jf-instrument').value.trim(),
      direction: document.getElementById('jf-direction').value,
      entryPrice: document.getElementById('jf-entry-price').value,
      exitPrice: document.getElementById('jf-exit-price').value,
      stopLoss: document.getElementById('jf-stop-loss').value,
      target: document.getElementById('jf-target').value,
      rrRatio: document.getElementById('jf-rr-ratio').value.trim(),
      setupReason: document.getElementById('jf-setup-reason').value.trim(),
      marketConditions: document.getElementById('jf-market-conditions').value.trim(),
      emotion: document.getElementById('jf-emotion').value.trim(),
      mistakes: document.getElementById('jf-mistakes').value.trim(),
      checklist: checklistState,
      score: score,
      grade: grade,
      screenshot: screenshotDataUrl,
    };

    if (typeof window.saveJournalEntry === 'function') {
      window.saveJournalEntry(activeTradeId, entryData);
    }

    const statusEl = document.getElementById('journal-save-status');
    if (statusEl) statusEl.innerText = `Saved — scored ${score}/${TOTAL_OBTAINABLE} (${grade}).`;

    const deleteBtn = document.getElementById('journal-delete-btn');
    if (deleteBtn) deleteBtn.classList.remove('hidden');

    renderList();
    renderJournalAnalysis();
  }

  function confirmDeleteJournalEntry() {
    if (!activeTradeId) return;
    const ok = window.confirm('Delete this journal entry? This cannot be undone, and the underlying trade will stay in your history as "Not journaled".');
    if (!ok) return;

    if (typeof window.deleteJournalEntry === 'function') {
      window.deleteJournalEntry(activeTradeId);
    }

    closeJournalForm();
    renderList();
    renderJournalAnalysis();
  }

  // Expose handlers for inline onclick/onchange attributes
  window.openJournalForm = openJournalForm;
  window.onJournalInstrumentFilterChange = onJournalInstrumentFilterChange;
  window.onJournalGradeFilterChange = onJournalGradeFilterChange;
  window.onJournalDateFilterChange = onJournalDateFilterChange;
  window.clearJournalFilters = clearJournalFilters;
  window.closeJournalForm = closeJournalForm;
  window.saveCurrentJournalEntry = saveCurrentJournalEntry;
  window.confirmDeleteJournalEntry = confirmDeleteJournalEntry;
  window.onChecklistToggle = onChecklistToggle;
  window.triggerScreenshotPicker = triggerScreenshotPicker;
  window.onScreenshotFileSelected = onScreenshotFileSelected;
  window.onScreenshotPaste = onScreenshotPaste;
  window.removeScreenshot = removeScreenshot;
  window.renderJournalList = renderList; // dashboard.js can call this to refresh on new trades
  window.setJournalAnalysisRange = setJournalAnalysisRange;
  window.renderJournalAnalysis = renderJournalAnalysis; // dashboard.js can call this to refresh on new trades too

  renderList();
  renderJournalAnalysis();

})();
/* === END COMPONENT: trading-journal (logic) === */