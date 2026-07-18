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

  // ---------- Behavior-flag penalty ----------
  // Links section 4's mistake flags to the section 5 score, so a trade
  // flagged with Overtrading/Revenge trading/etc can't still grade like a
  // clean one. Each selected mistake flag costs FLAG_PENALTY points
  // ("No mistakes" costs nothing). Floor at 0 — no negative scores.
  const FLAG_PENALTY = 2;

  function flagPenaltyFor(flags) {
    if (!Array.isArray(flags)) return 0;
    return flags.filter(k => k !== 'no-mistakes').length * FLAG_PENALTY;
  }

  // The one true score for a SAVED entry — checklist points minus the
  // behavior-flag penalty. Every list/filter/average/view must use this
  // (not raw ptsFor) so grades agree everywhere.
  function entryPtsFor(entry) {
    if (!entry) return 0;
    return Math.max(0, ptsFor(entry.checklist) - flagPenaltyFor(entry.behaviorFlags));
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

  // Delegates to the shared window.getWeekBounds() (formatters.js) — this
  // used to compute its own Sunday-start week here, which quietly
  // disagreed with dashboard-home.js's Monday-start "this week" (used by
  // the Weekly Review card). Now both — plus Calculators' Withdraw &
  // Scale — agree on the same Monday-start trading week. Kept as a thin
  // local wrapper (rather than rewriting every {s,e} call site below to
  // {start,end}) so this is a one-line behavioral fix, not a refactor.
  function weekBounds(d) {
    if (typeof window.getWeekBounds === 'function') {
      const wk = window.getWeekBounds(d);
      return { s: wk.start, e: wk.end };
    }
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
  let jRange = 'week';      // adherence hero range (unchanged — still drives the Rule Adherence Analysis section + the Needs journaling/Journaled entries tabs below it, independently of jOverviewRange)
  let jOverviewRange = 'week'; // 'day' | 'week' | 'month' — the new Overview section's own range, independent of jRange above (that section's own Week/Month/All Time toggle is a separate, pre-existing control)
  let lastOverviewStats = null; // stashed by renderOverview() so openOverviewDrawer() doesn't have to recompute
  let jRbRange = 'month';   // Rule-broken Days full page's own Day/Week/Month range — independent of jRange and jOverviewRange; defaults to Month since that's the view the user asked for by name
  let jReturnMode = 'list'; // where jBackToList()/save/delete should land after the entry/view form closes — 'list' | 'rulebreaks' | 'entries' | 'missed', set right before jumping into a trade's detail from any of those places
  let jEntriesGroup = 'week';   // Day/Week/Month/All grouping for the master-detail Journal Entries page — independent of jGroup (the older inline saved-list grouping)
  let jEntriesSelectedId = null; // trade id currently shown in the Entries page's right-hand detail pane
  let jedInstrumentFilter = ''; // Entries page's own filter state — kept separate from activeInstrumentFilter/etc (the inline Journaled-entries tab's filters) so the two don't fight over the same fields
  let jedGradeFilter = '';
  let jedDateFrom = '';
  let jedDateTo = '';
  let jMissedRange = 'week';    // Missed Entries page's own Day/Week/Month range
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
    const rbEl = document.getElementById('journal-mode-rulebreaks');
    if (rbEl) rbEl.classList.toggle('hidden', mode !== 'rulebreaks');
    const enEl = document.getElementById('journal-mode-entries');
    if (enEl) enEl.classList.toggle('hidden', mode !== 'entries');
    const miEl = document.getElementById('journal-mode-missed');
    if (miEl) miEl.classList.toggle('hidden', mode !== 'missed');
  }

  // "Back"/"Cancel"/Save/Delete from the entry/view form all funnel through
  // here — it used to always land on the main list, but now that
  // Rule-broken Days, the master-detail Entries page, and Missed Entries
  // can each jump into a trade's detail, it needs to return wherever the
  // user actually came from. jReturnMode is set right before that jump
  // and reset to 'list' here so it doesn't leak into unrelated navigation
  // later. opts.tab lets save() land on the "Journaled entries" tab when
  // falling back to the main list; opts.deleted clears the Entries page's
  // selection since that trade's detail no longer exists.
  function returnFromForm(opts) {
    opts = opts || {};
    const target = jReturnMode;
    jReturnMode = 'list';
    if (target === 'rulebreaks') {
      setMode('rulebreaks');
      renderRuleBreaksPage();
    } else if (target === 'missed') {
      setMode('missed');
      renderMissedPage();
    } else if (target === 'entries') {
      if (opts.deleted) jEntriesSelectedId = null;
      setMode('entries');
      renderEntriesPage();
    } else {
      setMode('list');
      if (opts.tab) jTab = opts.tab;
      renderList();
    }
  }

  function jBackToList() {
    returnFromForm();
  }

  function setJournalRange(range) {
    jRange = range;
    renderHero();
    // The hero's range (This Week / This Month / All Time) now scopes the
    // tabs below it too — previously the hero stat was range-scoped while
    // "Needs journaling" / "Journaled entries" always showed ALL-time
    // counts regardless, so e.g. the hero could say "4/4 (100%)" for This
    // Week while the tab badge next to it said "Needs journaling 3" for
    // trades from weeks earlier — a real, confusing contradiction on the
    // same screen. Now both read from the same filtered set, so switching
    // the range changes the whole page consistently, not just the hero.
    if (jTab === 'todo') renderTodo(); else renderSaved();
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

  // Shared by the hero stats AND both tabs below, so every number on this
  // screen is always talking about the same period — see setJournalRange().
  function inCurrentRange(d) {
    if (jRange === 'all') return true;
    const now = new Date();
    const wb = weekBounds(now);
    return jRange === 'week'
      ? (d >= wb.s && d <= new Date(wb.e.getFullYear(), wb.e.getMonth(), wb.e.getDate(), 23, 59, 59))
      : (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear());
  }

  function rangeScopedHistory() {
    return getHistory().filter(t => inCurrentRange(parseYmd(t.date)));
  }

  // ---------- Adherence hero ----------
  function renderHero() {
    document.getElementById('journal-range-week-btn').classList.toggle('broker-range-pill-active', jRange === 'week');
    document.getElementById('journal-range-month-btn').classList.toggle('broker-range-pill-active', jRange === 'month');
    const allBtn = document.getElementById('journal-range-all-btn');
    if (allBtn) allBtn.classList.toggle('broker-range-pill-active', jRange === 'all');

    const now = new Date();
    const wb = weekBounds(now);

    const chipEl = document.getElementById('journal-range-chip');
    if (chipEl) {
      chipEl.innerText = jRange === 'week'
        ? `${formatDate(wb.s.toISOString().slice(0, 10))}  –  ${formatDate(now.toISOString().slice(0, 10))}`
        : jRange === 'month'
          ? now.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
          : 'All time';
    }

    const entries = getEntries();
    const rangeTrades = rangeScopedHistory();
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

    // Avg grade dropped from this hero — now shown as its own tile in the
    // Overview section above (journal-ov-avggrade-value, renderOverview()),
    // so it isn't duplicated on screen.
    const scored = journaledInRange.filter(t => typeof entries[t.id].score === 'number');
    const avgPts = scored.length ? scored.reduce((a, t) => a + entries[t.id].score, 0) / scored.length : null;
    const avgScoreEl = document.getElementById('journal-hero-avg-score');
    if (avgScoreEl) avgScoreEl.innerText = avgPts != null ? `${Math.round(avgPts * 10) / 10} / ${TOTAL_OBTAINABLE}` : '—';
  }

  // ---------- Overview section (Wins/Losses/Clean Days/etc, + drawer) ----------
  // New, separate from the adherence hero above — its own Day/Week/Month
  // range (jOverviewRange), its own bounds/comparison math, and a
  // click-to-drawer detail view per tile. Best/Worst Strategy tiles were
  // explicitly dropped from the reference design for now — there's no
  // structured "strategy name" anywhere in the data model yet (journal
  // entries only have a free-text setupReason), so those two stats would
  // have nothing real to compute from.

  function overviewRangeBounds(rangeKey) {
    const now = new Date();
    if (rangeKey === 'day') {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      return { s, e };
    }
    if (rangeKey === 'month') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      return { s, e };
    }
    const wb = weekBounds(now);
    return { s: wb.s, e: new Date(wb.e.getFullYear(), wb.e.getMonth(), wb.e.getDate(), 23, 59, 59) };
  }

  // One period back from overviewRangeBounds() — used only for the "▲/▼
  // better/worse than last X" comparison badge, not for any tile's own
  // number.
  function overviewPrevRangeBounds(rangeKey) {
    const { s } = overviewRangeBounds(rangeKey);
    if (rangeKey === 'day') {
      const p = new Date(s); p.setDate(p.getDate() - 1);
      return { s: new Date(p.getFullYear(), p.getMonth(), p.getDate()), e: new Date(p.getFullYear(), p.getMonth(), p.getDate(), 23, 59, 59) };
    }
    if (rangeKey === 'month') {
      const s2 = new Date(s.getFullYear(), s.getMonth() - 1, 1);
      const e2 = new Date(s.getFullYear(), s.getMonth(), 0, 23, 59, 59);
      return { s: s2, e: e2 };
    }
    const s2 = new Date(s); s2.setDate(s2.getDate() - 7);
    const e2 = new Date(s2); e2.setDate(s2.getDate() + 6); e2.setHours(23, 59, 59);
    return { s: s2, e: e2 };
  }

  function overviewPeriodLabel(rangeKey) {
    return rangeKey === 'day' ? 'today' : rangeKey === 'month' ? 'this month' : 'this week';
  }
  function overviewPrevLabel(rangeKey) {
    return rangeKey === 'day' ? 'yesterday' : rangeKey === 'month' ? 'last month' : 'last week';
  }

  function tradesInBounds(bounds) {
    return getHistory().filter(t => {
      const d = parseYmd(t.date);
      return d >= bounds.s && d <= bounds.e;
    });
  }

  // A trade counts as "clean" if its own ruleStatus says so — recordCompletedDay()
  // (app-shell.js) always defaults ruleStatus to { compliant: true, ... } when
  // none is passed, so every trade has one; the `!t.ruleStatus ||` check is just
  // defensive against older/unexpected records. A DAY is clean only if every
  // trade on it was — one broken trade marks the whole day as rule-broken,
  // matching how the Daily Limits Tool treats a day's compliance.
  function computeOverviewStats(rangeKey) {
    const bounds = overviewRangeBounds(rangeKey);
    const trades = tradesInBounds(bounds);
    const entries = getEntries();

    const wins = trades.filter(t => t.netResult > 0).sort((a, b) => b.netResult - a.netResult);
    const losses = trades.filter(t => t.netResult < 0).sort((a, b) => a.netResult - b.netResult);
    const winsSum = wins.reduce((s, t) => s + t.netResult, 0);
    const lossesSum = losses.reduce((s, t) => s + t.netResult, 0);
    const largestWin = wins.length ? wins[0] : null;
    const largestLoss = losses.length ? losses[0] : null;

    const byDate = {};
    trades.forEach(t => { (byDate[t.date] = byDate[t.date] || []).push(t); });
    const dateKeys = Object.keys(byDate);
    const isCompliant = (t) => !t.ruleStatus || t.ruleStatus.compliant !== false;
    const cleanDates = dateKeys.filter(dk => byDate[dk].every(isCompliant));
    const ruleBrokenDates = dateKeys.filter(dk => !cleanDates.includes(dk));
    const cleanTrades = cleanDates.flatMap(dk => byDate[dk]);
    const ruleBrokenTrades = ruleBrokenDates.flatMap(dk => byDate[dk]);

    const journaledInRange = trades.filter(t => entries[t.id]).sort((a, b) => (a.date < b.date ? 1 : -1));
    const gradedList = journaledInRange.map(t => ({ t, pts: entryPtsFor(entries[t.id]) }));
    const avgPts = gradedList.length ? gradedList.reduce((s, g) => s + g.pts, 0) / gradedList.length : null;
    const avgGrade = avgPts != null ? gradeFor(avgPts) : null;

    const prevTrades = tradesInBounds(overviewPrevRangeBounds(rangeKey));
    const netNow = trades.reduce((s, t) => s + t.netResult, 0);
    const netPrev = prevTrades.reduce((s, t) => s + t.netResult, 0);

    return {
      rangeKey, trades, wins, losses, winsSum, lossesSum, largestWin, largestLoss,
      dateKeys, cleanDates, ruleBrokenDates, cleanTrades, ruleBrokenTrades,
      journaledInRange, avgGrade, delta: netNow - netPrev,
    };
  }

  function setOverviewRange(rangeKey) {
    jOverviewRange = rangeKey;
    renderOverview();
  }

  function renderOverview() {
    const dayBtn = document.getElementById('journal-ov-day-btn');
    const weekBtn = document.getElementById('journal-ov-week-btn');
    const monthBtn = document.getElementById('journal-ov-month-btn');
    if (dayBtn) dayBtn.classList.toggle('broker-range-pill-active', jOverviewRange === 'day');
    if (weekBtn) weekBtn.classList.toggle('broker-range-pill-active', jOverviewRange === 'week');
    if (monthBtn) monthBtn.classList.toggle('broker-range-pill-active', jOverviewRange === 'month');

    const stats = computeOverviewStats(jOverviewRange);
    lastOverviewStats = stats;
    const periodLabel = overviewPeriodLabel(jOverviewRange);

    const badgeEl = document.getElementById('journal-ov-badge');
    if (badgeEl) {
      if (stats.trades.length === 0) {
        badgeEl.classList.add('hidden');
      } else {
        badgeEl.classList.remove('hidden');
        const up = stats.delta >= 0;
        badgeEl.classList.toggle('journal-ov-badge-up', up);
        badgeEl.classList.toggle('journal-ov-badge-down', !up);
        badgeEl.innerHTML = `${up ? '&#9650;' : '&#9660;'} &#8377;${fmt(Math.abs(Math.round(stats.delta)))} ${up ? 'better' : 'worse'} than ${overviewPrevLabel(jOverviewRange)}`;
      }
    }

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };

    setText('journal-ov-wins-value', String(stats.wins.length));
    setText('journal-ov-wins-sub', stats.wins.length ? signedInr(stats.winsSum) : '—');

    setText('journal-ov-losses-value', String(stats.losses.length));
    setText('journal-ov-losses-sub', stats.losses.length ? signedInr(stats.lossesSum) : '—');

    setText('journal-ov-clean-value', String(stats.cleanDates.length));
    setText('journal-ov-clean-sub', `${stats.cleanDates.length} of ${stats.dateKeys.length} days`);

    setText('journal-ov-rulebroken-value', String(stats.ruleBrokenDates.length));
    setText('journal-ov-rulebroken-sub', `${stats.ruleBrokenDates.length} of ${stats.dateKeys.length} days`);

    setText('journal-ov-largestwin-value', stats.largestWin ? signedInr(stats.largestWin.netResult) : '—');
    setText('journal-ov-largestwin-sub', stats.largestWin ? `${stats.largestWin.instrument || '—'} · ${fmtShort(stats.largestWin.date)}` : '—');

    setText('journal-ov-largestloss-value', stats.largestLoss ? signedInr(stats.largestLoss.netResult) : '—');
    setText('journal-ov-largestloss-sub', stats.largestLoss ? `${stats.largestLoss.instrument || '—'} · ${fmtShort(stats.largestLoss.date)}` : '—');

    const gradeEl = document.getElementById('journal-ov-avggrade-value');
    if (gradeEl) {
      if (stats.avgGrade) {
        gradeEl.innerHTML = `<span class="journal-grade-pill" style="color:${stats.avgGrade.fg}; background:${stats.avgGrade.bg}; border:1px solid ${stats.avgGrade.bd};">${stats.avgGrade.letter}</span>`;
      } else {
        gradeEl.innerHTML = `<span class="journal-grade-pill-empty">—</span>`;
      }
    }
    setText('journal-ov-avggrade-sub', `${stats.journaledInRange.length} trade${stats.journaledInRange.length === 1 ? '' : 's'} scored`);

    // Single dynamic insight banner — no rule breaks (praise), some rule
    // breaks (flag it), or nothing logged yet this period. The warn state
    // is clickable (handleOverviewBannerClick) so "check the tile" is a
    // real shortcut into the same drawer the Rule-broken Days tile opens,
    // not just a pointer to go find it elsewhere.
    const bannerEl = document.getElementById('journal-ov-banner');
    if (bannerEl) {
      if (stats.trades.length === 0) {
        bannerEl.classList.add('hidden');
        bannerEl.classList.remove('journal-ov-banner-clickable');
      } else if (stats.ruleBrokenDates.length === 0) {
        bannerEl.classList.remove('hidden');
        bannerEl.classList.remove('journal-ov-banner-warn');
        bannerEl.classList.remove('journal-ov-banner-clickable');
        bannerEl.innerText = `No rule breaks ${periodLabel} — every loss came from a clean setup, not a discipline slip. Keep this up.`;
      } else {
        bannerEl.classList.remove('hidden');
        bannerEl.classList.add('journal-ov-banner-warn');
        bannerEl.classList.add('journal-ov-banner-clickable');
        bannerEl.innerText = `${stats.ruleBrokenDates.length} of ${stats.dateKeys.length} day${stats.dateKeys.length === 1 ? '' : 's'} broke a rule ${periodLabel} — tap to see which rule and when.`;
      }
    }
  }

  // Banner only does something in its warn state (see renderOverview above);
  // in the praise/no-data states it has no onclick effect since the class
  // that makes it look clickable isn't applied. Opens the full Rule-broken
  // Days page (not the drawer) — same destination as the tile itself.
  function handleOverviewBannerClick() {
    if (!lastOverviewStats || lastOverviewStats.ruleBrokenDates.length === 0) return;
    openRuleBreaksPage();
  }

  // ---------- Overview drawer (click-to-details on any tile) ----------

  function overviewComplianceBadge(t) {
    const compliant = !t.ruleStatus || t.ruleStatus.compliant !== false;
    return compliant
      ? { text: 'Clean', cls: 'journal-ov-row-badge-clean' }
      : { text: 'Rule broken', cls: 'journal-ov-row-badge-broken' };
  }
  function overviewGradeBadge(t) {
    const entries = getEntries();
    const entry = entries[t.id];
    if (!entry) return { text: '—', cls: '', style: '' };
    const g = gradeFor(entryPtsFor(entry));
    return { text: g.letter, cls: '', style: `color:${g.fg}; background:${g.bg}; border:1px solid ${g.bd};` };
  }
  // The "which rule" the user asked for — ruleStatus.message is the
  // human-readable violation text (e.g. "Exceeded max trades/day"),
  // set by recordCompletedDay() in app-shell.js; falls back to .label,
  // then a generic string if a trade somehow has neither.
  function overviewRuleReason(t) {
    if (!t.ruleStatus || t.ruleStatus.compliant !== false) return null;
    return t.ruleStatus.message || t.ruleStatus.label || 'Rule broken — no details recorded';
  }

  function openOverviewDrawer(kind) {
    if (!lastOverviewStats) return;
    const stats = lastOverviewStats;
    const periodLabel = overviewPeriodLabel(jOverviewRange);
    let title = '';
    let rows = [];

    if (kind === 'wins') {
      title = `Wins · ${periodLabel}`;
      rows = stats.wins.map(t => ({ t, badge: overviewComplianceBadge(t) }));
    } else if (kind === 'losses') {
      title = `Losses · ${periodLabel}`;
      rows = stats.losses.map(t => ({ t, badge: overviewComplianceBadge(t) }));
    } else if (kind === 'clean') {
      title = `Clean days · ${periodLabel}`;
      rows = stats.cleanTrades.map(t => ({ t, badge: { text: 'Clean', cls: 'journal-ov-row-badge-clean' } }));
    } else if (kind === 'rule-broken') {
      title = `Rule-broken days · ${periodLabel}`;
      rows = stats.ruleBrokenTrades.map(t => ({ t, badge: { text: 'Rule broken', cls: 'journal-ov-row-badge-broken' } }));
    } else if (kind === 'largest-win') {
      title = `Largest win · ${periodLabel}`;
      rows = stats.largestWin ? [{ t: stats.largestWin, badge: overviewComplianceBadge(stats.largestWin) }] : [];
    } else if (kind === 'largest-loss') {
      title = `Largest loss · ${periodLabel}`;
      rows = stats.largestLoss ? [{ t: stats.largestLoss, badge: overviewComplianceBadge(stats.largestLoss) }] : [];
    } else if (kind === 'graded') {
      title = `Graded trades · ${periodLabel}`;
      rows = stats.journaledInRange.map(t => ({ t, badge: overviewGradeBadge(t) }));
    }

    const titleEl = document.getElementById('journal-ov-drawer-title');
    if (titleEl) titleEl.innerText = title;

    const bodyEl = document.getElementById('journal-ov-drawer-body');
    if (bodyEl) {
      if (rows.length === 0) {
        bodyEl.innerHTML = `<div class="journal-empty" style="margin:20px; background:#fff;"><div class="journal-empty-text">Nothing here yet for ${periodLabel}.</div></div>`;
      } else {
        bodyEl.innerHTML = rows.map(({ t, badge }) => {
          const isWin = t.netResult > 0;
          const resultColor = isWin ? 'var(--color-profit)' : (t.netResult < 0 ? '#C53D22' : '#5B6B82');
          const reason = overviewRuleReason(t);
          const reasonHtml = reason ? `<div class="journal-ov-row-reason">${reason}</div>` : '';
          return `
            <div class="journal-ov-row" onclick="openOverviewDrawerRow('${t.id}')">
              <div class="journal-ov-row-main">
                <div class="journal-ov-row-instrument">${t.instrument || '—'}</div>
                <div class="journal-ov-row-date">${formatDate(t.date)}</div>
                ${reasonHtml}
              </div>
              <div class="journal-ov-row-right">
                <div class="journal-ov-row-result" style="color:${resultColor};">${signedInr(t.netResult)}</div>
                <div class="journal-ov-row-badge ${badge.cls}" style="${badge.style || ''}">${badge.text}</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    const backdrop = document.getElementById('journal-ov-drawer-backdrop');
    const drawer = document.getElementById('journal-ov-drawer');
    if (backdrop) backdrop.classList.remove('hidden');
    if (drawer) {
      drawer.classList.remove('hidden');
      requestAnimationFrame(() => drawer.classList.add('journal-ov-drawer-open'));
    }
  }

  function closeOverviewDrawer() {
    const drawer = document.getElementById('journal-ov-drawer');
    const backdrop = document.getElementById('journal-ov-drawer-backdrop');
    if (drawer) drawer.classList.remove('journal-ov-drawer-open');
    setTimeout(() => {
      if (drawer) drawer.classList.add('hidden');
      if (backdrop) backdrop.classList.add('hidden');
    }, 220);
  }

  // Shared by every "jump to this trade's full details" entry point —
  // read-only journal view if it's already been journaled, otherwise the
  // entry form so it can be journaled right from here.
  function jumpToTradeDetail(tradeId) {
    const entries = getEntries();
    if (entries[tradeId]) {
      openJournalView(tradeId);
    } else {
      openJournalForm(tradeId);
    }
  }

  // A drawer row jumps straight to that trade's full details.
  function openOverviewDrawerRow(tradeId) {
    closeOverviewDrawer();
    jumpToTradeDetail(tradeId);
  }

  // ---------- Rule-broken Days (full page) ----------
  // Unlike the other Overview tiles (which open the slide-in drawer),
  // Rule-broken Days opens its own full page with an independent
  // Day/Week/Month range (jRbRange, defaults to Month) and shows the
  // journaled Mistakes/Emotion/checklist breakdown per trade alongside
  // the automated rule-break reason — the drawer's single-line "Rule
  // broken" badge wasn't enough context for this one.

  function openRuleBreaksPage() {
    setMode('rulebreaks');
    renderRuleBreaksPage();
  }

  function setRbRange(range) {
    jRbRange = range;
    renderRuleBreaksPage();
  }

  function checklistBreakdownHtml(checklist) {
    checklist = checklist || {};
    return Object.keys(CHECKLIST).map(cat => {
      const items = CHECKLIST[cat].map(item => {
        const pass = !!checklist[item.key];
        return `<span class="jrb-check-item ${pass ? 'jrb-check-pass' : 'jrb-check-fail'}">${pass ? '✓' : '✕'} ${item.label}</span>`;
      }).join('');
      return `
        <div class="jrb-checklist-cat">
          <div class="jrb-checklist-cat-label">${cat}</div>
          <div class="jrb-checklist-items">${items}</div>
        </div>
      `;
    }).join('');
  }

  function rbTradeCardHtml(t) {
    const entries = getEntries();
    const entry = entries[t.id];
    const reason = overviewRuleReason(t) || 'Rule broken — no details recorded';
    const isWin = t.netResult > 0;
    const resultColor = isWin ? 'var(--color-profit)' : (t.netResult < 0 ? '#C53D22' : '#5B6B82');

    const journalBlock = entry ? `
      <div class="jrb-journal-block">
        <div class="jrb-journal-row"><span class="jrb-journal-label">Mistakes</span><span class="jrb-journal-value">${entry.mistakes ? entry.mistakes : '—'}</span></div>
        <div class="jrb-journal-row"><span class="jrb-journal-label">Emotion</span><span class="jrb-journal-value">${entry.emotion ? entry.emotion : '—'}</span></div>
        <div class="jrb-checklist-grid">${checklistBreakdownHtml(entry.checklist)}</div>
      </div>
    ` : `
      <div class="jrb-not-journaled" onclick="openRbTradeDetail('${t.id}')">Not journaled yet — click to add mistakes &amp; notes</div>
    `;

    return `
      <div class="jrb-trade-card">
        <div class="jrb-trade-top">
          <div class="jrb-trade-instrument">${t.instrument || '—'}</div>
          <div class="jrb-trade-result" style="color:${resultColor};">${signedInr(t.netResult)}</div>
        </div>
        <div class="jrb-rule-reason">${reason}</div>
        ${journalBlock}
        <button type="button" class="jrb-view-link" onclick="openRbTradeDetail('${t.id}')">View full trade &rarr;</button>
      </div>
    `;
  }

  function renderRuleBreaksPage() {
    document.getElementById('jrb-day-btn').classList.toggle('broker-range-pill-active', jRbRange === 'day');
    document.getElementById('jrb-week-btn').classList.toggle('broker-range-pill-active', jRbRange === 'week');
    document.getElementById('jrb-month-btn').classList.toggle('broker-range-pill-active', jRbRange === 'month');

    const periodLabel = overviewPeriodLabel(jRbRange);
    const labelEl = document.getElementById('jrb-period-label');
    if (labelEl) labelEl.innerText = periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1);

    const bounds = overviewRangeBounds(jRbRange);
    const trades = tradesInBounds(bounds);
    const isCompliant = (t) => !t.ruleStatus || t.ruleStatus.compliant !== false;
    const broken = trades.filter(t => !isCompliant(t));

    const byDate = {};
    broken.forEach(t => { (byDate[t.date] = byDate[t.date] || []).push(t); });
    const dateKeys = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1));

    const bodyEl = document.getElementById('jrb-body');
    if (!bodyEl) return;
    if (dateKeys.length === 0) {
      bodyEl.innerHTML = `<div class="journal-empty" style="margin:8px 0;"><div class="journal-empty-text">No rule breaks ${periodLabel} — clean record.</div></div>`;
      return;
    }
    bodyEl.innerHTML = dateKeys.map(dk => `
      <div class="jrb-day-group">
        <div class="jrb-day-header">${formatDate(dk)}</div>
        ${byDate[dk].map(rbTradeCardHtml).join('')}
      </div>
    `).join('');
  }

  // Jumping from the rule-breaks page needs to come back to THIS page
  // (not the main list) once the trade's detail is closed.
  function openRbTradeDetail(tradeId) {
    jReturnMode = 'rulebreaks';
    jumpToTradeDetail(tradeId);
  }

  // ---------- Journal Entries (master-detail full page) ----------
  // The "I have to go back to see another entry" complaint about the old
  // inline saved-list: this page keeps a filterable, groupable list on
  // the left and the selected entry's full detail (entryDetailHtml) on
  // the right, so clicking a different row just re-renders the right
  // pane in place — no navigation, no back button needed. Its own
  // filter/group state (jed*) is deliberately separate from the inline
  // Journaled-entries tab's (activeInstrumentFilter etc.) so the two
  // don't stomp on each other.

  function openEntriesPage(tradeId) {
    if (tradeId) jEntriesSelectedId = tradeId;
    setMode('entries');
    renderEntriesPage();
  }

  function selectJedEntry(tradeId) {
    jEntriesSelectedId = tradeId;
    renderEntriesPage();
  }

  function setJedGroup(group) {
    jEntriesGroup = group;
    renderEntriesPage();
  }

  function onJedInstrumentFilterChange() {
    const el = document.getElementById('jed-instrument-filter');
    jedInstrumentFilter = el ? el.value : '';
    renderEntriesPage();
  }
  function onJedGradeFilterChange() {
    const el = document.getElementById('jed-grade-filter');
    jedGradeFilter = el ? el.value : '';
    renderEntriesPage();
  }
  function onJedDateFilterChange() {
    const fromEl = document.getElementById('jed-date-from');
    const toEl = document.getElementById('jed-date-to');
    jedDateFrom = fromEl ? fromEl.value : '';
    jedDateTo = toEl ? toEl.value : '';
    renderEntriesPage();
  }
  function clearJedFilters() {
    jedInstrumentFilter = ''; jedGradeFilter = ''; jedDateFrom = ''; jedDateTo = '';
    const instEl = document.getElementById('jed-instrument-filter'); if (instEl) instEl.value = '';
    const gradeEl = document.getElementById('jed-grade-filter'); if (gradeEl) gradeEl.value = '';
    const fromEl = document.getElementById('jed-date-from'); if (fromEl) fromEl.value = '';
    const toEl = document.getElementById('jed-date-to'); if (toEl) toEl.value = '';
    renderEntriesPage();
  }

  // Instrument options reflect every instrument ever traded (not just the
  // currently filtered set) — same convention as populateInstrumentFilter()
  // below for the inline tab.
  function populateJedInstrumentFilter() {
    const sel = document.getElementById('jed-instrument-filter');
    if (!sel) return;
    const current = jedInstrumentFilter;
    const instruments = Array.from(new Set(getHistory().map(t => t.instrument).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">All instruments</option>' +
      instruments.map(i => `<option value="${i}" ${i === current ? 'selected' : ''}>${i}</option>`).join('');
  }

  function jedKeyFor(d) {
    if (jEntriesGroup === 'day') return d.getFullYear() + '-d-' + d.getMonth() + '-' + d.getDate();
    if (jEntriesGroup === 'month') return d.getFullYear() + '-m-' + d.getMonth();
    if (jEntriesGroup === 'all') return 'all';
    const b = weekBounds(d);
    return b.s.getFullYear() + '-w-' + b.s.getMonth() + '-' + b.s.getDate();
  }
  function jedGroupTitle(d) {
    const now = new Date();
    if (jEntriesGroup === 'day') {
      return d.toDateString() === now.toDateString() ? 'Today' : formatDate(d.toISOString().slice(0, 10));
    }
    if (jEntriesGroup === 'month') {
      const sameMonth = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      return sameMonth ? 'This month' : d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    }
    if (jEntriesGroup === 'all') return 'All entries';
    const b = weekBounds(d);
    const thisB = weekBounds(now);
    return b.s.getTime() === thisB.s.getTime() ? 'This week' : 'Week of ' + fmtShort(b.s.toISOString().slice(0, 10));
  }

  function renderEntriesPage() {
    ['day', 'week', 'month', 'all'].forEach(g => {
      const btn = document.getElementById('jed-group-' + g + '-btn');
      if (btn) btn.classList.toggle('broker-range-pill-active', jEntriesGroup === g);
    });
    populateJedInstrumentFilter();

    const entries = getEntries();
    let journaled = getHistory().filter(t => entries[t.id]);
    if (jedInstrumentFilter) journaled = journaled.filter(t => t.instrument === jedInstrumentFilter);
    if (jedGradeFilter) journaled = journaled.filter(t => gradeFor(entryPtsFor(entries[t.id])).base === jedGradeFilter);
    if (jedDateFrom) journaled = journaled.filter(t => t.date >= jedDateFrom);
    if (jedDateTo) journaled = journaled.filter(t => t.date <= jedDateTo);
    journaled.sort((a, b) => (a.date < b.date ? 1 : -1));

    const countEl = document.getElementById('jed-count');
    if (countEl) countEl.innerText = `${journaled.length} ${journaled.length === 1 ? 'entry' : 'entries'}`;

    const listEl = document.getElementById('jed-list-body');
    if (journaled.length === 0) {
      jEntriesSelectedId = null;
      if (listEl) listEl.innerHTML = `<div class="journal-empty" style="background:#fff;"><div class="journal-empty-text">No entries match these filters.</div></div>`;
    } else {
      if (!jEntriesSelectedId || !journaled.some(t => t.id === jEntriesSelectedId)) {
        jEntriesSelectedId = journaled[0].id;
      }
      const groups = [];
      journaled.forEach(t => {
        const d = parseYmd(t.date);
        const k = jedKeyFor(d);
        let g = groups.find(x => x.k === k);
        if (!g) { g = { k, title: jedGroupTitle(d), items: [] }; groups.push(g); }
        g.items.push(t);
      });
      if (listEl) {
        listEl.innerHTML = groups.map(g => `
          <div class="jed-group-label">${g.title}</div>
          ${g.items.map(t => {
            const entry = entries[t.id];
            const pts = entryPtsFor(entry);
            const gr = gradeFor(pts);
            const isWin = t.netResult > 0;
            const resultColor = isWin ? 'var(--color-profit)' : (t.netResult < 0 ? '#C53D22' : '#5B6B82');
            const active = t.id === jEntriesSelectedId ? 'jed-row-active' : '';
            return `
              <div class="jed-row ${active}" onclick="selectJedEntry('${t.id}')">
                <div class="jed-row-badge" style="color:${gr.fg}; background:${gr.bg}; border:1px solid ${gr.bd};">${gr.letter}</div>
                <div class="jed-row-main">
                  <div class="jed-row-instrument">${entry.instrument || t.instrument || '—'}</div>
                  <div class="jed-row-date">${formatDate(t.date)}</div>
                </div>
                <div class="jed-row-result" style="color:${resultColor};">${signedInr(t.netResult)}</div>
              </div>
            `;
          }).join('')}
        `).join('');
      }
    }

    const detailEl = document.getElementById('jed-detail-body');
    if (detailEl) {
      detailEl.innerHTML = jEntriesSelectedId
        ? entryDetailHtml(jEntriesSelectedId)
        : `<div class="journal-empty" style="background:#fff;"><div class="journal-empty-text">Select an entry from the list to see its details.</div></div>`;
    }
  }

  // ---------- Missed Entries (full page) ----------
  // Trades with no journal entry yet, grouped by date, with its own
  // independent Day/Week/Month range (jMissedRange) — the "when did he
  // not journal" view. Visually mirrors the Rule-broken Days page
  // (reuses .jrb-day-group/.jrb-day-header/.jrb-trade-card).

  function openMissedEntriesPage() {
    setMode('missed');
    renderMissedPage();
  }

  function setMissedRange(range) {
    jMissedRange = range;
    renderMissedPage();
  }

  function missedTradeCardHtml(t) {
    const isWin = t.netResult > 0;
    const resultColor = isWin ? 'var(--color-profit)' : (t.netResult < 0 ? '#C53D22' : '#5B6B82');
    return `
      <div class="jrb-trade-card">
        <div class="jrb-trade-top">
          <div class="jrb-trade-instrument">${t.instrument || '—'}</div>
          <div class="jrb-trade-result" style="color:${resultColor};">${signedInr(t.netResult)}</div>
        </div>
        <button type="button" class="jmi-journal-btn" onclick="openMissedTradeDetail('${t.id}')">+ Add journal entry</button>
      </div>
    `;
  }

  function renderMissedPage() {
    document.getElementById('jmi-day-btn').classList.toggle('broker-range-pill-active', jMissedRange === 'day');
    document.getElementById('jmi-week-btn').classList.toggle('broker-range-pill-active', jMissedRange === 'week');
    document.getElementById('jmi-month-btn').classList.toggle('broker-range-pill-active', jMissedRange === 'month');

    const periodLabel = overviewPeriodLabel(jMissedRange);
    const labelEl = document.getElementById('jmi-period-label');
    if (labelEl) labelEl.innerText = periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1);

    const bounds = overviewRangeBounds(jMissedRange);
    const trades = tradesInBounds(bounds);
    const entries = getEntries();
    const missed = trades.filter(t => !entries[t.id]);

    const byDate = {};
    missed.forEach(t => { (byDate[t.date] = byDate[t.date] || []).push(t); });
    const dateKeys = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1));

    const bodyEl = document.getElementById('jmi-body');
    if (!bodyEl) return;
    if (dateKeys.length === 0) {
      bodyEl.innerHTML = `<div class="journal-empty" style="margin:8px 0;"><div class="journal-empty-text">Nothing missed ${periodLabel} — every trade has a journal entry.</div></div>`;
      return;
    }
    bodyEl.innerHTML = dateKeys.map(dk => `
      <div class="jrb-day-group">
        <div class="jrb-day-header">${formatDate(dk)}</div>
        ${byDate[dk].map(missedTradeCardHtml).join('')}
      </div>
    `).join('');
  }

  function openMissedTradeDetail(tradeId) {
    jReturnMode = 'missed';
    openJournalForm(tradeId);
  }

  // Keeps both tab badges in sync no matter which tab is currently open —
  // called from both renderTodo() and renderSaved() below.
  function updateTabBadges(scopedHistory, entries) {
    const todoCountEl = document.getElementById('journal-todo-count');
    const savedCountEl = document.getElementById('journal-saved-count');
    if (todoCountEl) todoCountEl.innerText = scopedHistory.filter(t => !entries[t.id]).length;
    if (savedCountEl) savedCountEl.innerText = scopedHistory.filter(t => entries[t.id]).length;
  }

  // ---------- Needs-journaling tab ----------
  function renderTodo() {
    const scopedHistory = rangeScopedHistory();
    const entries = getEntries();
    const todo = scopedHistory.filter(t => !entries[t.id]).slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.submittedAt || 0) < (b.submittedAt || 0) ? 1 : -1;
    });

    updateTabBadges(scopedHistory, entries);

    const rowsEl = document.getElementById('journal-todo-rows');
    if (!rowsEl) return;

    if (todo.length === 0) {
      const rangeNote = jRange === 'all' ? '' : ' in this period — switch to "All Time" above to see the full backlog.';
      rowsEl.innerHTML = `
        <div class="journal-empty" style="grid-column:1/-1;">
          <div class="journal-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#15803D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
          <div class="journal-empty-text">All caught up — every trade has been journaled${rangeNote}. New trades from the Daily Limits Tool will appear here.</div>
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

    const scopedHistory = rangeScopedHistory();
    populateInstrumentFilter(getHistory()); // filter options reflect every instrument ever traded, not just this range
    const entries = getEntries();

    updateTabBadges(scopedHistory, entries);

    let journaled = scopedHistory.filter(t => entries[t.id]);
    if (activeInstrumentFilter) journaled = journaled.filter(t => t.instrument === activeInstrumentFilter);
    if (activeGradeFilter) journaled = journaled.filter(t => gradeFor(entryPtsFor(entries[t.id])).base === activeGradeFilter);
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
      const pts = entryPtsFor(entry);
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
          <div class="journal-entry-card" onclick="openEntriesPage('${t.id}')">
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
    renderOverview();
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

  function rawChecklistScore() {
    const inputs = document.querySelectorAll('#journal-checklist-area input[type="checkbox"]');
    let score = 0;
    inputs.forEach(input => { if (input.checked) score += parseInt(input.dataset.weight, 10); });
    return score;
  }

  // Form score = checklist points minus the behavior-flag penalty from
  // section 4 — the same formula entryPtsFor() applies to saved entries.
  function computeFormScore() {
    return Math.max(0, rawChecklistScore() - flagPenaltyFor(jfBehaviorFlags));
  }

  function updateLiveGrade() {
    const raw = rawChecklistScore();
    const penalty = flagPenaltyFor(jfBehaviorFlags);
    const score = Math.max(0, raw - penalty);
    const flagCount = jfBehaviorFlags.filter(k => k !== 'no-mistakes').length;
    const g = gradeFor(score);
    const gradeEl = document.getElementById('journal-live-grade');
    const ptsEl = document.getElementById('journal-live-pts');
    const barEl = document.getElementById('journal-live-bar');
    if (gradeEl) {
      gradeEl.innerText = g.letter;
      gradeEl.style.color = g.fg; gradeEl.style.background = g.bg; gradeEl.style.borderColor = g.bd; gradeEl.style.border = `1px solid ${g.bd}`;
    }
    if (ptsEl) {
      ptsEl.innerHTML = penalty > 0
        ? `${score} / ${TOTAL_OBTAINABLE} points <span style="color:#C53D22; font-weight:600;">(${raw} checklist − ${penalty} from ${flagCount} behavior flag${flagCount === 1 ? '' : 's'})</span>`
        : `${score} / ${TOTAL_OBTAINABLE} points`;
    }
    if (barEl) { barEl.style.width = Math.round((score / TOTAL_OBTAINABLE) * 100) + '%'; barEl.style.background = g.fg; }
  }

  function setJfDirection(dir) {
    jfDirection = dir;
    document.getElementById('jf-dir-long').classList.toggle('active', dir === 'long');
    document.getElementById('jf-dir-short').classList.toggle('active', dir === 'short');
  }

  // ---------- Entry form wizard ----------
  // The entry form is a 5-step wizard (Trade details → Execution → Logic →
  // Psychology → Review score) — one section visible at a time, driven by
  // the stepper. Steps already visited (or all of them, when editing a
  // saved entry) are clickable in the stepper for direct jumps.
  const JOURNAL_STEP_COUNT = 5;
  let journalStep = 1;
  let journalMaxStepVisited = 1;

  function setJournalStep(n) {
    journalStep = Math.min(Math.max(1, n), JOURNAL_STEP_COUNT);
    journalMaxStepVisited = Math.max(journalMaxStepVisited, journalStep);

    for (let i = 1; i <= JOURNAL_STEP_COUNT; i++) {
      const sec = document.getElementById(`jstep-sec-${i}`);
      if (sec) sec.classList.toggle('hidden', i !== journalStep);
    }

    document.querySelectorAll('#journal-stepper .jstep-node').forEach(node => {
      const s = parseInt(node.dataset.step, 10);
      node.classList.toggle('active', s === journalStep);
      node.classList.toggle('done', s < journalStep);
      node.classList.toggle('reachable', s <= journalMaxStepVisited && s !== journalStep);
      const circ = node.querySelector('.jstep-circle');
      if (circ) circ.innerText = s < journalStep ? '✓' : String(s);
    });
    document.querySelectorAll('#journal-stepper .jstep-line').forEach(line => {
      line.classList.toggle('filled', parseInt(line.dataset.line, 10) < journalStep);
    });

    const backBtn = document.getElementById('journal-wizard-back-btn');
    const nextBtn = document.getElementById('journal-wizard-next-btn');
    if (backBtn) backBtn.innerText = journalStep === 1 ? 'Cancel' : 'Back';
    if (nextBtn) nextBtn.innerText = journalStep === JOURNAL_STEP_COUNT ? 'Save journal entry' : 'Continue';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function journalWizardNext() {
    if (journalStep < JOURNAL_STEP_COUNT) setJournalStep(journalStep + 1);
    else saveCurrentJournalEntry();
  }

  function journalWizardBack() {
    if (journalStep === 1) jBackToList();
    else setJournalStep(journalStep - 1);
  }

  function goToJournalStep(n) {
    if (n <= journalMaxStepVisited) setJournalStep(n);
  }

  // ---------- Trade behavior flags ----------
  // Multi-select chips in the Psychology & reflection section. "No mistakes"
  // is exclusive: picking it clears every other flag, and picking any other
  // flag clears it — a trade can't have both "no mistakes" and a mistake.
  const BEHAVIOR_FLAGS = [
    { key: 'overtrading',      label: 'Overtrading' },
    { key: 'risked-too-much',  label: 'Risked too much' },
    { key: 'exited-too-late',  label: 'Exited too late' },
    { key: 'ignored-signals',  label: 'Ignored signals' },
    { key: 'ignored-stop-loss',label: 'Ignored stop loss' },
    { key: 'greed',            label: 'Greed' },
    { key: 'revenge-trading',  label: 'Revenge trading' },
    { key: 'exited-too-early', label: 'Exited too early' },
    { key: 'fomo-entry',       label: 'FOMO entry' },
    { key: 'no-clear-plan',    label: 'No clear plan' },
    { key: 'no-mistakes',      label: 'No mistakes' },
  ];
  const NO_MISTAKES_KEY = 'no-mistakes';
  let jfBehaviorFlags = [];

  function behaviorFlagLabel(key) {
    const f = BEHAVIOR_FLAGS.find(f => f.key === key);
    return f ? f.label : key;
  }

  function renderBehaviorFlags() {
    const wrap = document.getElementById('jf-behavior-flags');
    if (!wrap) return;
    wrap.innerHTML = BEHAVIOR_FLAGS.map(f => {
      const active = jfBehaviorFlags.includes(f.key);
      return `<button type="button" class="journal-flag-chip${active ? ' active' : ''}"
        onclick="toggleBehaviorFlag('${f.key}')"
        aria-pressed="${active}">${f.label}</button>`;
    }).join('');
  }

  function toggleBehaviorFlag(key) {
    if (jfBehaviorFlags.includes(key)) {
      jfBehaviorFlags = jfBehaviorFlags.filter(k => k !== key);
    } else if (key === NO_MISTAKES_KEY) {
      jfBehaviorFlags = [NO_MISTAKES_KEY];
    } else {
      jfBehaviorFlags = jfBehaviorFlags.filter(k => k !== NO_MISTAKES_KEY);
      jfBehaviorFlags.push(key);
    }
    renderBehaviorFlags();
    updateLiveGrade(); // flags feed the discipline score
  }

  function setBehaviorFlags(flags) {
    jfBehaviorFlags = Array.isArray(flags) ? flags.slice() : [];
    renderBehaviorFlags();
    updateLiveGrade();
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
    setBehaviorFlags(existing ? (existing.behaviorFlags || []) : []);
    document.getElementById('jf-mistakes').value = existing ? (existing.mistakes || '') : '';

    renderChecklist(existing ? existing.checklist : {});
    setScreenshot(existing ? (existing.screenshot || null) : null);

    document.getElementById('journal-delete-btn').classList.toggle('hidden', !existing);
    const statusEl = document.getElementById('journal-save-status');
    if (statusEl) statusEl.innerText = existing ? 'Editing a saved entry — changes overwrite it on save.' : '';

    // Fresh entries walk the wizard from step 1; editing a saved entry
    // unlocks every step for direct stepper jumps.
    journalMaxStepVisited = existing ? JOURNAL_STEP_COUNT : 1;
    setJournalStep(1);

    setMode('entry');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- View mode ----------
  // Shared by the standalone view mode AND the master-detail Entries
  // page's right-hand pane — one HTML-string template instead of two
  // copies of the same markup drifting apart. Returns a full innerHTML
  // string (grade header through the review breakdown, plus the Edit
  // button), not tied to any fixed set of element ids, so it can be
  // dropped into either container.
  function entryDetailHtml(tradeId) {
    const trade = getHistory().find(t => t.id === tradeId);
    const entry = getEntries()[tradeId];
    if (!trade || !entry) {
      return `<div class="journal-empty" style="background:#fff;"><div class="journal-empty-text">Entry not found.</div></div>`;
    }

    const pts = entryPtsFor(entry);
    const g = gradeFor(pts);
    const isWin = trade.netResult > 0;
    const resultColor = isWin ? 'var(--color-profit)' : (trade.netResult < 0 ? '#C53D22' : '#5B6B82');
    const dirLabel = entry.direction === 'short' ? 'Short' : (entry.direction === 'long' ? 'Long' : '');
    const dirColor = entry.direction === 'short' ? '#C53D22' : 'var(--color-profit)';
    const barW = Math.round((pts / TOTAL_OBTAINABLE) * 100) + '%';

    const shotHtml = entry.screenshot ? `
      <div class="journal-section">
        <div class="journal-hero-eyebrow" style="margin-bottom:10px;">Setup screenshot</div>
        <img class="journal-view-screenshot" src="${entry.screenshot}" alt="Setup screenshot">
      </div>
    ` : '';

    const checked = entry.checklist || {};
    const breakdownHtml = Object.keys(CHECKLIST).map(category => {
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

    return `
      <div class="journal-view-header">
        <div class="journal-view-grade" style="color:${g.fg}; background:${g.bg}; border:1px solid ${g.bd};">${g.letter}</div>
        <div class="journal-view-main">
          <div class="journal-view-title-row">
            <span class="journal-view-instrument">${entry.instrument || trade.instrument || '—'}</span>
            ${dirLabel ? `<span class="journal-view-dir" style="color:${dirColor};">${dirLabel}</span>` : ''}
          </div>
          <div class="journal-view-date">${formatDate(trade.date)}</div>
          <div class="journal-view-bar-track"><div class="journal-view-bar-fill" style="width:${barW}; background:${g.fg};"></div></div>
          <div class="journal-view-pts">${pts} / ${TOTAL_OBTAINABLE} points${flagPenaltyFor(entry.behaviorFlags) > 0 ? ` <span style="color:#C53D22;">(−${flagPenaltyFor(entry.behaviorFlags)} from behavior flags)</span>` : ''}</div>
        </div>
        <div class="journal-view-result-col">
          <div class="journal-view-result-label">Result</div>
          <div class="journal-view-result" style="color:${resultColor};">${signedInr(trade.netResult)}</div>
        </div>
      </div>

      <div class="journal-section">
        <div class="journal-hero-eyebrow" style="margin-bottom:14px;">Execution</div>
        <div class="journal-view-execution-grid">
          <div class="journal-view-stat"><div class="journal-view-stat-label">Entry</div><div class="journal-view-stat-value">${entry.entryPrice || '—'}</div></div>
          <div class="journal-view-stat"><div class="journal-view-stat-label">Exit</div><div class="journal-view-stat-value">${entry.exitPrice || '—'}</div></div>
          <div class="journal-view-stat"><div class="journal-view-stat-label">Stop loss</div><div class="journal-view-stat-value">${entry.stopLoss || '—'}</div></div>
          <div class="journal-view-stat"><div class="journal-view-stat-label">Target</div><div class="journal-view-stat-value">${entry.target || '—'}</div></div>
          <div class="journal-view-stat"><div class="journal-view-stat-label">Risk : reward</div><div class="journal-view-stat-value">${entry.rrRatio || '—'}</div></div>
        </div>
      </div>

      <div class="journal-view-two-col">
        <div class="journal-section" style="margin-bottom:0;">
          <div class="journal-hero-eyebrow" style="margin-bottom:14px;">Logic</div>
          <div class="journal-view-card-label">Setup / entry reason</div>
          <p class="journal-view-card-text">${entry.setupReason || '—'}</p>
          <div class="journal-view-card-label">Market conditions</div>
          <p class="journal-view-card-text">${entry.marketConditions || '—'}</p>
        </div>
        <div class="journal-section" style="margin-bottom:0;">
          <div class="journal-hero-eyebrow" style="margin-bottom:14px;">Psychology &amp; reflection</div>
          <div class="journal-view-card-label">Emotion during the trade</div>
          <p class="journal-view-card-text">${entry.emotion || '—'}</p>
          <div class="journal-view-card-label">Trade behavior flags</div>
          ${(entry.behaviorFlags && entry.behaviorFlags.length)
            ? `<div class="journal-flag-row journal-flag-row-view">${entry.behaviorFlags.map(k =>
                `<span class="journal-flag-chip active static">${behaviorFlagLabel(k)}</span>`).join('')}</div>`
            : `<p class="journal-view-card-text">—</p>`}
          <div class="journal-view-card-label">Mistakes / what you'd do differently</div>
          <p class="journal-view-card-text">${entry.mistakes || '—'}</p>
        </div>
      </div>

      ${shotHtml}

      <div class="journal-section">
        <div class="journal-hero-eyebrow" style="margin-bottom:16px;">Trade review breakdown</div>
        <div>${breakdownHtml}</div>
        ${flagPenaltyFor(entry.behaviorFlags) > 0 ? `
          <div class="journal-view-flag-penalty">
            Behavior flags penalty: <b>−${flagPenaltyFor(entry.behaviorFlags)} points</b>
            (${entry.behaviorFlags.filter(k => k !== 'no-mistakes').length} flag${entry.behaviorFlags.filter(k => k !== 'no-mistakes').length === 1 ? '' : 's'} × −${FLAG_PENALTY} each — see Psychology &amp; reflection above)
          </div>` : ''}
      </div>

      <div style="display:flex; justify-content:flex-end; margin-bottom:4px;">
        <button type="button" class="journal-cancel-btn" onclick="editCurrentJournalEntry('${tradeId}')">Edit this entry</button>
      </div>
    `;
  }

  function openJournalView(tradeId) {
    viewTradeId = tradeId;
    const contentEl = document.getElementById('journal-view-content');
    if (contentEl) contentEl.innerHTML = entryDetailHtml(tradeId);
    setMode('view');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Called both from the standalone view mode's own Edit button and from
  // the Edit button baked into entryDetailHtml() (used by the Entries
  // page's embedded detail pane) — tradeId is passed explicitly so it
  // works from either context. jReturnMode is only overridden here when
  // we're editing directly from within the embedded Entries page (jMode
  // still 'entries' at click time, since that pane never navigates away
  // to show the detail); otherwise whatever jReturnMode already holds
  // (set by openRbTradeDetail / openMissedTradeDetail, or left at the
  // 'list' default) is preserved so Back still lands in the right place.
  function editCurrentJournalEntry(tradeId) {
    const id = tradeId || viewTradeId;
    if (!id) return;
    viewTradeId = id;
    if (jMode === 'entries') jReturnMode = 'entries';
    openJournalForm(id);
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
      behaviorFlags: jfBehaviorFlags.slice(),
      mistakes: document.getElementById('jf-mistakes').value.trim(),
      checklist: checklistState,
      score: score,
      grade: g.letter,
      screenshot: screenshotDataUrl,
    };

    if (typeof window.saveJournalEntry === 'function') {
      window.saveJournalEntry(activeTradeId, entryData);
    }

    returnFromForm({ tab: 'saved' });
  }

  function confirmDeleteJournalEntry() {
    if (!activeTradeId) return;
    const ok = window.confirm('Delete this journal entry? This cannot be undone, and the underlying trade will stay in your history as "Not journaled".');
    if (!ok) return;
    if (typeof window.deleteJournalEntry === 'function') window.deleteJournalEntry(activeTradeId);
    returnFromForm({ deleted: true });
  }

  // Expose handlers for inline onclick/onchange attributes
  window.jBackToList = jBackToList;
  window.setJournalRange = setJournalRange;
  window.setOverviewRange = setOverviewRange;
  window.openOverviewDrawer = openOverviewDrawer;
  window.closeOverviewDrawer = closeOverviewDrawer;
  window.openOverviewDrawerRow = openOverviewDrawerRow;
  window.handleOverviewBannerClick = handleOverviewBannerClick;
  window.openRuleBreaksPage = openRuleBreaksPage;
  window.setRbRange = setRbRange;
  window.openRbTradeDetail = openRbTradeDetail;
  window.openEntriesPage = openEntriesPage;
  window.selectJedEntry = selectJedEntry;
  window.setJedGroup = setJedGroup;
  window.onJedInstrumentFilterChange = onJedInstrumentFilterChange;
  window.onJedGradeFilterChange = onJedGradeFilterChange;
  window.onJedDateFilterChange = onJedDateFilterChange;
  window.clearJedFilters = clearJedFilters;
  window.openMissedEntriesPage = openMissedEntriesPage;
  window.setMissedRange = setMissedRange;
  window.openMissedTradeDetail = openMissedTradeDetail;
  window.setJournalTab = setJournalTab;
  window.setJournalGroup = setJournalGroup;
  window.openJournalForm = openJournalForm;
  window.openJournalView = openJournalView;
  window.editCurrentJournalEntry = editCurrentJournalEntry;
  window.setJfDirection = setJfDirection;
  window.toggleBehaviorFlag = toggleBehaviorFlag;
  window.journalWizardNext = journalWizardNext;
  window.journalWizardBack = journalWizardBack;
  window.goToJournalStep = goToJournalStep;
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