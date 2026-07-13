/* ===========================================================
   COMPONENT: dashboard-home (logic)
   Loaded lazily by app-shell.js the first time the Dashboard tab opens.

   Shows 4 key stat cards (Balance, Win Rate, Total Trades, Net P&L),
   quick-link shortcuts to the other sections, and a short recent-activity
   list pulled from the same trade history used everywhere else.
   =========================================================== */

(function () {
  // fmt() now shared — see /src/app/shared/utils/formatters.js

  function formatDateShort(isoDateString) {
    const d = new Date(isoDateString);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function getState() {
    return typeof window.getProfileState === "function"
      ? window.getProfileState()
      : {};
  }

  function getHistory() {
    return typeof window.getTradeHistory === "function"
      ? window.getTradeHistory()
      : [];
  }

  // ---------- Mini graphics for the 4 top stat cards ----------
  // All 4 are driven by the same real trade history/profile state the
  // cards' own numbers come from — nothing here is decorative placeholder
  // data. Each degrades to a clear "no data yet" look (flat line / empty
  // gray arc / empty bar / neutral dash icon) rather than faking a trend
  // before there's anything to show one.

  // Starting capital -> running balance after each trade, in
  // chronological order (same date + submittedAt sort convention used by
  // calculators.js's Withdraw & Scale tab).
  function buildBalanceTrail(history, startingCapital) {
    const sorted = history.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.submittedAt || 0) - (b.submittedAt || 0);
    });
    const base = typeof startingCapital === "number" && !isNaN(startingCapital) ? startingCapital : 0;
    const points = [base];
    sorted.forEach((t) => points.push(points[points.length - 1] + (t.netResult || 0)));
    return points;
  }

  function sparklinePath(pointsIn, width, height, pad) {
    let points = pointsIn;
    if (!points || points.length === 0) return "";
    if (points.length === 1) points = [points[0], points[0]];
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const stepX = (width - pad * 2) / (points.length - 1);
    return points
      .map((v, i) => {
        const x = pad + i * stepX;
        const y = pad + (height - pad * 2) * (1 - (v - min) / range);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  function balanceSparkSvg(history, startingCapital) {
    const W = 64, H = 24, PAD = 2.5;
    const trail = buildBalanceTrail(history, startingCapital);
    const d = sparklinePath(trail, W, H, PAD);
    return `<svg class="dash-stat-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path d="${d}" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  // Semi-circle gauge — background arc always full/gray, foreground arc's
  // dash-length is the exact fraction of the arc's true length (pi*r,
  // since both radii equal r and it sweeps exactly 180deg), so 0 win
  // rate (or no trades yet) renders as a plain empty gray arc.
  function winRateGaugeSvg(winRate) {
    const R = 24, CX = 30, CY = 30;
    const ARC_LEN = Math.PI * R;
    const pct = winRate === null ? 0 : Math.max(0, Math.min(100, winRate));
    const filled = (pct / 100) * ARC_LEN;
    const d = `M${CX - R},${CY} A${R},${R} 0 0 1 ${CX + R},${CY}`;
    return `<svg class="dash-stat-gauge" viewBox="0 0 60 32">
      <path class="dash-stat-gauge-bg" d="${d}"/>
      <path class="dash-stat-gauge-fill" d="${d}" stroke-dasharray="${filled.toFixed(1)} ${ARC_LEN.toFixed(1)}"/>
    </svg>`;
  }

  function netPnlTrendIcon(netPnl, hasTrades) {
    if (!hasTrades || netPnl === 0) {
      return `<span class="dash-stat-trend-icon dash-stat-trend-neutral"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg></span>`;
    }
    if (netPnl > 0) {
      return `<span class="dash-stat-trend-icon dash-stat-trend-up"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg></span>`;
    }
    return `<span class="dash-stat-trend-icon dash-stat-trend-down"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>`;
  }

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function renderStatCards() {
    const grid = document.getElementById("dash-stat-grid");
    if (!grid) return;

    const state = getState();
    const history = getHistory();

    const balance = state.currentBalance;
    const totalTrades = history.length;
    const wins = history.filter((t) => t.netResult > 0).length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : null;
    const netPnl = history.reduce((sum, t) => sum + t.netResult, 0);

    const netPnlClass =
      netPnl > 0
        ? "dash-stat-positive"
        : netPnl < 0
          ? "dash-stat-negative"
          : "";
    const netPnlSign = netPnl > 0 ? "+" : netPnl < 0 ? "-" : "";

    // Real "trades logged today" out of the app's own 2-trades/day cap
    // (same cap the Daily Limits Tool enforces) — a meaningful fill
    // amount, not an arbitrary decorative one.
    const tradesToday = history.filter((t) => t.date === todayIso()).length;
    const tradesTodayPct = Math.max(0, Math.min(100, (tradesToday / 2) * 100));

    grid.innerHTML = `
      <div class="dash-stat-card">
        <div class="dash-stat-card-top">
          <div class="dash-stat-label">Current Balance</div>
          ${balanceSparkSvg(history, state.startingCapital)}
        </div>
        <div class="dash-stat-value">${balance !== null && balance !== undefined ? "₹" + fmt(balance) : "&mdash;"}</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-card-top">
          <div class="dash-stat-label">Win Rate</div>
          ${winRateGaugeSvg(winRate)}
        </div>
        <div class="dash-stat-value">${winRate !== null ? winRate.toFixed(0) + "%" : "&mdash;"}</div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-label">Total Trades</div>
        <div class="dash-stat-value">${totalTrades}</div>
        <div class="dash-stat-progress-track"><div class="dash-stat-progress-fill" style="width:${tradesTodayPct}%"></div></div>
      </div>
      <div class="dash-stat-card">
        <div class="dash-stat-card-top">
          <div class="dash-stat-label">Net P&amp;L</div>
          ${netPnlTrendIcon(netPnl, totalTrades > 0)}
        </div>
        <div class="dash-stat-value ${netPnlClass}">${totalTrades > 0 ? netPnlSign + "₹" + fmt(Math.abs(netPnl)) : "&mdash;"}</div>
      </div>
    `;
  }

  // Risk-rules-at-a-glance: pulls from window.getRiskSummary() in
  // app-shell.js, which is computed from the SAME tierRulesMatrix the Daily
  // Limits Tool enforces — never a separate, possibly-drifting set of
  // numbers. Hidden entirely if no profile/tier exists yet (shouldn't
  // normally happen since the Dashboard is only reachable after setup, but
  // safe regardless).
  function renderRiskRules() {
    const wrap = document.getElementById("dash-risk-wrap");
    const grid = document.getElementById("dash-risk-grid");
    const lotNote = document.getElementById("dash-risk-lot-note");
    if (!wrap || !grid) return;

    const summary =
      typeof window.getRiskSummary === "function"
        ? window.getRiskSummary()
        : null;
    if (!summary || summary.maxLossRupees === null) {
      wrap.classList.add("hidden");
      return;
    }
    wrap.classList.remove("hidden");

    grid.innerHTML = `
      <div class="dash-risk-card dash-risk-card-tier">
        <div class="dash-risk-label">Capital Tier</div>
        <div class="dash-risk-value">${summary.tierLabel}</div>
      </div>
      <div class="dash-risk-card dash-risk-card-loss">
        <div class="dash-risk-label">Max Loss Today</div>
        <div class="dash-risk-value">₹${fmt(summary.maxLossRupees)}</div>
        <div class="dash-risk-sublabel">${summary.maxLossPct}% of capital</div>
      </div>
      <div class="dash-risk-card dash-risk-card-lots">
        <div class="dash-risk-label">Lots Allowed Right Now</div>
        <div class="dash-risk-value">${summary.maxLots}</div>
      </div>
      <div class="dash-risk-card dash-risk-card-trades">
        <div class="dash-risk-label">Max Trades / Day</div>
        <div class="dash-risk-value">2</div>
      </div>
    `;

    if (lotNote) {
      const progressRow = document.getElementById("dash-lot-progress-row");
      const progressFill = document.getElementById("dash-lot-progress-fill");
      if (summary.nextLotUnlock) {
        lotNote.innerHTML = `Reach ₹<strong>${fmt(summary.nextLotUnlock.requiredBalance)}</strong> to unlock ${summary.nextLotUnlock.nextLotCount} lots &mdash; ₹${fmt(summary.nextLotUnlock.remaining)} to go`;
        if (progressRow && progressFill) {
          const profile =
            typeof window.getProfileState === "function"
              ? window.getProfileState()
              : null;
          const currentBalance = profile ? profile.currentBalance : null;
          const requiredBalance = summary.nextLotUnlock.requiredBalance;
          let pct = 0;
          if (currentBalance !== null && requiredBalance > 0) {
            pct = Math.max(
              0,
              Math.min(100, (currentBalance / requiredBalance) * 100),
            );
          }
          progressFill.style.width = `${pct}%`;
          progressRow.classList.remove("hidden");
        }
      } else {
        lotNote.innerText = `${summary.maxLots} lots is the highest currently configured for your account size.`;
        if (progressRow) progressRow.classList.add("hidden");
      }
    }
  }

  function renderRecentActivity() {
    const container = document.getElementById("dash-recent-area");
    if (!container) return;

    const history = getHistory();

    if (!history || history.length === 0) {
      container.innerHTML = `
        <div class="dash-recent-empty-state">
          <div class="dash-recent-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>
          </div>
          <p class="dash-recent-empty-text">No trades logged yet. Head to the
            <a href="#" class="dash-recent-empty-link" onclick="switchTab(null, 'tab-calculator'); return false;">Daily Limits Tool</a>
            to log your first trade.
          </p>
        </div>
      `;
      return;
    }

    // Sort by date (newest first), preserving submission order within a
    // date — same fix as the Daily Limits Tool's Trade Log, since raw
    // insertion order can diverge from date order once broker days get
    // imported out of chronological sequence.
    const rows = history
      .slice()
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (a.submittedAt || 0) < (b.submittedAt || 0) ? 1 : -1;
      })
      .slice(0, 5);

    let html = '<div class="calc-history-grid">';
    html += `
      <div class="calc-history-cell calc-history-head">Date</div>
      <div class="calc-history-cell calc-history-head num">Net Result</div>
      <div class="calc-history-cell calc-history-head num">Balance After</div>
    `;
    rows.forEach((entry) => {
      const isWin = entry.netResult > 0;
      const sign = isWin ? "+" : entry.netResult < 0 ? "-" : "";
      const resultClass = isWin
        ? "calc-history-win"
        : entry.netResult < 0
          ? "calc-history-loss"
          : "";
      html += `
        <div class="calc-history-cell">${formatDateShort(entry.date)}</div>
        <div class="calc-history-cell num ${resultClass}">${sign}₹${fmt(Math.abs(entry.netResult))}</div>
        <div class="calc-history-cell num ${resultClass}">₹${fmt(entry.balanceAfter)}</div>
      `;
    });
    html += "</div>";

    container.innerHTML = html;
  }

  /* =========================================================
     WEEKLY / MONTHLY DISCIPLINED REVIEW — "Discipline Features"
     handoff, Feature 2. An auto-generated behavioural review, built
     from the SAME tradeHistory this dashboard already reads (with its
     real per-trade ruleStatus set by the Daily Limits Tool / broker
     import — see recordCompletedDay()/updateTradeRuleStatus() in
     app-shell.js) — no separate/duplicated data source, no fabricated
     numbers. Judges rule adherence, not P&L, per the product's core
     thesis; P&L is shown for context only.
     ========================================================= */

  let reviewMode = 'weekly';   // 'weekly' | 'monthly'
  let weekSel = 0;             // selected index into the computed weeks[] (0 = most recent)
  let monthSel = 0;            // selected index into the computed months[] (0 = most recent)
  let periodPickerOpen = false;

  function parseIsoDate(dateStr) {
    const parts = dateStr.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function toIsoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDays(d, n) {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + n);
    return copy;
  }

  // Monday-start ISO week.
  function mondayOf(d) {
    const day = d.getDay(); // 0 Sun .. 6 Sat
    const diff = day === 0 ? -6 : 1 - day;
    return addDays(d, diff);
  }

  function formatWeekRange(start, end) {
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    const year = end.getFullYear();
    if (sameMonth) {
      const monthLabel = end.toLocaleDateString('en-IN', { month: 'short' });
      return `${start.getDate()}–${end.getDate()} ${monthLabel} ${year}`;
    }
    const startLabel = start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const endLabel = end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return `${startLabel} – ${endLabel} ${year}`;
  }

  // Builds one period's full stats/tone record from the trade entries
  // that fall inside [startIso, endIso] (inclusive). "Rules respected"
  // is measured per TRADING DAY (a day with >=1 logged trade), not per
  // trade — a day only counts as respected if every trade logged that
  // day had ruleStatus.compliant !== false.
  function buildPeriodRecord(startIso, endIso, rangeLabel, tag, allHistory) {
    const entries = allHistory.filter(e => e.date >= startIso && e.date <= endIso);
    const trades = entries.length;
    const wins = entries.filter(e => e.netResult > 0).length;
    const winRate = trades > 0 ? Math.round((wins / trades) * 100) : null;
    const netPnl = entries.reduce((sum, e) => sum + e.netResult, 0);

    const byDate = {};
    entries.forEach(e => {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e);
    });
    const sessionDates = Object.keys(byDate).sort();
    const sessionDays = sessionDates.length;

    let compliantDays = 0;
    const violations = [];
    sessionDates.forEach(date => {
      const dayEntries = byDate[date];
      const dayCompliant = dayEntries.every(e => !e.ruleStatus || e.ruleStatus.compliant !== false);
      if (dayCompliant) compliantDays++;
      dayEntries.forEach(e => {
        if (e.ruleStatus && e.ruleStatus.compliant === false) {
          violations.push({ label: e.ruleStatus.label, message: e.ruleStatus.message, date });
        }
      });
    });

    let tone;
    if (sessionDays === 0) tone = 'neutral';
    else if (violations.length > 0) tone = 'bad';
    else tone = 'good';

    return {
      startIso, endIso, rangeLabel, tag, entries, sessionDates,
      trades, wins, winRate, netPnl, sessionDays, compliantDays, violations, tone,
    };
  }

  // Every week that actually has trade data, plus the current week even
  // if empty (so there's always at least a "This week" row) — newest
  // first, capped at 12 so the period picker never grows unbounded.
  function computeWeeks(history) {
    const today = new Date();
    const weekStartTimes = new Set([mondayOf(today).getTime()]);
    history.forEach(e => weekStartTimes.add(mondayOf(parseIsoDate(e.date)).getTime()));

    const sorted = Array.from(weekStartTimes).sort((a, b) => b - a).slice(0, 12);
    return sorted.map((ts, idx) => {
      const start = new Date(ts);
      const end = addDays(start, 6);
      const startIso = toIsoDate(start);
      const endIso = toIsoDate(end);
      const tag = idx === 0 ? 'This week' : idx === 1 ? 'Last week' : `${idx} weeks ago`;
      return buildPeriodRecord(startIso, endIso, formatWeekRange(start, end), tag, history);
    });
  }

  function computeMonths(history) {
    const today = new Date();
    const monthKeys = new Set([`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`]);
    history.forEach(e => {
      const d = parseIsoDate(e.date);
      monthKeys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });

    const sorted = Array.from(monthKeys).sort((a, b) => b.localeCompare(a)).slice(0, 12);
    return sorted.map((key, idx) => {
      const [y, m] = key.split('-').map(Number);
      const startIso = `${key}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const endIso = `${key}-${String(lastDay).padStart(2, '0')}`;
      const tag = idx === 0 ? 'This month' : idx === 1 ? 'Last month' : `${idx} months ago`;
      const label = new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      return buildPeriodRecord(startIso, endIso, label, tag, history);
    });
  }

  // Turns one period's numbers into plain-language headline/sub/insights
  // — every line here is derived from real computed facts on the record
  // (violation labels + their own coaching message already written in
  // daily-limits.js's evaluateBrokerTradeCompliance(), win/loss sequencing),
  // not canned copy.
  function buildNarrative(record, periodWord) {
    const { sessionDays, compliantDays, violations, trades, entries, sessionDates } = record;

    if (sessionDays === 0) {
      return {
        headline: `No trading sessions this ${periodWord} yet`,
        sub: `Log a trade in the Daily Limits Tool and this review fills in automatically.`,
        insights: [{
          tone: 'neutral', tag: 'Heads up', stat: 'Nothing logged',
          text: `There's no trade data for this ${periodWord} yet — insights need at least one logged day.`,
        }],
      };
    }

    const insights = [];

    if (violations.length > 0) {
      const groups = {};
      violations.forEach(v => {
        if (!groups[v.label]) groups[v.label] = { count: 0, message: v.message };
        groups[v.label].count++;
      });
      Object.keys(groups).forEach(label => {
        const g = groups[label];
        insights.push({
          tone: 'bad', tag: 'Rule break',
          stat: g.count > 1 ? `${label} × ${g.count}` : label,
          text: g.message || `This showed up ${g.count} time${g.count > 1 ? 's' : ''} this ${periodWord}.`,
        });
      });
    } else {
      insights.push({
        tone: 'good', tag: 'Working', stat: `Clean ${periodWord}`,
        text: `You respected every rule this ${periodWord} — ${compliantDays}/${sessionDays} day${sessionDays > 1 ? 's' : ''}, no breaks.`,
      });
    }

    // Day-after-a-loss pattern — checked against the trader's own
    // consecutive LOGGED sessions in this period (not calendar days),
    // since that's the meaningful "next time you traded" for a part-time
    // F&O trader who may skip days.
    if (insights.length < 3 && sessionDates.length >= 2) {
      const netByDate = {};
      entries.forEach(e => { netByDate[e.date] = (netByDate[e.date] || 0) + e.netResult; });

      let lossOpportunities = 0, lossFollowedByLoss = 0;
      for (let i = 0; i < sessionDates.length - 1; i++) {
        if (netByDate[sessionDates[i]] < 0) {
          lossOpportunities++;
          if (netByDate[sessionDates[i + 1]] < 0) lossFollowedByLoss++;
        }
      }

      if (lossOpportunities >= 2) {
        if (lossFollowedByLoss > 0) {
          const ratio = Math.round((lossFollowedByLoss / lossOpportunities) * 100);
          insights.push({
            tone: 'warn', tag: 'Pattern',
            stat: `${ratio}% of losses followed by another loss`,
            text: `Out of ${lossOpportunities} losing sessions this ${periodWord}, ${lossFollowedByLoss} were followed by another loss the next time you traded — worth a longer pause after a red day.`,
          });
        } else {
          insights.push({
            tone: 'good', tag: 'Working', stat: 'No loss chains',
            text: `Every losing session this ${periodWord} was followed by a reset, not another loss — that's the habit this app is built around.`,
          });
        }
      }
    }

    const headline = violations.length === 0
      ? `A fully disciplined ${periodWord}`
      : violations.length === 1
        ? `A disciplined ${periodWord} — with one leak to plug`
        : `${violations.length} rule breaks this ${periodWord} — worth a look`;
    const sub = `${trades} trade${trades !== 1 ? 's' : ''} logged · ${compliantDays}/${sessionDays} day${sessionDays !== 1 ? 's' : ''} within the rules.`;

    return { headline, sub, insights: insights.slice(0, 3) };
  }

  function renderWeeklyReview() {
    const card = document.getElementById('dash-review-card');
    if (!card) return;

    const history = getHistory();
    const weeks = computeWeeks(history);
    const months = computeMonths(history);
    const periods = reviewMode === 'weekly' ? weeks : months;

    const rawSel = reviewMode === 'weekly' ? weekSel : monthSel;
    const selIdx = Math.max(0, Math.min(rawSel, periods.length - 1));
    if (reviewMode === 'weekly') weekSel = selIdx; else monthSel = selIdx;

    const record = periods[selIdx];
    const periodWord = reviewMode === 'weekly' ? 'week' : 'month';
    const narrative = buildNarrative(record, periodWord);

    const netPnlSign = record.netPnl > 0 ? '+' : record.netPnl < 0 ? '-' : '';
    const netPnlClass = record.netPnl > 0 ? 'wr-stat-positive' : record.netPnl < 0 ? 'wr-stat-negative' : '';

    const statsHtml = `
      <div class="wr-stats-row">
        <div class="wr-stat"><div class="wr-stat-label">Trades</div><div class="wr-stat-value">${record.trades}</div></div>
        <div class="wr-stat"><div class="wr-stat-label">Win rate</div><div class="wr-stat-value">${record.winRate !== null ? record.winRate + '%' : '&mdash;'}</div></div>
        <div class="wr-stat"><div class="wr-stat-label">Rules respected</div><div class="wr-stat-value">${record.sessionDays > 0 ? record.compliantDays + '/' + record.sessionDays + ' days' : '&mdash;'}</div></div>
        <div class="wr-stat"><div class="wr-stat-label">Net P&amp;L</div><div class="wr-stat-value ${netPnlClass}">${record.trades > 0 ? netPnlSign + '₹' + fmt(Math.abs(record.netPnl)) : '&mdash;'}</div></div>
      </div>
    `;

    const insightIcon = { good: '✓', warn: '⚠', bad: '!', neutral: '•' };
    const insightsHtml = narrative.insights.map(ins => `
      <div class="wr-insight wr-insight-${ins.tone}">
        <div class="wr-insight-icon wr-insight-icon-${ins.tone}">${insightIcon[ins.tone] || '•'}</div>
        <div class="wr-insight-body">
          <div class="wr-insight-tag">${ins.tag}</div>
          <div class="wr-insight-stat">${ins.stat}</div>
          <div class="wr-insight-text">${ins.text}</div>
        </div>
      </div>
    `).join('');

    const pickerRowsHtml = periods.map((p, idx) => {
      const pnlClass = p.netPnl > 0 ? 'wr-stat-positive' : p.netPnl < 0 ? 'wr-stat-negative' : '';
      const pnlText = p.trades > 0
        ? (p.netPnl > 0 ? '+' : p.netPnl < 0 ? '-' : '') + '₹' + fmt(Math.abs(p.netPnl))
        : '&mdash;';
      return `
        <button type="button" class="wr-picker-row ${idx === selIdx ? 'wr-picker-row-active' : ''}" onclick="reviewSelectPeriod(${idx})">
          <span class="wr-picker-dot wr-picker-dot-${p.tone}"></span>
          <span class="wr-picker-range">${p.rangeLabel}</span>
          <span class="wr-picker-pnl ${pnlClass}">${pnlText}</span>
        </button>
      `;
    }).join('');

    card.innerHTML = `
      <div class="wr-header-row">
        <div class="wr-header-left">
          <div class="wr-headline-row"><span class="wr-headline-emoji">\u{1F5D3}️</span> <span class="wr-headline">${narrative.headline}</span></div>
          <div class="wr-sub">${narrative.sub}</div>
        </div>
        <div class="wr-header-right">
          <div class="wr-mode-toggle">
            <button type="button" class="wr-mode-btn ${reviewMode === 'weekly' ? 'wr-mode-btn-active' : ''}" onclick="reviewSetMode('weekly')">Weekly</button>
            <button type="button" class="wr-mode-btn ${reviewMode === 'monthly' ? 'wr-mode-btn-active' : ''}" onclick="reviewSetMode('monthly')">Monthly</button>
          </div>
          <div class="wr-period-picker-wrap">
            <button type="button" class="wr-period-btn" onclick="reviewTogglePicker(event)">${record.rangeLabel} <span class="wr-period-chevron">▾</span></button>
            <div id="wr-period-dropdown" class="wr-period-dropdown ${periodPickerOpen ? '' : 'hidden'}">${pickerRowsHtml}</div>
          </div>
        </div>
      </div>

      ${statsHtml}

      <div class="wr-insights-eyebrow">What the data noticed</div>
      <div class="wr-insights-list">${insightsHtml}</div>

      <div class="wr-footer">
        <button type="button" class="wr-journal-btn" onclick="switchTab(null, 'tab-journal')">Review this ${periodWord} in the journal</button>
        <p class="wr-footer-note">A fresh review lands every Sunday, built from your trades, limits and journal.</p>
      </div>
    `;
  }

  function reviewSetMode(mode) {
    if (mode !== 'weekly' && mode !== 'monthly') return;
    reviewMode = mode;
    periodPickerOpen = false;
    renderWeeklyReview();
  }

  function reviewSelectPeriod(idx) {
    if (reviewMode === 'weekly') weekSel = idx; else monthSel = idx;
    periodPickerOpen = false;
    renderWeeklyReview();
  }

  function reviewTogglePicker(e) {
    if (e) e.stopPropagation();
    periodPickerOpen = !periodPickerOpen;
    renderWeeklyReview();
  }

  // Closes the period dropdown on any outside click — added once, since
  // this script only ever loads a single time (see scriptLoaded cache in
  // app-shell.js's loadComponent()).
  document.addEventListener('click', (e) => {
    if (!periodPickerOpen) return;
    const wrap = document.querySelector('.wr-period-picker-wrap');
    if (wrap && !wrap.contains(e.target)) {
      periodPickerOpen = false;
      renderWeeklyReview();
    }
  });

  window.reviewSetMode = reviewSetMode;
  window.reviewSelectPeriod = reviewSelectPeriod;
  window.reviewTogglePicker = reviewTogglePicker;

  /* =========================================================
     DISCIPLINE SCORE + STREAK — "Discipline Features" handoff,
     Feature 1. Dashboard hero card: a 0–100 score ring, a consecutive-
     clean-day streak, a 21-day heatmap, and a 4-item habits grid — all
     read from ONE real adherence computation below (evaluateDayCompliance),
     itself built from the app's existing tradeHistory (ruleStatus already
     set by the Daily Limits Tool / broker import) and journalEntries
     (getAllJournalEntries()). Scored on rule-following, never on P&L,
     per the product's core thesis. Shares its date helpers with the
     Weekly/Monthly Review above (parseIsoDate/toIsoDate/addDays).
     ========================================================= */

  const DISC_MAX_TRADES_PER_DAY = 2; // same app-wide rule used elsewhere (roadmap.js, daily-limits.js)
  const DISC_HEATMAP_DAYS = 21;
  const DISC_SCORE_WINDOW_DAYS = 30; // rolling window the headline score is measured over

  let discDayCache = {}; // iso -> { status, entries, reasons, dayLoss, lossOk, tradesOk, cooldownOk, journalOk, streakImpact }

  function getJournalMap() {
    return typeof window.getAllJournalEntries === 'function' ? window.getAllJournalEntries() : {};
  }

  function getMaxLossRupees() {
    const summary = typeof window.getRiskSummary === 'function' ? window.getRiskSummary() : null;
    return summary && summary.maxLossRupees !== undefined ? summary.maxLossRupees : null;
  }

  // Evaluates the 4 rules the README specifies for a single trading day:
  // stayed within the daily loss limit, kept to max 2 trades, took the
  // cooldown between trades (reuses the SAME ruleStatus.compliant flag
  // the Daily Limits Tool / broker import already computed for
  // overtrading + broken cooldowns — see evaluateBrokerTradeCompliance()
  // in daily-limits.js), and journaled every trade logged that day.
  function evaluateDayCompliance(dayEntries, journalMap, maxLossRupees) {
    const dayLoss = dayEntries.reduce((sum, e) => sum + (e.netResult < 0 ? -e.netResult : 0), 0);
    const lossOk = maxLossRupees === null || maxLossRupees === undefined || dayLoss <= maxLossRupees;

    const overtradingFlag = dayEntries.some(e => e.ruleStatus && e.ruleStatus.compliant === false && /overtrad/i.test(e.ruleStatus.label || ''));
    const tradesOk = dayEntries.length <= DISC_MAX_TRADES_PER_DAY && !overtradingFlag;

    const cooldownBroken = dayEntries.some(e => e.ruleStatus && e.ruleStatus.compliant === false && /cooldown/i.test(e.ruleStatus.label || ''));
    const cooldownOk = !cooldownBroken;

    const journalOk = dayEntries.every(e => !!journalMap[e.id]);

    const reasons = [
      { ok: lossOk, text: lossOk ? 'Stayed within your daily loss limit' : `Exceeded your daily loss limit (₹${fmt(dayLoss)} lost)` },
      { ok: tradesOk, text: tradesOk ? 'Kept to max 2 trades' : `${dayEntries.length} trades logged — over the 2-trade limit` },
      { ok: cooldownOk, text: cooldownOk ? 'Took the 30-minute cooldown between trades' : 'Skipped the 30-minute cooldown between trades' },
      { ok: journalOk, text: journalOk ? 'Journaled every trade' : 'Left at least one trade without a journal entry' },
    ];

    const respected = lossOk && tradesOk && cooldownOk && journalOk;
    return { respected, lossOk, tradesOk, cooldownOk, journalOk, reasons, dayLoss };
  }

  // Walks backward from today to the trader's join date (or their
  // earliest logged trade if joinDate isn't set), building one status
  // per calendar day: 'respected' | 'broken' | 'no-session'. Weekends and
  // days with zero logged trades are 'no-session' — they neither help
  // nor break the streak, per the README.
  function computeDayStatuses(history, journalMap, maxLossRupees) {
    const byDate = {};
    history.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });

    const state = typeof window.getProfileState === 'function' ? window.getProfileState() : {};
    const sortedDates = Object.keys(byDate).sort();

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    // Always walk back at least DISC_SCORE_WINDOW_DAYS days, regardless of
    // account age — otherwise a brand-new account (no joinDate, no trade
    // history yet) would bound the walk to "today" only, producing an
    // empty heatmap/score instead of a full 21/30-day spread of
    // "no-session" cells.
    const minWindowBound = addDays(todayMidnight, -(DISC_SCORE_WINDOW_DAYS - 1));
    let earliestBound = state.joinDate
      ? parseIsoDate(state.joinDate)
      : (sortedDates.length ? parseIsoDate(sortedDates[0]) : todayMidnight);
    if (earliestBound > minWindowBound) earliestBound = minWindowBound;

    const days = []; // newest-first
    let cur = new Date(todayMidnight);
    while (cur >= earliestBound) {
      const iso = toIsoDate(cur);
      const dayEntries = byDate[iso];
      if (!dayEntries) {
        days.push({ iso, status: 'no-session' });
      } else {
        const evalResult = evaluateDayCompliance(dayEntries, journalMap, maxLossRupees);
        days.push({ iso, status: evalResult.respected ? 'respected' : 'broken', entries: dayEntries, evalResult });
      }
      cur = addDays(cur, -1);
    }
    return days; // newest-first
  }

  function computeWindowScore(daysSlice) {
    const sessionDays = daysSlice.filter(d => d.status !== 'no-session');
    if (sessionDays.length === 0) return null;
    const respected = sessionDays.filter(d => d.status === 'respected').length;
    return Math.round((respected / sessionDays.length) * 100);
  }

  function renderDisciplineScore() {
    const card = document.getElementById('disc-score-card');
    if (!card) return;

    const history = getHistory();
    const journalMap = getJournalMap();
    const maxLossRupees = getMaxLossRupees();
    const days = computeDayStatuses(history, journalMap, maxLossRupees); // newest-first

    // Cache day records (for the click-through modal) and compute
    // streak-impact text while scanning chronologically.
    discDayCache = {};
    const chrono = days.slice().reverse();
    let running = 0;
    let best = 0;
    chrono.forEach(day => {
      let impactText;
      if (day.status === 'broken') {
        running = 0;
        impactText = 'Streak reset to 0 this day.';
      } else if (day.status === 'respected') {
        running++;
        best = Math.max(best, running);
        impactText = `Streak continued (day ${running}).`;
      } else {
        impactText = 'No session — streak unaffected.';
      }
      discDayCache[day.iso] = Object.assign({}, day, { streakImpact: impactText });
    });

    // Current streak: from today backward, count respected days, skip
    // no-session days, stop at the first broken day.
    let streak = 0;
    for (const day of days) {
      if (day.status === 'broken') break;
      if (day.status === 'respected') streak++;
    }
    best = Math.max(best, streak);

    const score = computeWindowScore(days.slice(0, DISC_SCORE_WINDOW_DAYS));
    const thisWeekScore = computeWindowScore(days.slice(0, 7));
    const lastWeekScore = computeWindowScore(days.slice(7, 14));
    const hasDelta = thisWeekScore !== null && lastWeekScore !== null;
    const delta = hasDelta ? thisWeekScore - lastWeekScore : null;

    // ---------- Score ring ----------
    const circumference = 2 * Math.PI * 52;
    const ringScore = score !== null ? score : 0;
    const dash = (ringScore / 100) * circumference;
    const deltaClass = delta > 0 ? 'disc-delta-good' : delta < 0 ? 'disc-delta-bad' : 'disc-delta-flat';
    const deltaArrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
    const deltaText = hasDelta
      ? `${deltaArrow} ${delta > 0 ? '+' : ''}${delta} this week`
      : (thisWeekScore !== null ? 'New this week' : 'Not enough data yet');

    // ---------- Streak + heatmap ----------
    const last21 = days.slice(0, DISC_HEATMAP_DAYS).slice().reverse(); // chronological, oldest-first
    const cellsHtml = last21.map(day => {
      const cls = day.status === 'respected' ? 'disc-cell-good' : day.status === 'broken' ? 'disc-cell-bad' : 'disc-cell-none';
      return `<div class="disc-cell ${cls}" onclick="discOpenDayModal('${day.iso}')" title="${day.iso}"></div>`;
    }).join('');

    // ---------- Habits grid (last 7 calendar days) ----------
    const last7 = days.slice(0, 7);
    const sessionDays7 = last7.filter(d => d.status !== 'no-session');
    const dayCount7 = sessionDays7.length;
    let lossOkDays = 0, tradesOkDays = 0, cooldownApplicable = 0, cooldownOkDays = 0, totalTrades = 0, journaledTrades = 0;
    sessionDays7.forEach(d => {
      const r = d.evalResult;
      if (r.lossOk) lossOkDays++;
      if (r.tradesOk) tradesOkDays++;
      if (d.entries.length >= 2) {
        cooldownApplicable++;
        if (r.cooldownOk) cooldownOkDays++;
      }
      totalTrades += d.entries.length;
      journaledTrades += d.entries.filter(e => journalMap[e.id]).length;
    });

    const habits = [
      {
        ok: dayCount7 === 0 || lossOkDays === dayCount7,
        label: 'Daily loss limit',
        detail: dayCount7 > 0 ? `${lossOkDays}/${dayCount7} days within limit` : 'No sessions this week',
      },
      {
        ok: dayCount7 === 0 || tradesOkDays === dayCount7,
        label: 'Max 2 trades/day',
        detail: dayCount7 > 0 ? `${tradesOkDays}/${dayCount7} days at or under 2` : 'No sessions this week',
      },
      {
        ok: cooldownApplicable === 0 || cooldownOkDays === cooldownApplicable,
        label: '30-min cooldown',
        detail: cooldownApplicable > 0 ? `${cooldownOkDays}/${cooldownApplicable} multi-trade days` : 'No multi-trade days yet',
      },
      {
        ok: totalTrades === 0 || journaledTrades === totalTrades,
        label: 'Journaled every trade',
        detail: totalTrades > 0 ? `${journaledTrades}/${totalTrades} trades logged` : 'No trades this week',
      },
    ];

    const habitsHtml = habits.map(h => `
      <div class="disc-habit-row">
        <div class="disc-habit-icon ${h.ok ? 'disc-habit-icon-ok' : 'disc-habit-icon-warn'}">${h.ok ? '✓' : '!'}</div>
        <div class="disc-habit-text">
          <div class="disc-habit-label">${h.label}</div>
          <div class="disc-habit-detail">${h.detail}</div>
        </div>
      </div>
    `).join('');

    card.innerHTML = `
      <div class="disc-grid">
        <div class="disc-ring-col">
          <div class="disc-ring-wrap">
            <svg class="disc-ring-svg" viewBox="0 0 132 132" width="132" height="132">
              <circle class="disc-ring-track" cx="66" cy="66" r="52"></circle>
              <circle class="disc-ring-value" cx="66" cy="66" r="52" style="stroke-dasharray:${dash} ${circumference};"></circle>
            </svg>
            <div class="disc-ring-center">
              <div class="disc-ring-score">${score !== null ? score : '&mdash;'}</div>
              <div class="disc-ring-max">/ 100</div>
            </div>
          </div>
          <div class="disc-ring-label">Discipline Score</div>
          <div class="disc-ring-delta ${deltaClass}">${deltaText}</div>
        </div>

        <div class="disc-right-col">
          <div class="disc-streak-row">
            <div class="disc-streak-block">
              <div class="disc-streak-main"><span class="disc-streak-emoji">\u{1F525}</span> <span class="disc-streak-num">${streak}-day streak</span></div>
              <div class="disc-streak-sub">Consecutive days you respected every rule · best ${best}</div>
            </div>
            <div class="disc-heatmap-label">Last ${DISC_HEATMAP_DAYS} days</div>
          </div>

          <div class="disc-heatmap-grid">${cellsHtml}</div>

          <div class="disc-legend-row">
            <span class="disc-legend-item"><span class="disc-legend-swatch disc-legend-swatch-good"></span>Rules respected</span>
            <span class="disc-legend-item"><span class="disc-legend-swatch disc-legend-swatch-bad"></span>Broke a rule</span>
            <span class="disc-legend-item"><span class="disc-legend-swatch disc-legend-swatch-none"></span>No session</span>
            <span class="disc-legend-note">Scored on rules, not P&amp;L</span>
          </div>

          <div class="disc-habits-grid">${habitsHtml}</div>
        </div>
      </div>
    `;
  }

  // ---------- Day-detail modal (click any heatmap cell) ----------

  function formatFullDate(iso) {
    const d = parseIsoDate(iso);
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  }

  function ensureDiscModalExists() {
    if (document.getElementById('disc-day-modal-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'disc-day-modal-overlay';
    overlay.className = 'disc-day-modal-overlay hidden';
    overlay.onclick = discCloseIfOutside;
    overlay.innerHTML = `
      <div class="disc-day-modal">
        <div class="disc-day-modal-header">
          <div>
            <div id="disc-day-modal-date" class="disc-day-modal-date"></div>
          </div>
          <span id="disc-day-modal-pill" class="disc-day-modal-pill"></span>
          <button type="button" class="disc-day-modal-close" onclick="discCloseDayModal()" aria-label="Close">&times;</button>
        </div>
        <div id="disc-day-modal-headline" class="disc-day-modal-headline"></div>
        <div id="disc-day-modal-list" class="disc-day-modal-list"></div>
        <div id="disc-day-modal-footer" class="disc-day-modal-footer"></div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  function discOpenDayModal(iso) {
    ensureDiscModalExists();
    const day = discDayCache[iso];
    if (!day) return;

    const overlay = document.getElementById('disc-day-modal-overlay');
    const dateEl = document.getElementById('disc-day-modal-date');
    const pillEl = document.getElementById('disc-day-modal-pill');
    const headlineEl = document.getElementById('disc-day-modal-headline');
    const listEl = document.getElementById('disc-day-modal-list');
    const footerEl = document.getElementById('disc-day-modal-footer');

    dateEl.innerText = formatFullDate(iso);

    const pillClass = day.status === 'respected' ? 'disc-pill-good' : day.status === 'broken' ? 'disc-pill-bad' : 'disc-pill-none';
    const pillText = day.status === 'respected' ? 'Rules respected' : day.status === 'broken' ? 'Broke a rule' : 'No session';
    pillEl.className = `disc-day-modal-pill ${pillClass}`;
    pillEl.innerText = pillText;

    if (day.status === 'no-session') {
      headlineEl.innerText = 'No trades logged this day.';
      listEl.innerHTML = '';
    } else {
      const failedReason = day.evalResult.reasons.find(r => !r.ok);
      headlineEl.innerText = day.status === 'respected' ? 'Every rule respected today.' : failedReason.text;
      listEl.innerHTML = day.evalResult.reasons.map(r => `
        <div class="disc-day-modal-item">
          <span class="disc-day-modal-item-icon ${r.ok ? 'disc-item-ok' : 'disc-item-bad'}">${r.ok ? '✓' : '✕'}</span>
          <span>${r.text}</span>
        </div>
      `).join('');
    }

    footerEl.innerHTML = `<span class="disc-day-modal-footer-icon">ⓘ</span> ${day.streakImpact}`;

    overlay.classList.remove('hidden');
  }

  function discCloseDayModal() {
    const overlay = document.getElementById('disc-day-modal-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function discCloseIfOutside(e) {
    if (e.target && e.target.id === 'disc-day-modal-overlay') discCloseDayModal();
  }

  window.discOpenDayModal = discOpenDayModal;
  window.discCloseDayModal = discCloseDayModal;

  /* =========================================================
     RISK EXPOSURE — Max Drawdown + Trading Hours. Added alongside the
     drawdown limit rule introduced in onboarding (see tierRulesMatrix's
     drawdownPct/drawdown comment in tier-rules.js). Max Drawdown reads
     the exact same real tradeHistory every other card on this page
     reads from — no separate data source. Trading Hours needs per-trade
     EXECUTION TIME, which only exists for broker-synced trades
     (getBrokerPnlHistory()'s rows carry executedTime) — manually-logged
     Daily Limits Tool entries only ever carry a date, not a time of
     day — so it shows an honest empty state until a broker is
     connected, rather than fabricating hour-level data that doesn't
     exist for manual entries.
     ========================================================= */

  const CLOCK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatMonthDay(isoDateString) {
    const d = parseIsoDate(isoDateString);
    return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
  }

  function renderDrawdownCard() {
    const card = document.getElementById('dash-drawdown-card');
    if (!card) return;

    const state = getState();
    const history = getHistory();
    const summary = typeof window.getRiskSummary === 'function' ? window.getRiskSummary() : null;
    const limit = summary ? summary.maxDrawdownRupees : null;

    if (!history || history.length === 0 || state.startingCapital === null || limit === null) {
      card.innerHTML = `
        <div class="dash-exposure-head">
          <div class="dash-stat-label">Max. Drawdown</div>
          <span class="dash-exposure-clock-icon">${CLOCK_SVG}</span>
        </div>
        <p class="dash-exposure-empty">Log a trade to start tracking your drawdown${limit !== null ? ` against the ₹${fmt(limit)} limit` : ''}.</p>
      `;
      return;
    }

    // Chronological walk (same sort convention as recordCompletedDay) —
    // running peak balance vs. current balance. Current drawdown is how
    // far below that peak the trader sits right now, 0 at a new high —
    // matches "drawdown" as most trading platforms define it
    // (peak-to-trough), not a fixed lookback window.
    const sorted = history.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.submittedAt || 0) - (b.submittedAt || 0);
    });
    let running = state.startingCapital;
    let peak = state.startingCapital;
    sorted.forEach((e) => {
      running += e.netResult;
      if (running > peak) peak = running;
    });
    const currentDrawdown = Math.max(0, peak - running);
    const inDrawdown = currentDrawdown > 0;

    // Grouped by date for the "recent days" list — trade count per day
    // is however many entries were logged that date (a day can have
    // multiple submissions), same grouping convention used elsewhere on
    // this page (buildPeriodRecord's byDate above).
    const byDate = {};
    sorted.forEach((e) => {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e);
    });
    const recentDates = Object.keys(byDate).sort().reverse().slice(0, 3);
    const rowsHtml = recentDates.map((date) => {
      const entries = byDate[date];
      const dayNet = entries.reduce((sum, e) => sum + e.netResult, 0);
      const pct = state.startingCapital ? (dayNet / state.startingCapital) * 100 : 0;
      const isLoss = dayNet < 0;
      const sign = dayNet > 0 ? '+' : (dayNet < 0 ? '-' : '');
      return `
        <div class="dash-exposure-row">
          <span class="dash-exposure-row-date">${formatMonthDay(date)} &middot; ${entries.length}</span>
          <span class="dash-exposure-row-value ${isLoss ? 'dash-exposure-neg' : 'dash-exposure-pos'}">${sign}₹${fmt(Math.abs(dayNet))} ${sign}${Math.abs(pct).toFixed(1)}%</span>
        </div>
      `;
    }).join('');

    card.innerHTML = `
      <div class="dash-exposure-head">
        <div class="dash-stat-label">Max. Drawdown</div>
        <span class="dash-exposure-clock-icon">${CLOCK_SVG}</span>
      </div>
      <div class="dash-drawdown-value ${inDrawdown ? 'dash-exposure-neg' : ''}">-₹${fmt(currentDrawdown)}<span class="dash-drawdown-limit"> / -₹${fmt(limit)} limit</span></div>
      <span class="dash-drawdown-badge ${inDrawdown ? '' : 'dash-drawdown-badge-ok'}">${inDrawdown ? 'Currently in drawdown' : 'At a new high'}</span>
      <div class="dash-exposure-rows">${rowsHtml}</div>
    `;
  }

  const TRADING_HOUR_BUCKETS = [
    { startMin: 9 * 60 + 15, endMin: 10 * 60 + 15, label: '9:15-10:15 AM' },
    { startMin: 10 * 60 + 15, endMin: 11 * 60 + 15, label: '10:15-11:15 AM' },
    { startMin: 11 * 60 + 15, endMin: 12 * 60 + 15, label: '11:15 AM-12:15 PM' },
    { startMin: 12 * 60 + 15, endMin: 13 * 60 + 15, label: '12:15-1:15 PM' },
    { startMin: 13 * 60 + 15, endMin: 14 * 60 + 15, label: '1:15-2:15 PM' },
    { startMin: 14 * 60 + 15, endMin: 15 * 60 + 30, label: '2:15-3:30 PM' },
  ];

  let dashHoursMode = 'best'; // 'best' | 'worst'

  // Buckets the trailing 7 calendar days of broker-synced trades (today
  // and the 6 days before it) into fixed hour-long market-session
  // windows, only returning buckets that actually have a trade in them.
  // Deliberately a rolling window, NOT the Monday-start calendar week
  // "This week's review" above uses — the mock broker data generator
  // only backfills up to today, so on a Monday (or any day early in a
  // fresh calendar week) a strict Mon-Sun window would have nothing but
  // today to draw from, making this card empty most of the time purely
  // by which day it happens to be rather than by data availability.
  function bucketBrokerTradesThisWeek() {
    const brokerHistory = typeof window.getBrokerPnlHistory === 'function' ? window.getBrokerPnlHistory() : {};
    const today = new Date();
    const weekStartIso = toIsoDate(addDays(today, -6));
    const weekEndIso = toIsoDate(today);

    const buckets = TRADING_HOUR_BUCKETS.map((b) => ({ ...b, count: 0, netPnl: 0 }));

    Object.keys(brokerHistory).forEach((date) => {
      if (date < weekStartIso || date > weekEndIso) return;
      (brokerHistory[date] || []).forEach((row) => {
        const parts = (row.executedTime || '00:00:00').split(':').map(Number);
        const totalMin = (parts[0] || 0) * 60 + (parts[1] || 0);
        const bucket = buckets.find((b) => totalMin >= b.startMin && totalMin < b.endMin);
        if (bucket) {
          bucket.count += 1;
          bucket.netPnl += row.netPnl;
        }
      });
    });

    return buckets.filter((b) => b.count > 0);
  }

  function renderTradingHoursCard() {
    const card = document.getElementById('dash-hours-card');
    if (!card) return;

    const state = getState();
    const buckets = bucketBrokerTradesThisWeek();

    if (!state.brokerConnected || buckets.length === 0) {
      card.innerHTML = `
        <div class="dash-exposure-head">
          <div class="dash-stat-label">Trading Hours</div>
        </div>
        <p class="dash-exposure-empty">${!state.brokerConnected
          ? 'Connect a broker to see which hours you trade best — this needs real trade timestamps, which manual logging doesn\'t capture.'
          : 'No broker-synced trades in the last 7 days.'}</p>
      `;
      return;
    }

    const sorted = buckets.slice().sort((a, b) => (dashHoursMode === 'best' ? b.netPnl - a.netPnl : a.netPnl - b.netPnl));
    const top3 = sorted.slice(0, 3);
    const headline = top3[0];
    const headlineIsProfit = headline.netPnl >= 0;

    const rowsHtml = top3.map((b) => {
      const rowPct = state.startingCapital ? (b.netPnl / state.startingCapital) * 100 : 0;
      const isLoss = b.netPnl < 0;
      const sign = b.netPnl > 0 ? '+' : (b.netPnl < 0 ? '-' : '');
      return `
        <div class="dash-exposure-row">
          <span class="dash-hours-row-left">
            <span class="dash-hours-clock-icon">${CLOCK_SVG}</span>
            <span>${b.label}<br><span class="dash-hours-row-count">${b.count} trade${b.count > 1 ? 's' : ''}</span></span>
          </span>
          <span class="dash-exposure-row-value ${isLoss ? 'dash-exposure-neg' : 'dash-exposure-pos'}">${sign}₹${fmt(Math.abs(b.netPnl))}<br><span class="dash-hours-row-pct">${sign}${Math.abs(rowPct).toFixed(1)}%</span></span>
        </div>
      `;
    }).join('');

    card.innerHTML = `
      <div class="dash-exposure-head">
        <div class="dash-stat-label">Trading Hours</div>
        <div class="dash-hours-toggle">
          <button type="button" class="dash-hours-toggle-btn ${dashHoursMode === 'best' ? 'dash-hours-toggle-btn-active' : ''}" onclick="dashSetHoursMode('best')">Best</button>
          <button type="button" class="dash-hours-toggle-btn ${dashHoursMode === 'worst' ? 'dash-hours-toggle-btn-active' : ''}" onclick="dashSetHoursMode('worst')">Worst</button>
        </div>
      </div>
      <div class="dash-hours-headline">${headline.label}</div>
      <p class="dash-hours-headline-sub">Your ${dashHoursMode} trading hour in the last 7 days, with a ${headlineIsProfit ? 'profit' : 'loss'} of ${headlineIsProfit ? '+' : '-'}₹${fmt(Math.abs(headline.netPnl))}</p>
      <div class="dash-exposure-rows">${rowsHtml}</div>
    `;
  }

  function dashSetHoursMode(mode) {
    dashHoursMode = mode;
    renderTradingHoursCard();
  }
  window.dashSetHoursMode = dashSetHoursMode;

  function render() {
    renderStatCards();
    renderRiskRules();
    renderDrawdownCard();
    renderTradingHoursCard();
    renderRecentActivity();
    renderDisciplineScore();
    renderWeeklyReview();
  }

  window.renderDashboardHome = render;

  render();
})();
/* === END COMPONENT: dashboard-home (logic) === */