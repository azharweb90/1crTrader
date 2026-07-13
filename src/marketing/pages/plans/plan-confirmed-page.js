/* ===========================================================
   YOU'RE ALL SET page behavior. Sits between plan selection and
   app-shell:

     plans-page.html -> plan-confirmed-page.html (this)
       -> app-shell.html (onboarding, starting at step 1 — see below)

   plans-page.js's continueWithPlan() stashes the chosen plan in
   sessionStorage (key below) right before redirecting here, since
   window.Auth.getSession() only exposes {name, email} and this page
   needs the plan name/price to render the confirmation line.

   "Set up my rules" hands off into app-shell.html's onboarding
   overlay (onboarding.js) — but sets a flag first so onboarding
   starts at step 1 (the tier picker) instead of its own step 0
   welcome screen, since THIS page already served that purpose. See
   onboarding.js's openOnboarding() for the other half of this.
   =========================================================== */
(function () {

  const PLAN_KEY = '1crtrader_confirmed_plan';
  const ONB_START_STEP_KEY = 'onb_start_step';

  function showFatal(message) {
    console.error(message);
    const fatalEl = document.getElementById('confirmed-fatal-error');
    if (fatalEl) {
      fatalEl.innerText = message;
      fatalEl.classList.remove('hidden');
    }
  }

  function formatRupees(amount) {
    return '₹' + Math.round(amount).toLocaleString('en-IN');
  }

  function setUpRules() {
    try {
      localStorage.setItem(ONB_START_STEP_KEY, '1');
    } catch (e) {
      // If this fails, onboarding.js just falls back to its own
      // welcome step — a harmless extra screen, not a broken flow.
    }
    window.location.href = '/src/app/app-shell.html';
  }
  window.setUpRules = setUpRules;

  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (typeof window.Auth === 'undefined') {
        showFatal('auth-service.js did not load (script 404 or blocked) — this page needs it to know who just paid.');
        return;
      }

      // This page only makes sense right after choosing a plan, with
      // a session already set. No session means someone landed here
      // directly — send them to log in instead.
      if (!window.Auth.getSession()) {
        window.location.href = '/src/marketing/pages/auth/auth-page.html?view=login';
        return;
      }

      let planInfo = null;
      try {
        planInfo = JSON.parse(sessionStorage.getItem(PLAN_KEY));
      } catch (e) {
        planInfo = null;
      }

      const sub = document.getElementById('confirmed-sub');
      if (sub && planInfo && planInfo.name && planInfo.monthly) {
        sub.innerHTML = 'Your <strong>' + planInfo.name + '</strong> plan (' + formatRupees(planInfo.monthly) + '/mo) is now active. A receipt has been sent to your email.';
      }
      // else: leave the generic fallback text already in the HTML —
      // e.g. a direct reload where sessionStorage didn't survive.
    } catch (err) {
      showFatal('plan-confirmed-page.js crashed during setup: ' + err.message);
    }
  });
})();
