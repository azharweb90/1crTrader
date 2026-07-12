/* ===========================================================
   TERMS OF SERVICE / PRIVACY POLICY page behavior. Reads ?doc=terms|
   privacy to decide which document shows first (linked from
   auth-page.js's footer), and toggles between the two via the tab
   control — both documents live in the DOM at once, swapped with a
   class rather than re-fetched, so switching is instant.
   =========================================================== */
(function () {

  function getInitialDoc() {
    const params = new URLSearchParams(window.location.search);
    return params.get('doc') === 'privacy' ? 'privacy' : 'terms';
  }

  function setLegalDoc(doc) {
    const termsBtn = document.getElementById('legal-doc-terms-btn');
    const privacyBtn = document.getElementById('legal-doc-privacy-btn');
    const termsDoc = document.getElementById('legal-doc-terms');
    const privacyDoc = document.getElementById('legal-doc-privacy');

    if (termsBtn) termsBtn.classList.toggle('active', doc === 'terms');
    if (privacyBtn) privacyBtn.classList.toggle('active', doc === 'privacy');
    if (termsDoc) termsDoc.classList.toggle('hidden', doc !== 'terms');
    if (privacyDoc) privacyDoc.classList.toggle('hidden', doc !== 'privacy');

    document.title = doc === 'privacy' ? '1Cr Traders — Privacy Policy' : '1Cr Traders — Terms of Service';
    window.scrollTo(0, 0);
  }
  window.setLegalDoc = setLegalDoc;

  // Prefers real browser history (so "Back" returns to wherever the
  // trader actually came from, login or register view intact) and only
  // falls back to a hardcoded destination if this page was opened
  // directly (no history to go back to — e.g. a bookmark or new tab).
  function legalGoBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/src/marketing/pages/auth/auth-page.html?view=login';
    }
  }
  window.legalGoBack = legalGoBack;

  document.addEventListener('DOMContentLoaded', () => {
    setLegalDoc(getInitialDoc());
  });
})();
