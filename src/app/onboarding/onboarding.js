/* ===========================================================
   FIRST-RUN ONBOARDING MODAL — "Discipline Features" handoff, Feature 4.

   A blocking, full-screen modal shown once, before a trader's first
   session, that locks in: (1) a capital tier, (2) the daily loss limit
   that tier carries, and (3) a personal "stop rule" — a note from
   calm-you to tilted-you that reappears later on the Cool-Down Lock
   screen (Feature 3, not yet built).

   Per the trader's explicit call: this modal runs FIRST, then hands off
   into the app's EXISTING "Set Up Your Profile" page (tier-select) —
   it does not replace it. On finish, the chosen tier's capital is
   seeded into that page's manual-capital-entry path (setupGoManual() +
   setup-capital-input + onSetupCapitalInput(), all already in
   app-shell.js) so the trader lands on a setup page that already
   reflects their onboarding choice, ready to connect a broker or just
   continue.

   Self-contained global overlay, same pattern as product-tour.js: it
   creates its own DOM on load and exposes onbNext/onbBack/etc. on
   window, called from inline onclick handlers in the markup it injects
   itself (no separate .html fragment / lazy-load — this must be able
   to show before any tab component has necessarily finished loading).

   Reuses the real tierRulesMatrix (tier-rules.js) for all tier numbers
   — the 6 curated bands here are a subset of its 12 keys, not new
   hardcoded data — and the shared .setup-cta-btn / .setup-wizard-back-btn
   button classes already used by the tier-select page, so buttons look
   identical to the page this modal hands off into.

   PROTOTYPE NOTE (see README "Production requirements"): the onboarded
   flag, chosen tier, and stop note are persisted to localStorage only.
   In production these must live on the user's server-side record so
   they survive reload / reinstall / re-login — localStorage alone is
   not enough long-term, same caveat already true of this app's other
   client-only state.
   =========================================================== */

