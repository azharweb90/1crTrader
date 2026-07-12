/* ===========================================================
   FORGOT PASSWORD page behavior. Three steps, all mounted in the DOM
   at once and toggled by class (same pattern as auth-page.js's
   login/register swap, legal-page.js's terms/privacy swap):

     1. fp-step-email  — confirm the account's email exists
     2. fp-step-reset  — set + confirm a new password
     3. fp-step-done   — success, link back to login

   Talks to the mock window.Auth (auth-service.js) via
   accountExists(email) and resetPassword({email, newPassword}). Since
   this prototype has no real email delivery, there is no token/link
   step — moving from step 1 to step 2 happens immediately once the
   email is confirmed to exist. That is an intentional, honest
   shortcut for local testing; a real backend will replace this with
   an emailed, time-limited reset link before anything here reaches
   production.
   =========================================================== */
(function () {

  let resetEmail = '';

  function showFatal(message) {
    console.error(message);
    const fatalEl = document.getElementById('fp-fatal-error');
    if (fatalEl) {
      fatalEl.innerText = message;
      fatalEl.classList.remove('hidden');
    }
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

  const ICON_ALERT = '<svg class="auth-error-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validateEmail(value) {
    const v = (value || '').trim();
    if (!v) return 'Email is required.';
    if (!EMAIL_RE.test(v)) return 'Enter a valid email address.';
    return null;
  }

  function validateNewPassword(value) {
    if (!value) return 'Enter a password.';
    if (value.length < 8) return 'Password must be at least 8 characters.';
    return null;
  }

  // ---------- Password show/hide (same icon pattern as auth-page.js) ----------
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

  // ---------- Step navigation ----------
  function showStep(step) {
    document.getElementById('fp-step-email').classList.toggle('hidden', step !== 'email');
    document.getElementById('fp-step-reset').classList.toggle('hidden', step !== 'reset');
    document.getElementById('fp-step-done').classList.toggle('hidden', step !== 'done');
  }

  function fpBackToEmail() {
    resetEmail = '';
    const newPasswordInput = document.getElementById('fp-new-password');
    const confirmPasswordInput = document.getElementById('fp-confirm-password');
    if (newPasswordInput) newPasswordInput.value = '';
    if (confirmPasswordInput) confirmPasswordInput.value = '';
    clearFieldError(newPasswordInput, document.getElementById('fp-new-password-error'));
    clearFieldError(confirmPasswordInput, document.getElementById('fp-confirm-password-error'));
    showStep('email');
  }
  window.fpBackToEmail = fpBackToEmail;

  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (typeof window.Auth === 'undefined') {
        showFatal('auth-service.js did not load (script 404 or blocked) — password reset cannot work without it.');
        return;
      }

      initPasswordIcons();

      // ---------- Step 1: email ----------
      const emailForm = document.getElementById('fp-step-email');
      const emailInput = document.getElementById('fp-email');
      const emailError = document.getElementById('fp-email-error');

      emailInput.addEventListener('input', () => {
        if (emailInput.classList.contains('auth-field-input-invalid')) {
          clearFieldError(emailInput, emailError);
        }
      });

      emailForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = validateEmail(emailInput.value);
        if (message) {
          showFieldError(emailInput, emailError, message);
          return;
        }
        if (!window.Auth.accountExists(emailInput.value)) {
          showFieldError(emailInput, emailError, 'No account found with that email.');
          return;
        }
        clearFieldError(emailInput, emailError);
        resetEmail = emailInput.value.trim();
        const sub = document.getElementById('fp-reset-sub');
        if (sub) sub.innerText = 'Choose a new password for ' + resetEmail + '.';
        showStep('reset');
        const newPasswordInput = document.getElementById('fp-new-password');
        if (newPasswordInput) newPasswordInput.focus();
      });

      // ---------- Step 2: new password ----------
      const resetForm = document.getElementById('fp-step-reset');
      const newPasswordInput = document.getElementById('fp-new-password');
      const newPasswordError = document.getElementById('fp-new-password-error');
      const confirmPasswordInput = document.getElementById('fp-confirm-password');
      const confirmPasswordError = document.getElementById('fp-confirm-password-error');

      [newPasswordInput, confirmPasswordInput].forEach(input => {
        input.addEventListener('input', () => {
          if (input.classList.contains('auth-field-input-invalid')) {
            if (input === newPasswordInput) checkNewPassword();
            else checkConfirmPassword();
          }
        });
      });

      function checkNewPassword() {
        const message = validateNewPassword(newPasswordInput.value);
        if (message) showFieldError(newPasswordInput, newPasswordError, message);
        else clearFieldError(newPasswordInput, newPasswordError);
        return message;
      }

      function checkConfirmPassword() {
        if (!confirmPasswordInput.value) {
          showFieldError(confirmPasswordInput, confirmPasswordError, 'Confirm your new password.');
          return 'Confirm your new password.';
        }
        if (confirmPasswordInput.value !== newPasswordInput.value) {
          showFieldError(confirmPasswordInput, confirmPasswordError, 'Passwords don’t match.');
          return 'Passwords don’t match.';
        }
        clearFieldError(confirmPasswordInput, confirmPasswordError);
        return null;
      }

      resetForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const newMsg = checkNewPassword();
        const confirmMsg = checkConfirmPassword();
        if (newMsg || confirmMsg) return;

        const submitBtn = resetForm.querySelector('button[type="submit"]');
        try {
          if (submitBtn) submitBtn.disabled = true;
          const result = window.Auth.resetPassword({ email: resetEmail, newPassword: newPasswordInput.value });
          if (result.ok) {
            showStep('done');
          } else {
            showFieldError(newPasswordInput, newPasswordError, result.error);
          }
        } catch (err) {
          showFatal('Resetting your password failed: ' + err.message);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    } catch (err) {
      showFatal('forgot-password-page.js crashed during setup: ' + err.message);
    }
  });
})();
