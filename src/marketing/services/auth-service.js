/* ===========================================================
   MOCK AUTH SERVICE — prototype only, no real backend.

   Exposes window.Auth, the exact contract app-shell.js and
   settings.js already reference (they were written expecting this
   file to exist — see the "typeof window.Auth" guards in both):
     - getSession()        -> { name, email } | null
     - logout()
     - markProfileComplete()
     - signUp({name,email,phone,password}) -> { ok, error? } [new, this page]
     - logIn({email,password})       -> { ok, error? }   [new, this page]
     - accountExists(identifier)     -> boolean          [forgot-password-page.js]
     - resetPassword({identifier,newPassword}) -> { ok, error? } [forgot-password-page.js]
       (identifier is an email OR the mobile number stored at signup —
       see findAccountByIdentifier())

   Accounts + session persisted to localStorage ONLY. Passwords are
   stored in plain text in that same localStorage record — acceptable
   ONLY because this is a client-only prototype with no server; this
   file must be replaced by a real auth API client before any of this
   touches real user data.
   =========================================================== */
(function () {
  const ACCOUNTS_KEY = '1crtrader_accounts';
  const SESSION_KEY = '1crtrader_session';

  function loadAccounts() {
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
    return String(email || '').trim().toLowerCase();
  }

  function normalizePhone(phone) {
    return String(phone || '').replace(/[\s-]/g, '').replace(/^\+?91/, '').replace(/^0/, '');
  }

  // The forgot-password page takes a single "email or mobile number"
  // field (see its header comment) — this resolves either shape to
  // the matching account, or null. Used by accountExists() and
  // resetPassword() below.
  function findAccountByIdentifier(identifier) {
    const raw = String(identifier || '').trim();
    if (!raw) return null;
    const accounts = loadAccounts();
    if (raw.includes('@')) {
      return accounts[normalizeEmail(raw)] || null;
    }
    const digits = normalizePhone(raw);
    if (!digits) return null;
    const match = Object.keys(accounts).find(key => accounts[key].phone && normalizePhone(accounts[key].phone) === digits);
    return match ? accounts[match] : null;
  }

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (e) {
      return null;
    }
  }

  function setSession(account) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      name: account.name,
      email: account.email,
    }));
  }

  // `phone` is optional and stored as-given (raw 10 digits — the +91
  // prefix on the register form is a display-only chip, see
  // auth-page.css/.js) purely for record-keeping; there's no
  // phone-based login yet (see logIn's header note), so it isn't
  // validated or used to authenticate here.
  function signUp({ name, email, phone, password }) {
    const key = normalizeEmail(email);
    if (!name || !name.trim() || !key || !password) {
      return { ok: false, error: 'Fill in your name, email and password.' };
    }
    if (password.length < 8) {
      return { ok: false, error: 'Password must be at least 8 characters.' };
    }
    const accounts = loadAccounts();
    if (accounts[key]) {
      return { ok: false, error: 'An account with that email already exists — log in instead.' };
    }
    accounts[key] = {
      name: name.trim(),
      email: key,
      phone: phone ? String(phone).trim() : '',
      password, // prototype only — see file header
      profileComplete: false,
      createdAt: new Date().toISOString(),
    };
    saveAccounts(accounts);
    setSession(accounts[key]);
    return { ok: true };
  }

  function logIn({ email, password }) {
    const key = normalizeEmail(email);
    if (!key || !password) {
      return { ok: false, error: 'Enter your email and password.' };
    }
    const accounts = loadAccounts();
    const account = accounts[key];
    if (!account) {
      return { ok: false, error: 'No account found with that email — create one instead.' };
    }
    if (account.password !== password) {
      return { ok: false, error: 'Incorrect password.' };
    }
    setSession(account);
    return { ok: true };
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
  }

  // Used by forgot-password-page.js's step 1 to confirm there's an
  // account before letting the trader move on to setting a new
  // password. A real backend would never expose this directly (email
  // enumeration risk) — it would always reply "check your email/phone"
  // and do the existence check server-side. Fine for this client-only
  // prototype; must not carry over as-is once a real backend exists.
  function accountExists(identifier) {
    return !!findAccountByIdentifier(identifier);
  }

  // Used by forgot-password-page.js's step 2. No token/session check
  // here (see that file's header comment) — this prototype has no
  // real email/SMS delivery, so there's nothing to verify against
  // besides the account existing.
  function resetPassword({ identifier, newPassword }) {
    if (!identifier || !newPassword) {
      return { ok: false, error: 'Missing email/mobile number or new password.' };
    }
    if (newPassword.length < 8) {
      return { ok: false, error: 'Password must be at least 8 characters.' };
    }
    const account = findAccountByIdentifier(identifier);
    if (!account) {
      return { ok: false, error: 'No account found with that email or mobile number.' };
    }
    const accounts = loadAccounts();
    accounts[account.email].password = newPassword; // prototype only — see file header
    saveAccounts(accounts);
    return { ok: true };
  }

  // Called by app-shell.js's confirmProfile() once the "Set Up Your
  // Profile" page is confirmed. Purely informational in this prototype
  // (the profile's actual data — tier, capital, instruments — still
  // lives in-memory only and resets on reload, same caveat as the rest
  // of the app); this just records that the account has been through
  // setup at least once.
  function markProfileComplete() {
    const session = getSession();
    if (!session) return;
    const accounts = loadAccounts();
    const account = accounts[normalizeEmail(session.email)];
    if (account) {
      account.profileComplete = true;
      saveAccounts(accounts);
    }
  }

  window.Auth = {
    signUp,
    logIn,
    logout,
    getSession,
    markProfileComplete,
    accountExists,
    resetPassword,
  };
})();