(function () {

  const ONB_DONE_KEY = 'onb_done';
  const ONB_TIER_KEY = 'onb_tier';
  const ONB_NOTE_KEY = 'dlt_stop_note';

  const DEFAULT_STOP_NOTE =
    "I stop when I hit my limit because pushing further is how I turn a bad day into a disaster. " +
    "The market is open again tomorrow. My edge is discipline — protecting my capital IS the trade.";

  // Curated 6-band picker for Step 1 — a deliberate subset of the app's
  // real 12-key tierRulesMatrix (tier-rules.js), matching the README's
  // spec exactly (small1/small2/medium1/medium2/large1/pro1) rather than
  // showing all 12 sub-levels in a first-run modal.
  const ONB_TIER_KEYS = ['small-1', 'small-2', 'medium-1', 'medium-2', 'large-1', 'pro-1'];
  const ONB_TIER_LABELS = {
    'small-1': 'Small - Level 1',
    'small-2': 'Small - Level 2',
    'medium-1': 'Medium - Level 1',
    'medium-2': 'Medium - Level 2',
    'large-1': 'Large - Level 1',
    'pro-1': 'Pro - Level 1',
  };

  let onbStep = 0;      // 0 = welcome, 1..4 = the 4 progress-tracked steps
  let onbTier = '';     // e.g. 'medium-1' — '' until picked
  let onbNote = DEFAULT_STOP_NOTE;

  function hasOnboarded() {
    return localStorage.getItem(ONB_DONE_KEY) === '1';
  }

  function markOnboarded() {
    localStorage.setItem(ONB_DONE_KEY, '1');
  }

  function getTierData(key) {
    const matrix = window.tierRulesMatrix || {};
    return matrix[key] || null;
  }

  // ---------- Overlay lifecycle ----------

  // Left-panel checklist copy — maps 1:1 onto steps 1-3 of the wizard
  // (tier -> loss limit -> stop rule) so the promo panel and the form
  // panel visibly track the same journey instead of the left side
  // being static decoration. See updateChecklist().
  const ONB_CHECKLIST = [
    { n: 1, text: 'A capital tier that sets your real max lot size — not a guess.' },
    { n: 2, text: "A hard daily loss cap you can't override in the heat of the moment." },
    { n: 3, text: 'A personal stop rule, from calm-you, for the day you need it most.' },
  ];

  function ensureOverlayExists() {
    if (document.getElementById('onb-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'onb-overlay';
    overlay.className = 'onb-overlay hidden';

    const checklistHtml = ONB_CHECKLIST.map(item => `
      <div class="onb-check-item" data-check="${item.n}">
        <span class="onb-check-icon"></span>
        <span class="onb-check-text">${item.text}</span>
      </div>
    `).join('');

    overlay.innerHTML = `
      <div class="onb-left">
        <div class="onb-logo-row">
          <img src="/assets/images/logos/1crtraders-icon.png" alt="" class="onb-logo-icon">
          <div>
            <div class="onb-logo-name">1Cr Traders</div>
            <div class="onb-logo-tag">REWARD ABOVE RISK</div>
          </div>
        </div>
        <div class="onb-left-mid">
          <div class="onb-eyebrow">Before your first trade</div>
          <h2 class="onb-headline">Every rule here exists because a trader broke it once.</h2>
          <p class="onb-left-sub">Sixty seconds now buys you the discipline most traders only learn after losing real money. Here's what you're setting up:</p>
          <div class="onb-checklist" id="onb-checklist">${checklistHtml}</div>
          <div class="onb-left-quote">"The goal isn't to win every trade. It's to still be trading next year." That's the whole reason 1CrTraders exists.</div>
        </div>
        <div class="onb-left-bottom">
          <div class="onb-avatars">
            <span class="onb-avatar"></span>
            <span class="onb-avatar"></span>
            <span class="onb-avatar"></span>
          </div>
          <div class="onb-social-text">Join 12,000+ disciplined traders</div>
        </div>
      </div>
      <div class="onb-right">
        <div class="onb-right-inner">
          <div id="onb-progress" class="onb-progress hidden">
            <div class="onb-progress-bar" id="onb-progress-bar">
              <span class="onb-progress-seg" data-seg="1"></span>
              <span class="onb-progress-seg" data-seg="2"></span>
              <span class="onb-progress-seg" data-seg="3"></span>
              <span class="onb-progress-seg" data-seg="4"></span>
            </div>
            <div class="onb-step-eyebrow">STEP <span id="onb-step-num">1</span> OF 4</div>
          </div>
          <div id="onb-step-body"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  // Syncs the left-panel checklist to the current step: earlier steps
  // read as "done" (filled check), the step whose data currently being
  // decided reads as "active" (highlighted outline), later ones stay
  // dimmed. Step 4 (the done screen) marks everything complete.
  function updateChecklist(step) {
    const items = document.querySelectorAll('#onb-checklist .onb-check-item');
    items.forEach(item => {
      const n = parseInt(item.dataset.check, 10);
      item.classList.remove('onb-check-item-active', 'onb-check-item-done');
      if (step >= 4 || step > n) {
        item.classList.add('onb-check-item-done');
      } else if (step === n) {
        item.classList.add('onb-check-item-active');
      }
    });
  }

  function openOnboarding() {
    ensureOverlayExists();
    onbStep = 0;
    onbTier = '';
    onbNote = DEFAULT_STOP_NOTE;
    const overlay = document.getElementById('onb-overlay');
    if (overlay) overlay.classList.remove('hidden');
    renderStep();
  }

  function closeOnboarding() {
    const overlay = document.getElementById('onb-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  // ---------- Step rendering ----------

  function renderStep() {
    const progress = document.getElementById('onb-progress');
    const body = document.getElementById('onb-step-body');
    if (!progress || !body) return;

    if (onbStep === 0) {
      progress.classList.add('hidden');
    } else {
      progress.classList.remove('hidden');
      const stepNumEl = document.getElementById('onb-step-num');
      if (stepNumEl) stepNumEl.innerText = String(onbStep);
      progress.querySelectorAll('.onb-progress-seg').forEach(seg => {
        const n = parseInt(seg.dataset.seg, 10);
        seg.classList.toggle('onb-progress-seg-done', n <= onbStep);
      });
    }

    updateChecklist(onbStep);

    body.innerHTML = stepHtml();

    // Textarea value is set via the DOM (not templated into innerHTML)
    // so the stop-note text never has to be HTML-escaped.
    if (onbStep === 3) {
      const noteEl = document.getElementById('onb-note-input');
      if (noteEl) noteEl.value = onbNote;
    }
  }

  function stepHtml() {
    if (onbStep === 0) return step0Html();
    if (onbStep === 1) return step1Html();
    if (onbStep === 2) return step2Html();
    if (onbStep === 3) return step3Html();
    return step4Html();
  }

  function step0Html() {
    return `
      <div class="onb-step onb-step0">
        <img src="/assets/images/logos/1crtraders-icon.png" alt="" class="onb-icon">
        <h2 class="onb-heading">Welcome to 1Cr Traders</h2>
        <p class="onb-body">Before your first trade, let's lock in the rules that protect you. It takes 60 seconds — and it's the reason traders here don't blow up.</p>
        <button type="button" class="setup-cta-btn" onclick="onbNext()">Set up my rules</button>
        <button type="button" class="onb-skip-link" onclick="onbSkip()">Skip for now</button>
      </div>
    `;
  }

  function step1Html() {
    const rows = ONB_TIER_KEYS.map(key => {
      const t = getTierData(key);
      if (!t) return '';
      const selected = onbTier === key;
      return `
        <button type="button" class="onb-tier-row ${selected ? 'onb-tier-row-selected' : ''}" onclick="onbPickTier('${key}')">
          <span class="onb-tier-radio ${selected ? 'onb-tier-radio-selected' : ''}"></span>
          <span class="onb-tier-row-text">
            <span class="onb-tier-name">${ONB_TIER_LABELS[key]}</span>
            <span class="onb-tier-meta">Daily loss limit ₹${fmt(t.loss)} · up to ${t.maxLots} lot${t.maxLots > 1 ? 's' : ''}</span>
          </span>
        </button>
      `;
    }).join('');

    return `
      <div class="onb-step">
        <h2 class="onb-heading onb-heading-left">What are you trading with?</h2>
        <p class="onb-sub">This sets your tier — your max lot size and daily loss limit. Changeable later in Account.</p>
        <div class="onb-tier-list">${rows}</div>
        <div class="onb-footer">
          <button type="button" class="setup-wizard-back-btn" onclick="onbBack()">Back</button>
          <button type="button" class="setup-cta-btn" style="width:auto;flex:1;" ${onbTier ? '' : 'disabled'} onclick="onbNext()">Continue</button>
        </div>
      </div>
    `;
  }

  function step2Html() {
    const key = onbTier || 'medium-1';
    const t = getTierData(key) || { loss: 0, pct: 0, maxLots: 0 };
    return `
      <div class="onb-step">
        <h2 class="onb-heading onb-heading-left">Your daily loss limit</h2>
        <p class="onb-sub">Based on your ${ONB_TIER_LABELS[key] || 'chosen'} tier.</p>
        <div class="onb-loss-callout">
          <div class="onb-loss-label">Max loss per day</div>
          <div class="onb-loss-value">₹${fmt(t.loss)}</div>
          <div class="onb-loss-sub">${Number(t.pct).toFixed(2)}% of your capital · up to ${t.maxLots} lots per trade</div>
        </div>
        <div class="onb-warn-strip">
          <span class="onb-warn-icon">\u{1F512}</span>
          <span>The moment you hit this limit, 1CrTraders locks you out of trading for the rest of the day — with a 60-second cool-down. No revenge trades, no exceptions.</span>
        </div>
        <div class="onb-footer">
          <button type="button" class="setup-wizard-back-btn" onclick="onbBack()">Back</button>
          <button type="button" class="setup-cta-btn" style="width:auto;flex:1;" onclick="onbNext()">I accept this limit</button>
        </div>
      </div>
    `;
  }

  function step3Html() {
    return `
      <div class="onb-step">
        <h2 class="onb-heading onb-heading-left">Write your stop rule</h2>
        <p class="onb-sub">A message from calm-you to tilted-you.</p>
        <textarea id="onb-note-input" class="onb-note-textarea" oninput="onbNoteInput()"></textarea>
        <div class="onb-footer">
          <button type="button" class="setup-wizard-back-btn" onclick="onbBack()">Back</button>
          <button type="button" class="setup-cta-btn" style="width:auto;flex:1;" onclick="onbNext()">Save my rule</button>
        </div>
      </div>
    `;
  }

  function step4Html() {
    const key = onbTier || 'medium-1';
    const t = getTierData(key) || { loss: 0, maxLots: 0 };
    return `
      <div class="onb-step onb-step4">
        <div class="onb-done-check">✓</div>
        <h2 class="onb-heading">You're set up to trade with discipline</h2>
        <div class="onb-summary-list">
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> ${ONB_TIER_LABELS[key] || 'Medium 1'} tier · up to ${t.maxLots} lots</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> ₹${fmt(t.loss)} daily loss limit · hard lock-out</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> Max 2 trades/day · 30-min cooldown</div>
          <div class="onb-summary-row"><span class="onb-summary-icon">✓</span> Personal stop rule saved</div>
        </div>
        <button type="button" class="setup-cta-btn" onclick="onbFinish()">Start trading</button>
      </div>
    `;
  }

  // ---------- Step behavior ----------

  function onbNext() {
    if (onbStep === 1 && !onbTier) return;
    if (onbStep < 4) onbStep++;
    renderStep();
  }

  function onbBack() {
    if (onbStep === 0) return;
    onbStep--;
    renderStep();
  }

  function onbPickTier(key) {
    onbTier = key;
    renderStep();
  }

  function onbNoteInput() {
    const el = document.getElementById('onb-note-input');
    if (el) onbNote = el.value;
  }

  function onbSkip() {
    // Step 0 only, per spec — persists the seen flag but sets no tier;
    // the app falls back to whatever default the setup page itself uses.
    markOnboarded();
    closeOnboarding();
  }

  function onbFinish() {
    const key = onbTier || 'medium-1';
    markOnboarded();
    localStorage.setItem(ONB_TIER_KEY, key);
    localStorage.setItem(ONB_NOTE_KEY, onbNote || DEFAULT_STOP_NOTE);
    seedChosenTierIntoSetupPage(key);
    closeOnboarding();
  }

  // Hands the chosen tier's capital off to the EXISTING "Set Up Your
  // Profile" page (tier-select) by driving its own real manual-capital
  // path exactly as if the trader had typed it in themselves:
  // setupGoManual() reveals the manual capital field (and resets it),
  // then the tier's cap is typed into it and onSetupCapitalInput() is
  // called to derive selectedTier/startingCapital/currentBalance and
  // refresh the summary rail — all existing app-shell.js logic, nothing
  // duplicated here. tab-select's fragment is fetched async on
  // DOMContentLoaded (see app-shell.js), so this retries briefly in case
  // it hasn't finished loading the instant this runs (in practice it
  // always has, since onboarding takes several real user interactions).
  function seedChosenTierIntoSetupPage(key, attempt) {
    attempt = attempt || 0;
    const input = document.getElementById('setup-capital-input');
    if (!input) {
      if (attempt < 30) setTimeout(() => seedChosenTierIntoSetupPage(key, attempt + 1), 100);
      return;
    }
    const t = getTierData(key);
    if (!t) return;
    if (typeof window.setupGoManual === 'function') window.setupGoManual();
    input.value = String(t.cap);
    if (typeof window.onSetupCapitalInput === 'function') window.onSetupCapitalInput();
  }

  // ---------- Boot ----------

  function initOnboarding() {
    if (hasOnboarded()) return;
    // Now that a real auth gate exists (auth-service.js), app-shell.js's
    // own DOMContentLoaded handler redirects an un-authed visitor to
    // /src/marketing/pages/auth/auth-page.html — but that redirect isn't
    // instant, and this listener fires on the same DOMContentLoaded
    // event. Without this check, the modal could flash open for a
    // moment before the redirect kicks in. If Auth isn't loaded at all
    // (auth-service.js missing), fall back to the old behavior of just
    // showing the modal, matching app-shell.js's own fallback.
    if (typeof window.Auth !== 'undefined' && !window.Auth.getSession()) return;
    openOnboarding();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOnboarding);
  } else {
    initOnboarding();
  }

  window.onbNext = onbNext;
  window.onbBack = onbBack;
  window.onbPickTier = onbPickTier;
  window.onbNoteInput = onbNoteInput;
  window.onbSkip = onbSkip;
  window.onbFinish = onbFinish;

})();