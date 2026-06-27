/* ===========================================================
   1CRTRADER — MOCK AUTHENTICATION ENGINE
   PROTOTYPE ONLY. No real backend, no real network calls, no real
   password hashing or email/SMS delivery. Accounts are stored in this
   browser's localStorage only — clearing site data deletes them.

   This is the seam where a real implementation would call an actual
   auth API (Firebase Auth, Supabase Auth, a custom backend, etc.)
   instead. Nothing here should be mistaken for production-grade
   security — there is no salting, no real hashing, no rate limiting,
   and the OTP is shown directly on screen since there's no real
   email/SMS provider connected.

   Loaded by BOTH landing.html and index.html, so a session created on
   one page is recognized by the other.
   =========================================================== */

(function () {
  const ACCOUNTS_KEY = '1crtrader_accounts';   // { [email]: { name, phone, password, hasProfile } }
  const SESSION_KEY = '1crtrader_session';     // email of the currently logged-in account, or absent
  const OTP_KEY = '1crtrader_pending_otp';     // { email, code, expiresAt } during a password-reset flow

  // ---------- Storage helpers ----------
  function getAccounts() {
    try {
      return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveAccounts(accounts) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }

  function normalizeEmail(email) {
    return (email || '').trim().toLowerCase();
  }

  // ---------- Registration ----------
  // Returns { ok: true } on success, or { ok: false, error: string }.
  function registerAccount({ name, email, phone, password }) {
    const cleanEmail = normalizeEmail(email);
    if (!name || !cleanEmail || !password) {
      return { ok: false, error: 'Please fill in your name, email, and password.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { ok: false, error: 'Enter a valid email address.' };
    }
    if (password.length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters.' };
    }

    const accounts = getAccounts();
    if (accounts[cleanEmail]) {
      return { ok: false, error: 'An account with this email already exists. Try logging in instead.' };
    }

    accounts[cleanEmail] = {
      name: name.trim(),
      email: cleanEmail,
      phone: (phone || '').trim(),
      password: password, // PROTOTYPE ONLY — never store plaintext passwords in a real system
      hasProfile: false,  // flips to true once they complete the broker/manual setup flow
      createdAt: Date.now(),
    };
    saveAccounts(accounts);
    setSession(cleanEmail);
    return { ok: true };
  }

  // ---------- Login ----------
  function loginAccount({ email, password }) {
    const cleanEmail = normalizeEmail(email);
    const accounts = getAccounts();
    const account = accounts[cleanEmail];

    if (!account) {
      return { ok: false, error: 'No account found with this email. Try registering instead.' };
    }
    if (account.password !== password) {
      return { ok: false, error: 'Incorrect password. Try again, or reset your password below.' };
    }

    setSession(cleanEmail);
    return { ok: true, account };
  }

  // ---------- Session ----------
  function setSession(email) {
    localStorage.setItem(SESSION_KEY, normalizeEmail(email));
  }

  function getSession() {
    const email = localStorage.getItem(SESSION_KEY);
    if (!email) return null;
    const accounts = getAccounts();
    return accounts[email] || null;
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
  }

  function markProfileComplete(email) {
    const cleanEmail = normalizeEmail(email || localStorage.getItem(SESSION_KEY));
    const accounts = getAccounts();
    if (accounts[cleanEmail]) {
      accounts[cleanEmail].hasProfile = true;
      saveAccounts(accounts);
    }
  }

  // ---------- Password reset (forgot password -> OTP -> new password) ----------
  // PROTOTYPE ONLY: generates a 6-digit code and shows it directly on screen
  // (see requestPasswordReset's return value) since there's no real email/SMS
  // provider to deliver it through. A real implementation would email/SMS
  // this code instead of returning it to the caller.
  function requestPasswordReset(email) {
    const cleanEmail = normalizeEmail(email);
    const accounts = getAccounts();
    if (!accounts[cleanEmail]) {
      return { ok: false, error: 'No account found with this email.' };
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    localStorage.setItem(OTP_KEY, JSON.stringify({ email: cleanEmail, code, expiresAt }));

    return { ok: true, code, expiresAt };
  }

  function verifyOtp(email, enteredCode) {
    const cleanEmail = normalizeEmail(email);
    let pending;
    try {
      pending = JSON.parse(localStorage.getItem(OTP_KEY));
    } catch (e) {
      pending = null;
    }

    if (!pending || pending.email !== cleanEmail) {
      return { ok: false, error: 'No password reset in progress for this email. Start over.' };
    }
    if (Date.now() > pending.expiresAt) {
      return { ok: false, error: 'This code has expired. Request a new one.' };
    }
    if (pending.code !== String(enteredCode).trim()) {
      return { ok: false, error: 'Incorrect code. Check and try again.' };
    }

    return { ok: true };
  }

  function resetPassword(email, otpCode, newPassword) {
    const verify = verifyOtp(email, otpCode);
    if (!verify.ok) return verify;

    if (!newPassword || newPassword.length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters.' };
    }

    const cleanEmail = normalizeEmail(email);
    const accounts = getAccounts();
    if (!accounts[cleanEmail]) {
      return { ok: false, error: 'Account no longer exists.' };
    }

    accounts[cleanEmail].password = newPassword;
    saveAccounts(accounts);
    localStorage.removeItem(OTP_KEY); // one-time use — consumed on successful reset

    return { ok: true };
  }

  // ---------- Exposed API ----------
  window.Auth = {
    registerAccount,
    loginAccount,
    getSession,
    logout,
    markProfileComplete,
    requestPasswordReset,
    verifyOtp,
    resetPassword,
  };
})();