/* ===========================================================
   SHARED FORMATTERS — pure, stateless
   Extracted during a Phase 2 follow-up cleanup.

   fmt() was duplicated identically across 6 files (app-shell.js,
   daily-limits.js, dashboard-home.js, settings.js, roadmap.js,
   trading-journal.js, trade-manager.js) — none of them shared it, each
   had its own private copy of the exact same 1-line implementation.
   todayDateString() was duplicated in 2 files (app-shell.js and
   daily-limits.js, the latter explicitly commented as "kept self-
   contained rather than reaching into another component's closure" —
   which was true before this file existed, since fmt/todayDateString
   were never exposed on window before now).

   This file gives every feature one real shared copy instead. All 6+
   duplicate definitions have been removed from their original files;
   they now call these via the global scope (same window.X pattern the
   rest of the app already uses for its cross-file API surface).

   Loaded BEFORE app-shell.js and before any lazily-loaded feature file
   (see app-shell.html) so window.fmt / window.todayDateString /
   window.getInitials exist before anything tries to call them.
   =========================================================== */

(function () {

  function fmt(n) {
    return Math.round(n).toLocaleString('en-IN');
  }

  function todayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // Monday-start week bounds — the Indian trading week runs Mon–Fri, so
  // "this week" should start Monday, not Sunday. Added when the
  // Calculators feature needed a third "what week are we in" calculation
  // and it turned out two slightly different versions already existed:
  // trading-journal.js's local weekBounds() started the week on SUNDAY,
  // while dashboard-home.js's local mondayOf() (used by the Weekly Review
  // card) already started on Monday. Consolidated here as the one real
  // implementation — trading-journal.js's weekBounds() now delegates to
  // this instead of computing its own (slightly different) answer.
  // Returns { start, end } as Date objects: start at 00:00:00.000 Monday,
  // end at 23:59:59.999 the following Sunday.
  function getWeekBounds(d) {
    const ref = d ? new Date(d) : new Date();
    ref.setHours(0, 0, 0, 0);
    const day = ref.getDay(); // 0 Sun .. 6 Sat
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const start = new Date(ref);
    start.setDate(ref.getDate() + diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  window.fmt = fmt;
  window.todayDateString = todayDateString;
  window.getInitials = getInitials;
  window.getWeekBounds = getWeekBounds;

})();