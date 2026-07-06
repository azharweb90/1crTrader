/* ===========================================================
   COOL-DOWN LOCK (the "blue screen") — "Discipline Features" handoff,
   Feature 3.

   A full-screen lockout that fires the instant a trader's cumulative day
   loss reaches their tier's daily loss limit — the enforcement moment the
   whole app's promise rests on: no revenge trades. Forces a 60-second
   breathing pause before the trader can even acknowledge it, and — this
   is the part that actually matters — dismissing the screen does NOT
   reopen trading. The day stays closed regardless, enforced by a
   localStorage flag that survives a reload (see isTradingLockedToday()
   below; a real backend would make this server-side, per the README's
   own "Production requirements" note).

   Self-contained global overlay, same injection pattern as onboarding.js
   and product-tour.js: builds its own DOM on first use and exposes a
   small API on window for daily-limits.js to call:
     - window.triggerCoolDownLock(maxLossRupees, dayLossRupees)
         Fired from submitTrade1()/submitTrade2() in daily-limits.js the
         instant cumulative day loss >= the tier's max daily loss.
     - window.isTradingLockedToday()
         daily-limits.js checks this on load (and re-shows the lock
         screen, using the cached amounts) so a reload/re-visit can't
         quietly bypass a lock started earlier the same day.

   Uses the personal "stop note" captured during onboarding
   (localStorage.dlt_stop_note, written by onboarding.js's onbFinish())
   — the exact same text the trader wrote for themselves shows up here,
   editable, per the README ("a note from you, to you").
   =========================================================== */

