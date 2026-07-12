/* ===========================================================
   LOGIN / SIGNUP page behavior. Reads ?view=login|register, swaps the
   left-panel copy + which form is visible, and wires both forms to
   window.Auth (auth-service.js, loaded just before this file).

   The login form supports two methods (Email / Mobile Number) via a
   tab toggle, each with its own field + validation — but note only
   EMAIL actually authenticates right now. auth-service.js (the mock,
   client-only version — see its own header comment) has no concept of
   phone-based accounts; that's real backend work for later. Picking
   the Mobile Number tab and submitting shows an honest "not available
   yet" message rather than silently failing or pretending to work.
   =========================================================== */
(function () {

  const VIEWS = {
    login: {
      title: '1Cr Traders — Log in',
      eyebrow: 'REWARD ABOVE RISK',
      headline: 'The one edge that compounds is control.',
    },
    register: {
      title: '1Cr Traders — Sign up',
      eyebrow: 'YOUR FREE TRIAL',
      headline: 'Build the habit that keeps your account alive.',
    },
  };

  let loginMethod = 'email'; // 'email' | 'phone'

  function getView() {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'register' ? 'register' : 'login';
  }

  function applyView(view) {
    const copy = VIEWS[view];
    const eyebrowEl = document.getElementById('auth-eyebrow');
    const headlineEl = document.getElementById('auth-headline');
    if (eyebrowEl) eyebrowEl.innerText = copy.eyebrow;
    if (headlineEl) headlineEl.innerText = copy.headline;
    document.title = copy.title;

    const loginForm = document.getElementById('auth-login-form');
    const registerForm = document.getElementById('auth-register-form');
    if (loginForm) loginForm.classList.toggle('hidden', view !== 'login');
    if (registerForm) registerForm.classList.toggle('hidden', view !== 'register');
  }

  // ---------- Generic (non-field) error paragraph — plain text, no icon ----------
  function showError(el, message) {
    if (!el) return;
    el.innerText = message;
    el.classList.remove('hidden');
  }

  function clearError(el) {
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('auth-error-info');
    el.innerText = '';
  }

  // ---------- Field-level error — red border on the input + icon message ----------
  const ICON_ALERT = '<svg class="auth-error-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  // Neutral (blue) variant of showError — for things that aren't a
  // mistake the trader made, like a feature not being available yet.
  // Reuses the same icon+text row as a field error, just recolored
  // via .auth-error-info, so it still reads as "read this" without
  // implying they did something wrong.
  function showInfoNote(el, message) {
    if (!el) return;
    el.innerHTML = ICON_ALERT + '<span>' + message + '</span>';
    el.classList.add('auth-error-info');
    el.classList.remove('hidden');
  }

  function showFieldError(inputEl, errorEl, message) {
    if (inputEl) inputEl.classList.add('auth-field-input-invalid');
    if (!errorEl) return;
    errorEl.innerHTML = ICON_ALERT + '<span>' + message + '</span>';
    errorEl.classList.remove('hidden');
  }

  function clearFieldError(inputEl, errorEl) {
    if (inputEl) inputEl.classList.remove('auth-field-input-invalid');
    if (!errorEl) return;
    errorEl.classList.add('hidden');
    errorEl.innerHTML = '';
  }

  // ---------- Checkbox-style field error (Terms/Privacy consent) ----------
  // Same icon+message pattern as showFieldError/clearFieldError, but
  // the red-border target is the visible .auth-checkbox-box sibling
  // rather than the (visually hidden) checkbox input itself.
  function showCheckboxError(boxEl, errorEl, message) {
    if (boxEl) boxEl.classList.add('auth-checkbox-box-invalid');
    if (!errorEl) return;
    errorEl.innerHTML = ICON_ALERT + '<span>' + message + '</span>';
    errorEl.classList.remove('hidden');
  }

  function clearCheckboxError(boxEl, errorEl) {
    if (boxEl) boxEl.classList.remove('auth-checkbox-box-invalid');
    if (!errorEl) return;
    errorEl.classList.add('hidden');
    errorEl.innerHTML = '';
  }

  // Surfaces ANY uncaught error on-page instead of failing silently —
  // "nothing happens when I click the button" is exactly what a
  // swallowed JS exception looks like to someone without DevTools open,
  // so every handler below is wrapped to report through here instead.
  function showFatal(message) {
    console.error(message);
    const fatalEl = document.getElementById('auth-fatal-error');
    if (fatalEl) {
      fatalEl.innerText = message;
      fatalEl.classList.remove('hidden');
    }
  }

  // Same destination app-shell.js's own auth gate expects (see
  // DOMContentLoaded there) — landing here with a fresh session means
  // the first-run onboarding modal (onboarding.js) picks up
  // automatically since hasOnboarded() is still false for a new account.
  function goToApp() {
    window.location.href = '/src/app/app-shell.html';
  }

  // ---------- Validators ----------
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validateEmail(value) {
    const v = (value || '').trim();
    if (!v) return 'Email is required.';
    if (!EMAIL_RE.test(v)) return 'Enter a valid email address.';
    return null;
  }

  function validatePhone(value) {
    const digits = String(value || '').replace(/[\s-]/g, '').replace(/^\+?91/, '').replace(/^0/, '');
    if (!digits) return 'Mobile number is required.';
    if (!/^[6-9][0-9]{9}$/.test(digits)) return 'Enter a valid 10-digit Indian mobile number.';
    return null;
  }

  function validatePasswordRequired(value) {
    if (!value) return 'Password is required.';
    return null;
  }

  // Stricter check used on the SIGN-UP form (login just needs "not empty").
  function validateNewPassword(value) {
    if (!value) return 'Enter a password.';
    if (value.length < 8) return 'Password must be at least 8 characters.';
    return null;
  }

  // ---------- Login method toggle (Email / Mobile Number) ----------
  function setLoginMethod(method) {
    loginMethod = method;
    const emailBtn = document.getElementById('login-method-email-btn');
    const phoneBtn = document.getElementById('login-method-phone-btn');
    const emailWrap = document.getElementById('login-email-field-wrap');
    const phoneWrap = document.getElementById('login-phone-field-wrap');
    if (emailBtn) emailBtn.classList.toggle('active', method === 'email');
    if (phoneBtn) phoneBtn.classList.toggle('active', method === 'phone');
    if (emailWrap) emailWrap.classList.toggle('hidden', method !== 'email');
    if (phoneWrap) phoneWrap.classList.toggle('hidden', method !== 'phone');

    // Switching tabs shouldn't leave a stale error visible — not just
    // on the identifier field that's now hidden, but also on anything
    // shared across both tabs (password, Terms checkbox), which would
    // otherwise keep showing an error left over from the other tab's
    // failed attempt.
    clearFieldError(document.getElementById('login-email'), document.getElementById('login-email-error'));
    clearFieldError(document.getElementById('login-phone'), document.getElementById('login-phone-error'));
    clearFieldError(document.getElementById('login-password'), document.getElementById('login-password-error'));
    const loginTermsInput = document.getElementById('login-terms');
    clearCheckboxError(loginTermsInput ? loginTermsInput.nextElementSibling : null, document.getElementById('login-terms-error'));
    const loginError = document.getElementById('login-error');
    clearError(loginError);

    // Tell the trader mobile login isn't wired up yet the moment they
    // pick the tab — not after they've filled in a number and a
    // password and hit submit only to be turned away. Neutral/blue,
    // not a red validation error, since nothing they did is wrong.
    if (method === 'phone') {
      showInfoNote(loginError, 'Mobile number login isn’t available yet — please continue with email for now.');
    }
  }
  window.setLoginMethod = setLoginMethod;

  // ---------- Password show/hide ----------
  const ICON_EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.8 21.8 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a21.8 21.8 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function initPasswordIcons() {
    document.querySelectorAll('[id$="-password-toggle"]').forEach(btn => {
      btn.innerHTML = ICON_EYE;
    });
  }

  function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    if (btn) {
      btn.innerHTML = showing ? ICON_EYE : ICON_EYE_OFF;
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    }
  }
  window.togglePasswordVisibility = togglePasswordVisibility;

  // ---------- Google continue (UI only — no backend wired up yet) ----------
  function handleGoogleContinue() {
    const note = document.getElementById('login-google-note');
    if (note) {
      note.innerText = 'Google sign-in isn’t connected yet — use email or mobile number for now.';
      note.classList.remove('hidden');
    }
  }
  window.handleGoogleContinue = handleGoogleContinue;

  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (typeof window.Auth === 'undefined') {
        showFatal('auth-service.js did not load (script 404 or blocked) — login/signup cannot work without it. Check the Network tab for a failed request to /src/marketing/services/auth-service.js.');
        return;
      }

      // Already logged in — no reason to show the form again.
      if (window.Auth.getSession()) {
        goToApp();
        return;
      }

      applyView(getView());
      initPasswordIcons();

      // ---------- Login form ----------
      const loginForm = document.getElementById('auth-login-form');
      const loginError = document.getElementById('login-error');

      const loginEmailInput = document.getElementById('login-email');
      const loginEmailError = document.getElementById('login-email-error');
      const loginPhoneInput = document.getElementById('login-phone');
      const loginPhoneError = document.getElementById('login-phone-error');
      const loginPasswordInput = document.getElementById('login-password');
      const loginPasswordError = document.getElementById('login-password-error');

      function checkLoginIdentifier() {
        if (loginMethod === 'phone') {
          const message = validatePhone(loginPhoneInput ? loginPhoneInput.value : '');
          if (message) showFieldError(loginPhoneInput, loginPhoneError, message);
          else clearFieldError(loginPhoneInput, loginPhoneError);
          return message;
        }
        const message = validateEmail(loginEmailInput ? loginEmailInput.value : '');
        if (message) showFieldError(loginEmailInput, loginEmailError, message);
        else clearFieldError(loginEmailInput, loginEmailError);
        return message;
      }

      function checkLoginPassword() {
        const message = validatePasswordRequired(loginPasswordInput ? loginPasswordInput.value : '');
        if (message) showFieldError(loginPasswordInput, loginPasswordError, message);
        else clearFieldError(loginPasswordInput, loginPasswordError);
        return message;
      }

      // ---------- Terms/Privacy consent checkbox ----------
      const loginTermsInput = document.getElementById('login-terms');
      const loginTermsBox = loginTermsInput ? loginTermsInput.nextElementSibling : null;
      const loginTermsError = document.getElementById('login-terms-error');

      function checkLoginTerms() {
        if (loginTermsInput && !loginTermsInput.checked) {
          showCheckboxError(loginTermsBox, loginTermsError, 'Please agree to the Terms of Service and Privacy Policy to continue.');
          return 'required';
        }
        clearCheckboxError(loginTermsBox, loginTermsError);
        return null;
      }

      if (loginTermsInput) {
        loginTermsInput.addEventListener('change', () => {
          if (loginTermsInput.checked) clearCheckboxError(loginTermsBox, loginTermsError);
        });
      }

      [loginEmailInput, loginPhoneInput, loginPasswordInput].forEach(input => {
        if (!input) return;
        input.addEventListener('blur', () => {
          if (input === loginPasswordInput) checkLoginPassword();
          else checkLoginIdentifier();
        });
        input.addEventListener('input', () => {
          if (input.classList.contains('auth-field-input-invalid')) {
            if (input === loginPasswordInput) checkLoginPassword();
            else checkLoginIdentifier();
          }
        });
      });

      if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
          e.preventDefault();

          if (loginMethod === 'phone') {
            // Honest placeholder — the mock auth-service.js has no
            // phone-based accounts yet (that's separate backend work).
            // Already shown as soon as the tab was picked (see
            // setLoginMethod); no point running email/password field
            // validation for a submit that can never succeed, so just
            // re-affirm the note and stop.
            showInfoNote(loginError, 'Mobile number login isn’t available yet — please continue with email for now.');
            return;
          }

          clearError(loginError);
          const identifierMsg = checkLoginIdentifier();
          const passwordMsg = checkLoginPassword();
          const termsMsg = checkLoginTerms();
          if (identifierMsg || passwordMsg || termsMsg) return;

          const submitBtn = loginForm.querySelector('button[type="submit"]');
          try {
            if (submitBtn) submitBtn.disabled = true;
            const email = loginEmailInput.value;
            const password = loginPasswordInput.value;
            const result = window.Auth.logIn({ email, password });
            if (result.ok) {
              goToApp();
            } else {
              showError(loginError, result.error);
            }
          } catch (err) {
            showFatal('Log in failed: ' + err.message);
          } finally {
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      } else {
        showFatal('Could not find the login form (#auth-login-form) in the page.');
      }

      // ---------- Register form ----------
      const registerForm = document.getElementById('auth-register-form');
      const registerError = document.getElementById('register-error');
      if (registerForm) {
        registerForm.addEventListener('submit', (e) => {
          e.preventDefault();
          try {
            clearError(registerError);
            const name = document.getElementById('register-name').value;
            const email = document.getElementById('register-email').value;
            const password = document.getElementById('register-password').value;
            const result = window.Auth.signUp({ name, email, password });
            if (result.ok) {
              goToApp();
            } else {
              showError(registerError, result.error);
            }
          } catch (err) {
            showFatal('Create account failed: ' + err.message);
          }
        });
      } else {
        showFatal('Could not find the signup form (#auth-register-form) in the page.');
      }
    } catch (err) {
      showFatal('auth-page.js crashed during setup: ' + err.message);
    }
  });
})();
