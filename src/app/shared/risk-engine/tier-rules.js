/* ===========================================================
   TIER RULES — pure, stateless risk math
   Extracted from app-shell.js during the Phase 2 JS split.

   This is deliberately a SMALL, careful extraction: only the pieces of
   app-shell.js's risk logic that take explicit parameters and read no
   shared mutable state. The rest of the risk-engine (getOfficialSubLevelKey,
   getRiskSummary, getMaxAllowedLots, getPerLotMaxLossRupees,
   getNextLotUnlockInfo) directly reads/writes shared state variables
   (selectedTier, currentBalance, originalStartingCapital, and the
   highestOfficialSubLevel* ratchet) that live in app-shell.js's closure
   and are mutated from dozens of call sites across that file.

   Splitting THOSE out safely would mean converting every read/write of
   that state to go through window.*, which is a wide, easy-to-get-wrong
   change with no way to visually verify from a container. That work
   belongs to the actual React migration, where selectedTier/currentBalance
   become useState and the risk functions become a useRiskEngine() hook
   almost for free. Doing it by hand in vanilla JS now is real risk for a
   benefit that's about to be superseded anyway — so it's intentionally
   left in app-shell.js. See docs/architecture/ for the full plan.

   Loaded BEFORE app-shell.js (see app-shell.html) so window.tierRulesMatrix,
   window.subLevelForBalance, and window.computeTrailingSl exist before
   app-shell.js's own top-level code runs.
   =========================================================== */