(function () {

  const LOCK_DATE_KEY = 'cdl_lock_date';
  const LOCK_MAX_LOSS_KEY = 'cdl_max_loss';
  const LOCK_DAY_LOSS_KEY = 'cdl_day_loss';
  const BREATHE_DONE_DATE_KEY = 'cdl_breathe_done_date';
  const STOP_NOTE_KEY = 'dlt_stop_note';

  const DEFAULT_STOP_NOTE =
    "I stop when I hit my limit because pushing further is how I turn a bad day into a disaster. " +
    "The market is open again tomorrow. My edge is discipline — protecting my capital IS the trade.";

  const BREATHE_SECONDS = 60;

  let killLock = false;
  let breathing = false;
  let breatheLeft = BREATHE_SECONDS;
  let breatheIntervalId = null;

  function today() {
    return (typeof window.todayDateString === 'function') ? window.todayDateString() : new Date().toISOString().slice(0, 10);
  }

  // ---------- Persistence (prototype: localStorage. PRODUCTION NOTE per
  // README — the "trading closed for today" flag must live server-side
  // so it survives reload/app-restart/re-login; this client-only version
  // is the honest prototype-level approximation of that requirement.) ----------
  function isTradingLockedToday() {
    return localStorage.getItem(LOCK_DATE_KEY) === today();
  }

  function persistLock(maxLossRupees, dayLossRupees) {
    localStorage.setItem(LOCK_DATE_KEY, today());
    localStorage.setItem(LOCK_MAX_LOSS_KEY, String(maxLossRupees));
    localStorage.setItem(LOCK_DAY_LOSS_KEY, String(dayLossRupees));
  }

  function getStopNote() {
    const saved = localStorage.getItem(STOP_NOTE_KEY);
    return saved || DEFAULT_STOP_NOTE;
  }

  function saveStopNote(text) {
    localStorage.setItem(STOP_NOTE_KEY, text || DEFAULT_STOP_NOTE);
  }

  function hasBreathedToday() {
    return localStorage.getItem(BREATHE_DONE_DATE_KEY) === today();
  }

  function markBreathedToday() {
    localStorage.setItem(BREATHE_DONE_DATE_KEY, today());
  }

  // ---------- Overlay lifecycle ----------
  function ensureOverlayExists() {
    if (document.getElementById('cdl-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'cdl-overlay';
    overlay.className = 'cdl-overlay hidden';
    overlay.innerHTML = `
      <div class="cdl-glow"></div>
      <div class="cdl-content">
        <div class="cdl-pill"><span class="cdl-pill-icon">\u{1F512}</span> Daily limit reached</div>

        <div class="cdl-breathe-wrap">
          <div class="cdl-breathe-circle">
            <div class="cdl-breathe-inner">
              <div id="cdl-countdown" class="cdl-countdown">60s</div>
              <div id="cdl-instruction" class="cdl-instruction">Breathe in&hellip;</div>
            </div>
          </div>
        </div>

        <h1 class="cdl-headline">You're done for today.</h1>
        <p id="cdl-body" class="cdl-body"></p>

        <div class="cdl-note-wrap">
          <div class="cdl-note-eyebrow">Your stop rule, from onboarding</div>
          <textarea id="cdl-note-input" class="cdl-note-textarea" oninput="cdlNoteInput()"></textarea>
        </div>

        <button type="button" id="cdl-ack-btn" class="cdl-ack-btn" disabled onclick="dismissKillLock()">Sit with it &mdash; 60s left</button>
        <p id="cdl-footer" class="cdl-footer">Breathing exercise &middot; Trading stays closed for today either way.</p>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  // Fired from daily-limits.js the instant cumulative day loss reaches
  // the tier's max daily loss — either Trade 1's loss alone, or Trade 1 +
  // Trade 2 combined. maxLossRupees/dayLossRupees are always passed fresh
  // from the caller's own rule/day-total so this module never duplicates
  // that math; it only persists + displays it.
  function triggerCoolDownLock(maxLossRupees, dayLossRupees) {
    ensureOverlayExists();
    persistLock(maxLossRupees, dayLossRupees);
    renderContent(maxLossRupees, dayLossRupees);

    const overlay = document.getElementById('cdl-overlay');
    overlay.classList.remove('hidden');
    killLock = true;

    if (hasBreathedToday()) {
      // Already sat through the 60s once today (e.g. this is a reload of
      // an already-locked day) — no need to force it again, but the
      // screen (and the closed-for-today state) still shows.
      finishBreathing(/* alreadyDone */ true);
    } else {
      startBreathe();
    }
  }

  // Re-shows the lock screen using the cached amounts from earlier today
  // — called from daily-limits.js on load when isTradingLockedToday() is
  // already true, so a reload can't quietly slip past a lock started
  // earlier the same session.
  function reshowIfLockedToday() {
    if (!isTradingLockedToday()) return false;
    const maxLoss = Number(localStorage.getItem(LOCK_MAX_LOSS_KEY)) || 0;
    const dayLoss = Number(localStorage.getItem(LOCK_DAY_LOSS_KEY)) || 0;
    ensureOverlayExists();
    renderContent(maxLoss, dayLoss);
    document.getElementById('cdl-overlay').classList.remove('hidden');
    killLock = true;
    if (hasBreathedToday()) {
      finishBreathing(true);
    } else {
      startBreathe();
    }
    return true;
  }

  function renderContent(maxLossRupees, dayLossRupees) {
    const bodyEl = document.getElementById('cdl-body');
    if (bodyEl) {
      bodyEl.innerHTML = `You've hit your <strong>₹${fmt(maxLossRupees)}</strong> daily loss limit. This is the moment the rule exists for. No more trades today — the market will be here tomorrow.`;
    }
    const noteEl = document.getElementById('cdl-note-input');
    if (noteEl) noteEl.value = getStopNote();
  }

  // ---------- Breathing timer ----------
  function startBreathe() {
    breathing = true;
    breatheLeft = BREATHE_SECONDS;
    updateBreatheUi();

    if (breatheIntervalId) clearInterval(breatheIntervalId);
    breatheIntervalId = setInterval(() => {
      breatheLeft--;
      if (breatheLeft <= 0) {
        clearInterval(breatheIntervalId);
        breatheIntervalId = null;
        markBreathedToday();
        finishBreathing(false);
      } else {
        updateBreatheUi();
      }
    }, 1000);
  }

  function updateBreatheUi() {
    const countdownEl = document.getElementById('cdl-countdown');
    const instructionEl = document.getElementById('cdl-instruction');
    const ackBtn = document.getElementById('cdl-ack-btn');
    if (countdownEl) countdownEl.innerText = `${breatheLeft}s`;
    if (instructionEl) {
      const phase = Math.floor(breatheLeft / 4) % 2;
      instructionEl.innerText = phase === 0 ? 'Breathe in…' : 'Breathe out…';
    }
    if (ackBtn) ackBtn.innerText = `Sit with it — ${breatheLeft}s left`;
  }

  // alreadyDone: true when this is a same-day reshow that already
  // completed its 60s earlier — skips straight to the "Done" display
  // without re-running the countdown.
  function finishBreathing(alreadyDone) {
    breathing = false;
    const countdownEl = document.getElementById('cdl-countdown');
    const instructionEl = document.getElementById('cdl-instruction');
    const ackBtn = document.getElementById('cdl-ack-btn');
    const footerEl = document.getElementById('cdl-footer');
    if (countdownEl) countdownEl.innerText = 'Done';
    if (instructionEl) instructionEl.innerText = alreadyDone ? 'Already done today' : 'Well done.';
    if (ackBtn) {
      ackBtn.disabled = false;
      ackBtn.innerText = "I'm done for today";
    }
    if (footerEl) footerEl.innerText = 'You can close this now · trading stays closed for today.';
  }

  // Dismissing hides the overlay — it does NOT reopen trading. Trading
  // stays closed for the rest of the calendar day regardless (enforced
  // by isTradingLockedToday(), checked again on next load/tab-visit).
  function dismissKillLock() {
    if (breathing) return; // gated: cannot dismiss during the 60s, by design
    const overlay = document.getElementById('cdl-overlay');
    if (overlay) overlay.classList.add('hidden');
    killLock = false;
  }

  function cdlNoteInput() {
    const el = document.getElementById('cdl-note-input');
    if (el) saveStopNote(el.value);
  }

  window.triggerCoolDownLock = triggerCoolDownLock;
  window.isTradingLockedToday = isTradingLockedToday;
  window.reshowCoolDownLockIfActive = reshowIfLockedToday;
  window.dismissKillLock = dismissKillLock;
  window.cdlNoteInput = cdlNoteInput;

})();
