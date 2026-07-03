/* ===========================================================
   COMPONENT: trading-journal (logic) — rebuilt July 2026
   Loaded lazily by app-shell.js the first time this tab opens.

   Rebuilt per the revamped UX design: an adherence hero (This Week / This
   Month, trades-journaled progress, avg review score, avg letter grade),
   a "Needs journaling" queue and a "Journaled entries" tab grouped by
   week/month, a five-section entry form with a live report-card grade
   meter, and a read-only view mode with a per-category breakdown.

   Still backed by the real app state — window.getTradeHistory(),
   window.saveJournalEntry() / getJournalEntry() / getAllJournalEntries() /
   deleteJournalEntry() — this is a reskin + restructure of the screen,
   not a switch to sample data.
   =========================================================== */

(function () {

  // ---------- Weighted review checklist (points match the design exactly) ----------
  const CHECKLIST = {
    "Setup": [
      { key: "clear_strategy", label: "Clearly defined strategy", weight: 3 },
      { key: "sr_levels", label: "Support / Resistance levels set and considered", weight: 3 },
      { key: "catalyst", label: "Catalyst understood", weight: 1 },
      { key: "entry_defined", label: "Entry defined", weight: 3 },
      { key: "target_defined", label: "Target defined", weight: 2 },
      { key: "price_action_monitored", label: "Price action monitored beforehand", weight: 2 },
      { key: "level2_considered", label: "Order book / level 2 considered and supports the trade", weight: 1 },
      { key: "sector_context", label: "Broader market / sector price action considered", weight: 1 },
    ],
    "Entry": [
      { key: "timing", label: "Timing", weight: 3 },
      { key: "sizing", label: "Sizing", weight: 3 },
      { key: "sl_placement", label: "Stop loss set at a logical level (pivot / VWAP / S&R)", weight: 2 },
    ],
    "Management": [
      { key: "monitored_trade", label: "Monitored the trade (no switching away)", weight: 3 },
      { key: "exit_discipline", label: "Exited when setup stopped working (didn't just wait for SL)", weight: 3 },
      { key: "target_exit", label: "Took partials / full exit at target appropriately", weight: 2 },
      { key: "no_errors", label: "No execution errors (wrong qty, wrong order type, etc.)", weight: 3 },
    ],
    "Journaling": [
      { key: "chart_captured", label: "Captured relevant chart / setup information", weight: 2 },
      { key: "setup_explainable", label: "Setup can be fully explained to someone else", weight: 1 },
      { key: "thought_process_written", label: "Wrote up the thought process", weight: 1 },
    ],
  };

  const TOTAL_OBTAINABLE = Object.values(CHECKLIST).flat().reduce((sum, item) => sum + item.weight, 0);

  // Percentage-of-max grade bands (A/B/C/D/F, no E tier) — matches the design.
  const GRADE_COLORS = {
    A: { fg: "#15803D", bg: "#E7F6EC", bd: "#BFE6CB" },
    B: { fg: "#2563EB", bg: "#EAF1FE", bd: "#CFE0FB" },
    C: { fg: "#6D28D9", bg: "#F1EBFE", bd: "#DDD0FA" },
    D: { fg: "#C2620E", bg: "#FDF0E3", bd: "#F4D9BE" },
    F: { fg: "#C53D22", bg: "#FCEEE9", bd: "#F3D3C8" },
  };

  function gradeFor(pts) {
    const pct = TOTAL_OBTAINABLE ? (pts / TOTAL_OBTAINABLE) * 100 : 0;
    let letter, base;
    if (pct >= 97) { letter = "A+"; base = "A"; }
    else if (pct >= 93) { letter = "A"; base = "A"; }
    else if (pct >= 90) { letter = "A-"; base = "A"; }
    else if (pct >= 87) { letter = "B+"; base = "B"; }
    else if (pct >= 83) { letter = "B"; base = "B"; }
    else if (pct >= 80) { letter = "B-"; base = "B"; }
    else if (pct >= 77) { letter = "C+"; base = "C"; }
    else if (pct >= 73) { letter = "C"; base = "C"; }
    else if (pct >= 70) { letter = "C-"; base = "C"; }
    else if (pct >= 67) { letter = "D+"; base = "D"; }
    else if (pct >= 63) { letter = "D"; base = "D"; }
    else if (pct >= 60) { letter = "D-"; base = "D"; }
    else if (pct >= 50) { letter = "F+"; base = "F"; }
    else { letter = "F-"; base = "F"; }
    return { letter, base, ...GRADE_COLORS[base] };
  }

  function ptsFor(checklist) {
    if (!checklist) return 0;
    let p = 0;
    Object.values(CHECKLIST).flat().forEach(item => { if (checklist[item.key]) p += item.weight; });
    return p;
  }

  // fmt() shared — see /src/app/shared/utils/formatters.js
  function formatDate(isoDateString) {
    const d = new Date(isoDateString);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtShort(isoDateString) {
    const d = new Date(isoDateString);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }
  function signedInr(n) {
    return (n >= 0 ? '+' : '-') + '₹' + fmt(Math.abs(Math.round(n)));
  }

  function getHistory() {
    return (typeof window.getTradeHistory === 'function') ? window.getTradeHistory() : [];
  }
  function getEntries() {
    return (typeof window.getAllJournalEntries === 'function') ? window.getAllJournalEntries() : {};
  }

  function weekBounds(d) {
    const s = new Date(d); s.setHours(0, 0, 0, 0); s.setDate(d.getDate() - d.getDay());
    const e = new Date(s); e.setDate(s.getDate() + 6);
    return { s, e };
  }
  function parseYmd(iso) {
    const p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  // ---------- Screen state ----------
  let jMode = 'list';       // 'list' | 'entry' | 'view'
  let jTab = 'todo';        // 'todo' | 'saved'
  let jRange = 'week';      // adherence hero range
  let jGroup = 'week';      // saved-list grouping
  let activeTradeId = null; // trade being journaled (entry mode)
  let viewTradeId = null;   // trade being viewed (view mode)
  let screenshotDataUrl = null;
  let activeInstrumentFilter = '';
  let activeGradeFilter = '';
  let activeDateFrom = '';
  let activeDateTo = '';
  let jfDirection = '';

  function setMode(mode) {
    jMode = mode;
    document.getElementById('journal-mode-list').classList.toggle('hidden', mode !== 'list');
    document.getElementById('journal-mode-entry').classList.toggle('hidden', mode !== 'entry');
    document.getElementById('journal-mode-view').classList.toggle('hidden', mode !== 'view');
  }

  function jBackToList() {
    setMode('list');
    renderList();
  }

  function setJournalRange(range) {
    jRange = range;
    renderHero();
  }

  function setJournalTab(tab) {
    jTab = tab;
    document.getElementById('journal-tab-todo-btn').classList.toggle('active', tab === 'todo');
    document.getElementById('journal-tab-saved-btn').classList.toggle('active', tab === 'saved');
    document.getElementById('journal-tab-todo').classList.toggle('hidden', tab !== 'todo');
    document.getElementById('journal-tab-saved').classList.toggle('hidden', tab !== 'saved');
    if (tab === 'todo') renderTodo(); else renderSaved();
  }

  function setJournalGroup(group) {
    jGroup = group;
    renderSaved();
  }

  // ---------- Adherence hero ----------
  function renderHero() {
    document.getElementById('journal-range-week-btn').classList.toggle('broker-range-pill-active', jRange === 'week');
    document.getElementById('journal-range-month-btn').classList.toggle('broker-range-pill-active', jRange === 'month');

    const now = new Date();
    const wb = weekBounds(now);
    const inRange = (d) => jRange === 'week'
      ? (d >= wb.s && d <= new Date(wb.e.getFullYear(), wb.e.getMonth(), wb.e.getDate(), 23, 59, 59))
      : (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear());

    const chipEl = document.getElementById('journal-range-chip');
    if (chipEl) {
      chipEl.innerText = jRange === 'week'
        ? `${formatDate(wb.s.toISOString().slice(0, 10))}  –  ${formatDate(now.toISOString().slice(0, 10))}`
        : now.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    }

    const history = getHistory();
    const entries = getEntries();
    const rangeTrades = history.filter(t => inRange(parseYmd(t.date)));
    const journaledInRange = rangeTrades.filter(t => entries[t.id]);
    const total = rangeTrades.length;
    const done = journaledInRange.length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    const doneEl = document.getElementById('journal-hero-done');
    const pctEl = document.getElementById('journal-hero-pct');
    const barEl = document.getElementById('journal-hero-bar');
    if (doneEl) doneEl.innerText = `${done} / ${total}`;
    if (pctEl) pctEl.innerText = total ? `(${pct}%)` : '—';
    if (barEl) barEl.style.width = (total ? pct : 0) + '%';

    const scored = journaledInRange.filter(t => typeof entries[t.id].score === 'number');
    const avgPts = scored.length ? scored.reduce((a, t) => a + entries[t.id].score, 0) / scored.length : null;
    const avgScoreEl = document.getElementById('journal-hero-avg-score');
    if (avgScoreEl) avgScoreEl.innerText = avgPts != null ? `${Math.round(avgPts * 10) / 10} / ${TOTAL_OBTAINABLE}` : '—';

    const avgGradeEl = document.getElementById('journal-hero-avg-grade');
    if (avgGradeEl) {
      if (avgPts != null) {
        const g = gradeFor(avgPts);
        avgGradeEl.innerHTML = `<span class="journal-grade-pill" style="color:${g.fg}; background:${g.bg}; border:1px solid ${g.bd};">${g.letter}</span>`;
      } else {
        avgGradeEl.innerHTML = `<span class="journal-grade-pill-empty">—</span>`;
      }
    }
  }

  // ---------- Needs-journaling tab ----------
  function renderTodo() {
    const history = getHistory();
    const entries = getEntries();
    const todo = history.filter(t => !entries[t.id]).slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.submittedAt || 0) < (b.submittedAt || 0) ? 1 : -1;
    });

    document.getElementById('journal-todo-count').innerText = todo.length;
    document.getElementById('journal-saved-count').innerText = history.filter(t => entries[t.id]).length;

    const rowsEl = document.getElementById('journal-todo-rows');
    if (!rowsEl) return;

    if (todo.length === 0) {
      rowsEl.innerHTML = `
        <div class="journal-empty" style="grid-column:1/-1;">
          <div class="journal-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#15803D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
          <div class="journal-empty-text">All caught up — every trade has been journaled. New trades from the Daily Limits Tool will appear here.</div>
        </div>
      `;
      return;
    }

    rowsEl.innerHTML = todo.map(t => {
      const isWin = t.netResult > 0;
      const color = isWin ? 'var(--color-profit)' : (t.netResult < 0 ? '#C53D22' : '#5B6B82');
      return `
        <div class="journal-todo-row" style="display:contents;">
          <div class="journal-todo-cell">${formatDate(t.date)}</div>
          <div class="journal-todo-cell">${t.instrument || '—'}</div>
          <div class="journal-todo-cell num" style="color:${color};">${signedInr(t.netResult)}</div>
          <div class="journal-todo-cell"><span class="journal-todo-status">Not journaled</span></div>
          <div class="journal-todo-cell" style="justify-content:flex-end;"><button type="button" class="journal-write-btn" onclick="openJournalForm('${t.id}')">Write entry</button></div>
        </div>
      `;
    }).join('');
  }

  // ---------- Journaled-entries tab (grouped by week/month) ----------
  function populateInstrumentFilter(history) {
    const select = document.getElementById('journal-instrument-filter');
    if (!select) return;
    const instruments = Array.from(new Set(history.map(t => t.instrument).filter(Boolean))).sort();
    const currentValue = select.value;
    select.innerHTML = '<option value="">All instruments</option>' + instruments.map(name => `<option value="${name}">${name}</option>`).join('');
    select.value = instruments.includes(currentValue) ? currentValue : '';
  }

  function onJournalInstrumentFilterChange() {
    activeInstrumentFilter = document.getElementById('journal-instrument-filter').value;
    renderSaved();
  }
  function onJournalGradeFilterChange() {
    activeGradeFilter = document.getElementById('journal-grade-filter').value;
    renderSaved();
  }
  function onJournalDateFilterChange() {
    activeDateFrom = document.getElementById('journal-date-from').value;
    activeDateTo = document.getElementById('journal-date-to').value;
    renderSaved();
  }
  function clearJournalFilters() {
    activeInstrumentFilter = ''; activeGradeFilter = ''; activeDateFrom = ''; activeDateTo = '';
    document.getElementById('journal-instrument-filter').value = '';
    document.getElementById('journal-grade-filter').value = '';
    document.getElementById('journal-date-from').value = '';
    document.getElementById('journal-date-to').value = '';
    renderSaved();
  }

  function renderSaved() {
    document.getElementById('journal-group-week-btn').classList.toggle('active', jGroup === 'week');
    document.getElementById('journal-group-month-btn').classList.toggle('active', jGroup === 'month');

    const history = getHistory();
    populateInstrumentFilter(history);
    const entries = getEntries();

    let journaled = history.filter(t => entries[t.id]);
    if (activeInstrumentFilter) journaled = journaled.filter(t => t.instrument === activeInstrumentFilter);
    if (activeGradeFilter) journaled = journaled.filter(t => gradeFor(ptsFor(entries[t.id].checklist)).base === activeGradeFilter);
    if (activeDateFrom) journaled = journaled.filter(t => t.date >= activeDateFrom);
    if (activeDateTo) journaled = journaled.filter(t => t.date <= activeDateTo);
    journaled.sort((a, b) => (a.date < b.date ? 1 : -1));

    const area = document.getElementById('journal-groups-area');
    if (!area) return;

    if (journaled.length === 0) {
      area.innerHTML = `
        <div class="journal-empty" style="background:#fff; border:1px solid #E3E9F1; border-radius:14px;">
          <div class="journal-empty-icon neutral"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#AEB9C8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 0-2 2z"/><path d="M4 21a2 2 0 0 1 2-2h12"/></svg></div>
          <div class="journal-empty-text">No entries match these filters. Try clearing them, or journal a trade from the Needs journaling tab.</div>
        </div>
      `;
      return;
    }

    const now = new Date();
    const groupsMap = [];
    const keyFor = (d) => jGroup === 'week' ? (() => { const b = weekBounds(d); return b.s.getFullYear() + '-w-' + b.s.getMonth() + '-' + b.s.getDate(); })() : (d.getFullYear() + '-m-' + d.getMonth());

    journaled.forEach(t => {
      const d = parseYmd(t.date);
      const k = keyFor(d);
      let g = groupsMap.find(x => x.k === k);
      if (!g) {
        let title, sub;
        if (jGroup === 'week') {
          const b = weekBounds(d);
          const thisB = weekBounds(now);
          const lastB = weekBounds(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
          title = b.s.getTime() === thisB.s.getTime() ? 'This week' : (b.s.getTime() === lastB.s.getTime() ? 'Last week' : 'Week of ' + fmtShort(b.s.toISOString().slice(0, 10)));
          sub = fmtShort(b.s.toISOString().slice(0, 10)) + ' – ' + formatDate(b.e.toISOString().slice(0, 10));
        } else {
          const sameMonth = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
          title = sameMonth ? 'This month' : d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
          sub = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
        }
        g = { k, title, sub, items: [], _net: 0, _pts: 0 };
        groupsMap.push(g);
      }
      const entry = entries[t.id];
      const pts = ptsFor(entry.checklist);
      const gr = gradeFor(pts);
      g._net += t.netResult; g._pts += pts;
      g.items.push({ t, entry, pts, gr });
    });

    area.innerHTML = groupsMap.map(g => {
      const avg = g.items.length ? g._pts / g.items.length : 0;
      const avgGr = gradeFor(avg);
      const itemsHtml = g.items.map(({ t, entry, pts, gr }) => {
        const isWin = t.netResult > 0;
        const resultColor = isWin ? 'var(--color-profit)' : (t.netResult < 0 ? '#C53D22' : '#5B6B82');
        const dirLabel = entry.direction === 'short' ? 'Short' : (entry.direction === 'long' ? 'Long' : '');
        const dirColor = entry.direction === 'short' ? '#C53D22' : 'var(--color-profit)';
        const barW = Math.round((pts / TOTAL_OBTAINABLE) * 100) + '%';
        return `
          <div class="journal-entry-card" onclick="openJournalView('${t.id}')">
            <div class="journal-entry-badge" style="color:${gr.fg}; background:${gr.bg}; border:1px solid ${gr.bd};">${gr.letter}</div>
            <div class="journal-entry-main">
              <div class="journal-entry-title-row">
                <span class="journal-entry-instrument">${entry.instrument || t.instrument || '—'}</span>
                ${dirLabel ? `<span class="journal-entry-dir" style="color:${dirColor};">${dirLabel}</span>` : ''}
              </div>
              <div class="journal-entry-snippet">${(entry.setupReason || 'No setup notes written.')}</div>
            </div>
            <div class="journal-entry-result-col">
              <div class="journal-entry-result" style="color:${resultColor};">${signedInr(t.netResult)}</div>
              <div class="journal-entry-date">${formatDate(t.date)}</div>
            </div>
            <div class="journal-entry-score-col">
              <div class="journal-entry-score-row"><span>Score</span><b>${pts}/${TOTAL_OBTAINABLE}</b></div>
              <div class="journal-entry-score-track"><div class="journal-entry-score-fill" style="width:${barW}; background:${gr.fg};"></div></div>
            </div>
            <svg class="journal-entry-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
          </div>
        `;
      }).join('');
      return `
        <div class="journal-group">
          <div class="journal-group-header">
            <div class="journal-group-title-row"><span class="journal-group-title">${g.title}</span><span class="journal-group-sub">${g.sub}</span></div>
            <div class="journal-group-meta">
              <span>${g.items.length} ${g.items.length === 1 ? 'entry' : 'entries'}</span>
              <span>avg <span class="journal-group-avg-grade" style="color:${avgGr.fg}; background:${avgGr.bg}; border:1px solid ${avgGr.bd};">${avgGr.letter}</span></span>
              <span>net <b style="color:${g._net >= 0 ? 'var(--color-profit)' : '#C53D22'};">${signedInr(g._net)}</b></span>
            </div>
          </div>
          <div class="journal-group-items">${itemsHtml}</div>
        </div>
      `;
    }).join('');
  }

  function renderList() {
    renderHero();
    setJournalTab(jTab);
  }

  // ---------- Checklist rendering (entry form) ----------
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
          <label class="journal-checklist-item ${isChecked ? 'checked' : ''}" data-key="${item.key}">
            <input type="checkbox" data-checklist-key="${item.key}" data-weight="${item.weight}" ${isChecked ? 'checked' : ''} onchange="onChecklistToggle(this)">
            <span class="journal-checklist-box">${isChecked ? '✓' : ''}</span>
            <span class="journal-checklist-label">${item.label}</span>
            <span class="journal-checklist-weight">+${item.weight}</span>
          </label>
        `;
      });
    });
    container.innerHTML = html;
    updateLiveGrade();
  }

  function onChecklistToggle(checkboxEl) {
    const label = checkboxEl.closest('.journal-checklist-item');
    const box = label.querySelector('.journal-checklist-box');
    const isChecked = checkboxEl.checked;
    label.classList.toggle('checked', isChecked);
    box.innerText = isChecked ? '✓' : '';
    updateLiveGrade();
  }

  function computeFormScore() {
    const inputs = document.querySelectorAll('#journal-checklist-area input[type="checkbox"]');
    let score = 0;
    inputs.forEach(input => { if (input.checked) score += parseInt(input.dataset.weight, 10); });
    return score;
  }

  function updateLiveGrade() {
    const score = computeFormScore();
    const g = gradeFor(score);
    const gradeEl = document.getElementById('journal-live-grade');
    const ptsEl = document.getElementById('journal-live-pts');
    const barEl = document.getElementById('journal-live-bar');
    if (gradeEl) {
      gradeEl.innerText = g.letter;
      gradeEl.style.color = g.fg; gradeEl.style.background = g.bg; gradeEl.style.borderColor = g.bd; gradeEl.style.border = `1px solid ${g.bd}`;
    }
    if (ptsEl) ptsEl.innerHTML = `${score} / ${TOTAL_OBTAINABLE} points`;
    if (barEl) { barEl.style.width = Math.round((score / TOTAL_OBTAINABLE) * 100) + '%'; barEl.style.background = g.fg; }
  }

  function setJfDirection(dir) {
    jfDirection = dir;
    document.getElementById('jf-dir-long').classList.toggle('active', dir === 'long');
    document.getElementById('jf-dir-short').classList.toggle('active', dir === 'short');
  }

  // ---------- Open / close the entry form ----------
  function openJournalForm(tradeId) {
    activeTradeId = tradeId;
    const trade = getHistory().find(t => t.id === tradeId);
    if (!trade) return;

    const metaEl = document.getElementById('journal-form-meta');
    if (metaEl) {
      const isWin = trade.netResult > 0;
      const color = isWin ? 'var(--color-profit)' : (trade.netResult < 0 ? '#C53D22' : '#5B6B82');
      metaEl.innerHTML = `${formatDate(trade.date)} · <b style="color:${color};">${signedInr(trade.netResult)}</b> · Balance after: ₹${fmt(trade.balanceAfter)}`;
    }

    const existing = (typeof window.getJournalEntry === 'function') ? window.getJournalEntry(tradeId) : null;

    document.getElementById('jf-instrument').value = existing ? (existing.instrument || trade.instrument || '') : (trade.instrument || '');
    setJfDirection(existing ? (existing.direction || '') : '');
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

    document.getElementById('journal-delete-btn').classList.toggle('hidden', !existing);
    const statusEl = document.getElementById('journal-save-status');
    if (statusEl) statusEl.innerText = existing ? 'Editing a saved entry — changes overwrite it on save.' : '';

    setMode('entry');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- View mode ----------
  function openJournalView(tradeId) {
    viewTradeId = tradeId;
    const trade = getHistory().find(t => t.id === tradeId);
    const entry = (typeof window.getJournalEntry === 'function') ? window.getJournalEntry(tradeId) : null;
    if (!trade || !entry) return;

    const pts = ptsFor(entry.checklist);
    const g = gradeFor(pts);
    const isWin = trade.netResult > 0;
    const resultColor = isWin ? 'var(--color-profit)' : (trade.netResult < 0 ? '#C53D22' : '#5B6B82');
    const dirLabel = entry.direction === 'short' ? 'Short' : (entry.direction === 'long' ? 'Long' : '');
    const dirColor = entry.direction === 'short' ? '#C53D22' : 'var(--color-profit)';

    const gradeEl = document.getElementById('journal-view-grade');
    gradeEl.innerText = g.letter;
    gradeEl.style.color = g.fg; gradeEl.style.background = g.bg; gradeEl.style.border = `1px solid ${g.bd}`;

    document.getElementById('journal-view-instrument').innerText = entry.instrument || trade.instrument || '—';
    const dirEl = document.getElementById('journal-view-dir');
    dirEl.innerText = dirLabel; dirEl.style.color = dirColor;
    document.getElementById('journal-view-date').innerText = formatDate(trade.date);
    document.getElementById('journal-view-bar').style.width = Math.round((pts / TOTAL_OBTAINABLE) * 100) + '%';
    document.getElementById('journal-view-bar').style.background = g.fg;
    document.getElementById('journal-view-pts').innerText = `${pts} / ${TOTAL_OBTAINABLE} points`;
    const resultEl = document.getElementById('journal-view-result');
    resultEl.innerText = signedInr(trade.netResult); resultEl.style.color = resultColor;

    document.getElementById('journal-view-entry').innerText = entry.entryPrice || '—';
    document.getElementById('journal-view-exit').innerText = entry.exitPrice || '—';
    document.getElementById('journal-view-sl').innerText = entry.stopLoss || '—';
    document.getElementById('journal-view-target').innerText = entry.target || '—';
    document.getElementById('journal-view-rr').innerText = entry.rrRatio || '—';

    document.getElementById('journal-view-setup').innerText = entry.setupReason || '—';
    document.getElementById('journal-view-market').innerText = entry.marketConditions || '—';
    document.getElementById('journal-view-emotion').innerText = entry.emotion || '—';
    document.getElementById('journal-view-mistakes').innerText = entry.mistakes || '—';

    const shotWrap = document.getElementById('journal-view-screenshot-wrap');
    if (entry.screenshot) {
      shotWrap.classList.remove('hidden');
      document.getElementById('journal-view-screenshot').src = entry.screenshot;
    } else {
      shotWrap.classList.add('hidden');
    }

    const breakdownEl = document.getElementById('journal-view-breakdown');
    const checked = entry.checklist || {};
    breakdownEl.innerHTML = Object.keys(CHECKLIST).map(category => {
      const items = CHECKLIST[category].filter(it => checked[it.key]);
      if (items.length === 0) return '';
      return `
        <div class="journal-view-breakdown-group">
          <div class="journal-view-breakdown-header">
            <span class="journal-view-breakdown-title">${category}</span>
            <span class="journal-view-breakdown-count">${items.length}/${CHECKLIST[category].length} checked</span>
          </div>
          ${items.map(it => `
            <div class="journal-view-breakdown-row">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#15803D" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;"><path d="M20 6L9 17l-5-5"/></svg>
              <span class="journal-view-breakdown-label">${it.label}</span>
              <span class="journal-view-breakdown-pts">+${it.weight}</span>
            </div>
          `).join('')}
        </div>
      `;
    }).join('') || '<p class="section-note">No checklist items were checked for this entry.</p>';

    setMode('view');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function editCurrentJournalEntry() {
    if (viewTradeId) openJournalForm(viewTradeId);
  }

  // ---------- Setup screenshot: upload + paste (unchanged behaviour) ----------
  function triggerScreenshotPicker() {
    const input = document.getElementById('jf-screenshot-input');
    if (input) input.click();
  }
  function onScreenshotFileSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (file) loadImageFile(file);
    event.target.value = '';
  }
  function onScreenshotPaste(event) {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) { loadImageFile(file); event.preventDefault(); }
        return;
      }
    }
    const errorEl = document.getElementById('jf-screenshot-error');
    if (errorEl) { errorEl.classList.remove('hidden'); errorEl.innerText = 'No image found on the clipboard. Copy a screenshot first, then paste here.'; }
  }
  function loadImageFile(file) {
    const errorEl = document.getElementById('jf-screenshot-error');
    if (errorEl) { errorEl.classList.add('hidden'); errorEl.innerText = ''; }
    if (!file.type.startsWith('image/')) {
      if (errorEl) { errorEl.classList.remove('hidden'); errorEl.innerText = 'Please select an image file.'; }
      return;
    }
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      if (errorEl) { errorEl.classList.remove('hidden'); errorEl.innerText = 'Image is too large (max 5MB). Try a smaller screenshot or crop it first.'; }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setScreenshot(reader.result);
    reader.onerror = () => { if (errorEl) { errorEl.classList.remove('hidden'); errorEl.innerText = 'Could not read that image. Try a different file.'; } };
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
    if (event) event.stopPropagation();
    setScreenshot(null);
  }

  function saveCurrentJournalEntry() {
    if (!activeTradeId) return;
    const checklistState = {};
    document.querySelectorAll('#journal-checklist-area input[type="checkbox"]').forEach(input => {
      checklistState[input.dataset.checklistKey] = input.checked;
    });
    const score = computeFormScore();
    const g = gradeFor(score);

    const entryData = {
      instrument: document.getElementById('jf-instrument').value.trim(),
      direction: jfDirection,
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
      grade: g.letter,
      screenshot: screenshotDataUrl,
    };

    if (typeof window.saveJournalEntry === 'function') {
      window.saveJournalEntry(activeTradeId, entryData);
    }

    setMode('list');
    jTab = 'saved';
    renderList();
  }

  function confirmDeleteJournalEntry() {
    if (!activeTradeId) return;
    const ok = window.confirm('Delete this journal entry? This cannot be undone, and the underlying trade will stay in your history as "Not journaled".');
    if (!ok) return;
    if (typeof window.deleteJournalEntry === 'function') window.deleteJournalEntry(activeTradeId);
    setMode('list');
    renderList();
  }

  // Expose handlers for inline onclick/onchange attributes
  window.jBackToList = jBackToList;
  window.setJournalRange = setJournalRange;
  window.setJournalTab = setJournalTab;
  window.setJournalGroup = setJournalGroup;
  window.openJournalForm = openJournalForm;
  window.openJournalView = openJournalView;
  window.editCurrentJournalEntry = editCurrentJournalEntry;
  window.setJfDirection = setJfDirection;
  window.onJournalInstrumentFilterChange = onJournalInstrumentFilterChange;
  window.onJournalGradeFilterChange = onJournalGradeFilterChange;
  window.onJournalDateFilterChange = onJournalDateFilterChange;
  window.clearJournalFilters = clearJournalFilters;
  window.saveCurrentJournalEntry = saveCurrentJournalEntry;
  window.confirmDeleteJournalEntry = confirmDeleteJournalEntry;
  window.onChecklistToggle = onChecklistToggle;
  window.triggerScreenshotPicker = triggerScreenshotPicker;
  window.onScreenshotFileSelected = onScreenshotFileSelected;
  window.onScreenshotPaste = onScreenshotPaste;
  window.removeScreenshot = removeScreenshot;
  window.renderJournalList = renderList; // app-shell.js calls this to refresh on new trades
  window.renderJournalAnalysis = renderHero; // kept for app-shell.js's existing call sites

  setMode('list');
  renderList();

})();
/* === END COMPONENT: trading-journal (logic) === */
