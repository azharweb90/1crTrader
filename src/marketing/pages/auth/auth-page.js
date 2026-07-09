/* ===========================================================
   LOGIN / SIGNUP page behavior. Reads ?view=login|register, swaps the
   left-panel copy + which form is visible, and wires both forms to
   window.Auth (auth-service.js, loaded just before this file).
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

  function showError(el, message) {
    if (!el) return;
    el.innerText = message;
    el.classList.remove('hidden');
  }

  function clearError(el) {
    if (!el) return;
    el.classList.add('hidden');
    el.innerText = '';
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

      const loginForm = document.getElementById('auth-login-form');
      const loginError = document.getElementById('login-error');
      if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
          e.preventDefault();
          try {
            clearError(loginError);
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            const result = window.Auth.logIn({ email, password });
            if (result.ok) {
              goToApp();
            } else {
              showError(loginError, result.error);
            }
          } catch (err) {
            showFatal('Log in failed: ' + err.message);
          }
        });
      } else {
        showFatal('Could not find the login form (#auth-login-form) in the page.');
      }

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