(function () {

  // Single source of truth for max daily loss by tier+sub-level. Lives here
  // (not in features/daily-limits/daily-limits.js) because app-shell.js is always loaded
  // and other screens — the Dashboard's risk summary, for one — need this
  // data without depending on the Daily Limits Tool having ever been
  // visited this session. calculator.js reads this via window.tierRulesMatrix
  // instead of keeping its own separate copy.
  //
  // maxLots: how many lots a trader at this sub-tier may trade. This is a
  // property of CAPITAL, not of risk — note that loss does NOT multiply by
  // maxLots (e.g. medium-1/2/3 all sit near 4-5% loss regardless of having
  // 4/6/8 lots available; an extra lot is about spreading/flexibility, not
  // a bigger risk budget). See getMaxAllowedLots() below for how a trader's
  // ENTRY sub-tier (from their base/starting capital) and subsequent +50%
  // BALANCE GROWTH (from originalStartingCapital, compounding) combine to
  // determine their actual current lot allowance.
  // drawdownPct/drawdown: a NEW, second guardrail added alongside the
  // existing per-day loss cap — a TOTAL cumulative-loss ceiling across
  // multiple days (not reset daily), meant to catch a string of bad days
  // stacking up even if no single day breaches the daily limit.
  // drawdownPct = pct * 3 for every tier (confirmed with the trader:
  // Small-1's ₹3,750 drawdown is exactly 3x its ₹1,250 daily loss cap at
  // 5%/15%) — kept as an explicit stored field, not recomputed ad hoc at
  // each call site. All 3 Small sub-levels (small-1/2/3) use a flat 5%
  // daily loss — small-2 was 6% before, now matches small-1 and small-3.
  // Also true since Phase 2 features (Daily Limits Tool, Dashboard,
  // the not-yet-built Cool-Down Lock) will all need to read it. Hitting it
  // is meant to be a harder stop than the daily lock — the trader's own
  // guidance for what should happen: step away for at least a week,
  // review/journal what went wrong, reset psychologically, then come back
  // — not just "wait for the cooldown timer." Actual enforcement (lock
  // duration, UI) is Phase 2 work on the Cool-Down Lock page; this is only
  // the underlying number + copy for now.
  const tierRulesMatrix = {
    "small-1":  { cap: 25000,    pct: 5.00, loss: 1250,  maxLots: 1,  drawdownPct: 15.00, drawdown: 3750 },
    "small-2":  { cap: 50000,    pct: 5.00, loss: 2500,  maxLots: 2,  drawdownPct: 15.00, drawdown: 7500 },
    "small-3":  { cap: 75000,    pct: 5.00, loss: 3750,  maxLots: 3,  drawdownPct: 15.00, drawdown: 11250 },
    "medium-1": { cap: 100000,   pct: 4.00, loss: 4000,  maxLots: 4,  drawdownPct: 12.00, drawdown: 12000 },
    "medium-2": { cap: 300000,   pct: 2.00, loss: 6000,  maxLots: 6,  drawdownPct: 6.00,  drawdown: 18000 },
    "medium-3": { cap: 400000,   pct: 2.00, loss: 8000,  maxLots: 8,  drawdownPct: 6.00,  drawdown: 24000 },
    "large-1":  { cap: 500000,   pct: 2.00, loss: 10000, maxLots: 8,  drawdownPct: 6.00,  drawdown: 30000 },
    "large-2":  { cap: 700000,   pct: 2.00, loss: 14000, maxLots: 16, drawdownPct: 6.00,  drawdown: 42000 },
    "large-3":  { cap: 900000,   pct: 2.00, loss: 18000, maxLots: 24, drawdownPct: 6.00,  drawdown: 54000 },
    "pro-1":    { cap: 1000000,  pct: 2.00, loss: 20000, maxLots: 16, drawdownPct: 6.00,  drawdown: 60000 },
    "pro-2":    { cap: 1500000,  pct: 2.00, loss: 30000, maxLots: 32, drawdownPct: 6.00,  drawdown: 90000 },
    "pro-3":    { cap: 1900000,  pct: 2.00, loss: 38000, maxLots: 48, drawdownPct: 6.00,  drawdown: 114000 },
  };

  // Given a broad tier ('small'..'pro') and a rupee balance, finds which
  // sub-level (1/2/3) that balance falls into, by comparing against each
  // sub-level's cap within that tier — used so the Dashboard's risk summary
  // reflects the trader's CURRENT balance, not always sub-level 1.
  function subLevelForBalance(tier, balance) {
    const subLevels = ['1', '2', '3'].map(n => `${tier}-${n}`).filter(key => tierRulesMatrix[key]);
    if (subLevels.length === 0) return null;

    let chosen = subLevels[0];
    for (const key of subLevels) {
      if (balance >= tierRulesMatrix[key].cap) chosen = key;
    }
    return chosen;
  }

  // Trailing stop-loss formula, worked out directly with the trader:
  // - Below +1R in favor: hold the original SL (which sits at -1R from
  //   entry, by definition of R).
  // - From +1R onward: SL (in points from entry) = pointsInFavor - 1.5*R,
  //   calculated CONTINUOUSLY (no rounding to 0.5R steps) — e.g. at
  //   exactly +1R favor, SL = R - 1.5R = -0.5R (half the original risk);
  //   at +1.5R favor, SL = 0 (breakeven); at +2R favor, SL = +0.5R (locked
  //   profit); and so on indefinitely, every point gained beyond +1R
  //   trails the SL up by the same point.
  // Returns { slFromEntry, isHoldingOriginal, lockedProfit } where
  // slFromEntry is in points relative to entry (negative = still risking
  // some of the original capital, positive = guaranteed profit locked in)
  // and lockedProfit is slFromEntry when positive, else null.
  function computeTrailingSl(riskPoints, pointsInFavor) {
    if (riskPoints === null || riskPoints === undefined || riskPoints <= 0) return null;
    if (pointsInFavor === null || pointsInFavor === undefined) return null;

    if (pointsInFavor < riskPoints) {
      return {
        isHoldingOriginal: true,
        slFromEntry: -riskPoints,
        lockedProfit: null,
      };
    }

    const slFromEntry = pointsInFavor - 1.5 * riskPoints;
    return {
      isHoldingOriginal: false,
      slFromEntry,
      lockedProfit: slFromEntry > 0 ? slFromEntry : null,
    };
  }

  window.tierRulesMatrix = tierRulesMatrix;
  window.subLevelForBalance = subLevelForBalance;
  window.computeTrailingSl = computeTrailingSl;

})();
