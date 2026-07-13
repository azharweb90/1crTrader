/* ===========================================================
   VERIFY YOUR ACCOUNT page behavior — sits between signup and plan
   selection in the flow:

     register form (auth-page.js) -> verify-account-page.html (this)
       -> plans-page.html -> app-shell.html (onboarding step 1)

   auth-page.js's register submit handler stashes {email, phone} in
   sessionStorage (key below) right before redirecting here, since
   window.Auth.getSession() only exposes {name, email} — not phone —
   and this page needs both to mask/display them.

   PROTOTYPE NOTE: there is no real SMS/email delivery in this
   client-only mock (see auth-service.js's own header comment for the
   same caveat elsewhere). A 6-digit code is generated here and
   compared entirely in the browser — it is deliberately surfaced
   on-page (see #verify-dev-note) rather than pretending to have sent
   something the trader has no way to receive. A real backend must
   generate + deliver + verify this server-side before launch.
   =========================================================== */
(function () {

  const CONTACT_KEY = '1crtrader_verify_contact';
  const CODE_KEY = '1crtrader_verify_code';

  function showFatal(message) {
    console.error(message);
    const fatalEl = document.getElementById('verify-fatal-error');
    if (fatalEl) {
      fatalEl.innerText = message;
      fatalEl.classList.remove('hidden');
    }
  }

  const ICON_ALERT = '<svg class="auth-error-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  function showFieldError(message) {
    const errorEl = document.getElementById('verify-code-error');
    document.querySelectorAll('.verify-code-input').forEach(input => input.classList.add('auth-field-input-invalid'));
    if (!errorEl) return;
    errorEl.innerHTML = ICON_ALERT + '<span>' + message + '</span>';
    errorEl.classList.remove('hidden');
  }

  function clearFieldError() {
    const errorEl = document.getElementById('verify-code-error');
    document.querySelectorAll('.verify-code-input').forEach(input => input.classList.remove('auth-field-input-invalid'));
    if (!errorEl) return;
    errorEl.classList.add('hidden');
    errorEl.innerHTML = '';
  }

  function maskEmail(email) {
    const raw = String(email || '');
    const at = raw.indexOf('@');
    if (at < 1) return raw;
    const user = raw.slice(0, at);
    const domain = raw.slice(at + 1);
    const visible = user.slice(0, 2) || user;
    return visible + '***@' + domain;
  }

  function normalizePhoneDigits(phone) {
    return String(phone || '').replace(/[\s-]/g, '').replace(/^\+?91/, '').replace(/^0/, '');
  }

  function maskPhone(phone) {
    const digits = normalizePhoneDigits(phone);
    if (digits.length < 4) return digits;
    return digits.slice(0, 2) + '****' + digits.slice(-2);
  }

  function generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function goToPlans() {
    window.location.href = '/src/marketing/pages/plans/plans-page.html';
  }

  // ---------- Code box behavior ----------
  function getCodeInputs() {
    return Array.from(document.querySelectorAll('.verify-code-input'));
  }

  function currentCode() {
    return getCodeInputs().map(input => input.value).join('');
  }

  function updateSubmitState() {
    const submitBtn = document.getElementById('verify-submit-btn');
    if (!submitBtn) return;
    // Exactly 6 digits, nothing else — not just "6 characters", in
    // case any non-numeric value ever slipped past the keydown/input
    // filters (e.g. programmatic paste into a hidden field).
    const ready = /^[0-9]{6}$/.test(currentCode());
    submitBtn.disabled = !ready;
    submitBtn.classList.toggle('auth-submit-btn-disabled', !ready);
  }

  function wireCodeInputs() {
    const inputs = getCodeInputs();
    inputs.forEach((input, idx) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/[^0-9]/g, '').slice(0, 1);
        clearFieldError();
        updateSubmitState();
        if (input.value && idx < inputs.length - 1) {
          inputs[idx + 1].focus();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && idx > 0) {
          inputs[idx - 1].focus();
          return;
        }
        // Block anything that isn't a digit or a control/navigation
        // key at the keystroke itself — an OTP box has no business
        // accepting letters or symbols even momentarily, rather than
        // relying only on the 'input' handler to strip them after
        // the fact. Allows Ctrl/Cmd combos (copy/paste, select-all).
        const allowed = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'];
        if (e.ctrlKey || e.metaKey || allowed.includes(e.key)) return;
        if (!/^[0-9]$/.test(e.key)) {
          e.preventDefault();
        }
      });

      input.addEventListener('paste', (e) => {
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
        if (!pasted) return;
        e.preventDefault();
        pasted.slice(0, 6).split('').forEach((digit, i) => {
          if (inputs[i]) inputs[i].value = digit;
        });
        clearFieldError();
        updateSubmitState();
        const nextEmpty = inputs.find(i => !i.value);
        (nextEmpty || inputs[inputs.length - 1]).focus();
      });
    });
  }

  // ---------- Resend ----------
  function resendCode() {
    const code = generateCode();
    sessionStorage.setItem(CODE_KEY, code);
    renderDevNote(code);

    const resendBtn = document.getElementById('verify-resend-btn');
    if (resendBtn) {
      const original = 'Resend code';
      resendBtn.disabled = true;
      resendBtn.innerText = 'Code resent';
      window.setTimeout(() => {
        resendBtn.disabled = false;
        resendBtn.innerText = original;
      }, 2000);
    }

    getCodeInputs().forEach(input => { input.value = ''; });
    clearFieldError();
    updateSubmitState();
    const firstInput = getCodeInputs()[0];
    if (firstInput) firstInput.focus();
  }
  window.resendCode = resendCode;

  // Prototype-only convenience — the dev note showing the "sent" code
  // is easy to miss, and typing it by hand is friction that has
  // nothing to do with what this page is meant to demonstrate. Not
  // something a real backend would ever ship; drop this once codes
  // are actually delivered by email/SMS.
  function autofillCode() {
    const code = sessionStorage.getItem(CODE_KEY);
    if (!code) return;
    const inputs = getCodeInputs();
    code.split('').forEach((digit, i) => {
      if (inputs[i]) inputs[i].value = digit;
    });
    clearFieldError();
    updateSubmitState();
    const submitBtn = document.getElementById('verify-submit-btn');
    if (submitBtn) submitBtn.focus();
  }
  window.autofillCode = autofillCode;

  function renderDevNote(code) {
    const note = document.getElementById('verify-dev-note');
    if (note) {
      note.innerText = 'Prototype note: no SMS/email is actually sent here — your code is ' + code + '.';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (typeof window.Auth === 'undefined') {
        showFatal('auth-service.js did not load (script 404 or blocked) — account verification cannot work without it.');
        return;
      }

      // This page only makes sense right after signup, with a session
      // already set. No session means someone landed here directly.
      if (!window.Auth.getSession()) {
        window.location.href = '/src/marketing/pages/auth/auth-page.html?view=login';
        return;
      }

      let contact = {};
      try {
        contact = JSON.parse(sessionStorage.getItem(CONTACT_KEY)) || {};
      } catch (e) {
        contact = {};
      }

      const sub = document.getElementById('verify-sub');
      if (sub) {
        if (contact.email && contact.phone) {
          sub.innerHTML = 'We’ve sent a 6-digit code to <strong>' + maskEmail(contact.email) + '</strong> and <strong>+91 ' + maskPhone(contact.phone) + '</strong>. Enter it below — either copy works.';
        } else if (contact.email) {
          sub.innerHTML = 'We’ve sent a 6-digit code to <strong>' + maskEmail(contact.email) + '</strong>. Enter it below.';
        }
        // else: leave the generic fallback text already in the HTML.
      }

      // Reuse an in-flight code across a reload (e.g. trader hit
      // refresh) rather than silently invalidating whatever they were
      // just shown; only mint a fresh one if none exists yet.
      let code = sessionStorage.getItem(CODE_KEY);
      if (!code) {
        code = generateCode();
        sessionStorage.setItem(CODE_KEY, code);
      }
      renderDevNote(code);

      wireCodeInputs();
      updateSubmitState();
      const firstInput = getCodeInputs()[0];
      if (firstInput) firstInput.focus();

      const form = document.getElementById('verify-form');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const entered = currentCode();
          if (entered.length !== 6) return;
          const expected = sessionStorage.getItem(CODE_KEY);
          if (entered !== expected) {
            showFieldError('That code doesn’t match — check it and try again.');
            return;
          }
          sessionStorage.removeItem(CODE_KEY);
          sessionStorage.removeItem(CONTACT_KEY);
          goToPlans();
        });
      } else {
        showFatal('Could not find the verify form (#verify-form) in the page.');
      }
    } catch (err) {
      showFatal('verify-account-page.js crashed during setup: ' + err.message);
    }
  });
})();
