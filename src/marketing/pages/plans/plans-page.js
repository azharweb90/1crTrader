/* ===========================================================
   CHOOSE YOUR PLAN page behavior. Sits between signup and app-shell —
   auth-page.js's register submit handler redirects here on success
   (goToPlans()) instead of straight into the app. Requires an active
   session (set by signUp()); if someone lands here directly without
   one, bounce to login rather than showing a plan picker with nothing
   to attach it to.
   =========================================================== */
(function () {

  // Monthly price is the source of truth; the yearly figure shown in
  // the table is the full annual total at 20% off (monthly * 12 *
  // 0.8), not a monthly-equivalent — matches "Save 20%" directly
  // rather than a second hand-maintained number that could drift.
  const PLANS = {
    starter: { name: 'Starter', monthly: 499 },
    pro: { name: 'Pro', monthly: 999 },
    elite: { name: 'Elite', monthly: 2499 },
  };

  let billingCycle = 'monthly'; // 'monthly' | 'yearly'
  let selectedPlan = null;

  function showFatal(message) {
    console.error(message);
    const fatalEl = document.getElementById('plans-fatal-error');
    if (fatalEl) {
      fatalEl.innerText = message;
      fatalEl.classList.remove('hidden');
    }
  }

  function formatRupees(amount) {
    return '₹' + Math.round(amount).toLocaleString('en-IN');
  }

  function renderPrices() {
    Object.keys(PLANS).forEach(key => {
      const amountEl = document.getElementById('plans-price-' + key);
      const suffixEl = document.getElementById('plans-price-suffix-' + key);
      if (!amountEl) return;
      const monthly = PLANS[key].monthly;
      const isYearly = billingCycle === 'yearly';
      const price = isYearly ? monthly * 12 * 0.8 : monthly;
      amountEl.innerText = formatRupees(price);
      if (suffixEl) suffixEl.innerText = isYearly ? '/yr' : '/mo';
    });
  }

  function toggleBillingCycle() {
    billingCycle = billingCycle === 'monthly' ? 'yearly' : 'monthly';
    const toggle = document.getElementById('plans-billing-toggle');
    const monthlyLabel = document.getElementById('plans-monthly-label');
    const yearlyLabel = document.getElementById('plans-yearly-label');
    const isYearly = billingCycle === 'yearly';

    if (toggle) {
      toggle.classList.toggle('plans-toggle-on', isYearly);
      toggle.setAttribute('aria-checked', String(isYearly));
    }
    if (monthlyLabel) monthlyLabel.classList.toggle('plans-billing-label-active', !isYearly);
    if (yearlyLabel) yearlyLabel.classList.toggle('plans-billing-label-active', isYearly);

    renderPrices();
  }
  window.toggleBillingCycle = toggleBillingCycle;

  function selectPlan(plan) {
    if (!PLANS[plan]) return;
    selectedPlan = plan;

    const radio = document.querySelector('.plans-radio-input[value="' + plan + '"]');
    if (radio) radio.checked = true;

    const table = document.querySelector('.plans-table');
    if (table) {
      table.classList.remove('plans-selected-starter', 'plans-selected-pro', 'plans-selected-elite');
      table.classList.add('plans-selected-' + plan);
    }

    const continueBtn = document.getElementById('plans-continue-btn');
    if (continueBtn) {
      continueBtn.disabled = false;
      continueBtn.classList.remove('plans-continue-btn-disabled');
      // Always the plain monthly reference price here, regardless of
      // the Monthly/Yearly toggle above — the CTA is a stable "here's
      // roughly what this costs" anchor, not a restatement of
      // whatever the table happens to be showing.
      continueBtn.innerText = 'Continue with ' + PLANS[plan].name + ' — ' + formatRupees(PLANS[plan].monthly) + '/mo';
    }
  }
  window.selectPlan = selectPlan;

  function continueWithPlan() {
    if (!selectedPlan) return;
    try {
      if (window.Auth && typeof window.Auth.setPlan === 'function') {
        window.Auth.setPlan({ plan: selectedPlan, billingCycle });
      }
    } catch (err) {
      // Recording the plan choice is a nice-to-have in this
      // prototype, not a gate — don't block the trader from
      // continuing into the app just because it failed to save.
      console.error('Could not save plan choice: ' + err.message);
    }
    // plan-confirmed-page.js needs the plan name/price to render its
    // "Your Pro plan (₹999/mo) is now active" line — stashed here
    // since window.Auth.getSession() doesn't expose it.
    try {
      sessionStorage.setItem('1crtrader_confirmed_plan', JSON.stringify({
        plan: selectedPlan,
        name: PLANS[selectedPlan].name,
        monthly: PLANS[selectedPlan].monthly,
        billingCycle,
      }));
    } catch (err) {
      // Non-fatal — plan-confirmed-page.js falls back to generic text.
    }
    window.location.href = '/src/marketing/pages/plans/plan-confirmed-page.html';
  }
  window.continueWithPlan = continueWithPlan;

  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (typeof window.Auth === 'undefined') {
        showFatal('auth-service.js did not load (script 404 or blocked) — this page needs it to know who just signed up.');
        return;
      }

      // This page only makes sense right after signup, with a session
      // already set. No session means someone landed here directly —
      // send them to log in instead of showing a plan picker with
      // nothing to attach it to.
      if (!window.Auth.getSession()) {
        window.location.href = '/src/marketing/pages/auth/auth-page.html?view=login';
        return;
      }

      renderPrices();
    } catch (err) {
      showFatal('plans-page.js crashed during setup: ' + err.message);
    }
  });
})();
