/* ===========================================================
   COMPONENT: learn / Knowledge Area (logic)
   Loaded lazily by app-shell.js the first time this tab opens.

   Replaces the old separate Education, Books and Suggestions tabs with
   one tab, three sub-tabs — per the revamped UX design. Content below is
   the same sample/curated data from that design (swap in real videos,
   books and copy whenever ready; the tab switching, category filtering
   and detail-drawer layout don't need to change).
   =========================================================== */

(function () {

  const VIDEOS = [
    { title: "Building a Rules-Based Trading Plan", author: "1Cr Academy", cat: "Foundations", len: "18 min", level: "Beginner", tag: "Start here", hue: 214, watched: true },
    { title: "Position Sizing & Risk per Trade", author: "Anish Mehta", cat: "Risk", len: "24 min", level: "Beginner", tag: "", hue: 150, watched: true },
    { title: "Reading Market Structure Live", author: "1Cr Academy", cat: "Technicals", len: "32 min", level: "Intermediate", tag: "", hue: 262, watched: false },
    { title: "The Psychology of Cutting Losses", author: "Dr. Reena Kapoor", cat: "Psychology", len: "21 min", level: "All levels", tag: "Popular", hue: 24, watched: false },
    { title: "Opening Range Breakout, Step by Step", author: "Anish Mehta", cat: "Strategies", len: "27 min", level: "Intermediate", tag: "", hue: 200, watched: false },
    { title: "Journaling Trades That Actually Improves You", author: "1Cr Academy", cat: "Discipline", len: "15 min", level: "All levels", tag: "New", hue: 340, watched: false },
    { title: "VWAP & Volume Profile for Intraday", author: "Karthik R.", cat: "Technicals", len: "29 min", level: "Advanced", tag: "", hue: 262, watched: false },
    { title: "Recovering After a Losing Streak", author: "Dr. Reena Kapoor", cat: "Psychology", len: "19 min", level: "All levels", tag: "", hue: 24, watched: false },
  ];

  const BOOKS = [
    { title: "Trading in the Zone", author: "Mark Douglas", cat: "Psychology", pages: 240, rating: "4.6", tag: "Essential", hue: 24 },
    { title: "Reminiscences of a Stock Operator", author: "Edwin Lefèvre", cat: "Classics", pages: 300, rating: "4.5", tag: "", hue: 200 },
    { title: "The Disciplined Trader", author: "Mark Douglas", cat: "Psychology", pages: 280, rating: "4.4", tag: "", hue: 24 },
    { title: "Technical Analysis of the Financial Markets", author: "John J. Murphy", cat: "Technicals", pages: 576, rating: "4.7", tag: "Reference", hue: 262 },
    { title: "Market Wizards", author: "Jack D. Schwager", cat: "Interviews", pages: 512, rating: "4.6", tag: "", hue: 150 },
    { title: "The Daily Trading Coach", author: "Brett N. Steenbarger", cat: "Psychology", pages: 352, rating: "4.5", tag: "Popular", hue: 24 },
  ];

  const SUG_DATA = [
    { cat: "Psychology", hue: 340, items: [
      { title: "Don't take random entries", body: "Trading without a plan doesn't just risk your capital — it wears down your psychology too, and a rattled mind tends to make the next decision worse, not better. A trade you can't explain in one sentence before entering usually isn't one you should take." },
      { title: "Revenge trading rarely recovers the loss", body: "After a loss, the urge to 'win it back' pushes you into oversized, unplanned trades — the exact conditions that created the loss. The market doesn't owe you a recovery. Step away, reset, and return to your rules tomorrow." },
      { title: "FOMO entries put you in at the worst price", body: "By the time a move feels impossible to miss, most of it has already happened. Chasing green candles means buying where late money buys — right before the pullback. If you missed the entry, let it go; there is always another setup." },
      { title: "A losing streak doesn't mean you're a bad trader", body: "Even a positive-expectancy system has losing runs — it's statistics, not a verdict on your skill. What matters is that you sized each trade so the streak can't take you out. Judge yourself on process adherence, not a short run of outcomes." },
    ] },
    { cat: "Risk Management", hue: 150, items: [
      { title: "Holding an option position overnight carries gap risk", body: "News, global markets and events move prices while you sleep — and options can gap far past your stop. If you must hold overnight, size it as if the stop may not fill where you expect." },
      { title: "Stop-loss isn't optional", body: "A stop is the one thing standing between a normal loss and an account-ending one. 'It'll come back' is how small losses become disasters. Decide your exit before you enter, and honour it without negotiation." },
      { title: "Position sizing matters more than entry timing", body: "You can be right on direction and still blow up if the size is wrong. Risk a fixed small percentage per trade so no single loss hurts. Survival first — good entries only compound if you're still in the game." },
      { title: "Daily loss limits exist to protect tomorrow, not just today", body: "A hard daily stop caps the damage on your worst days, when judgment is already impaired. Hitting the limit and walking away keeps your capital and your confidence intact for the next session." },
    ] },
    { cat: "Options-Specific", hue: 200, items: [
      { title: "Expiry-day \"zero hero\" trades are a common way to breach your daily limit", body: "Deep OTM options on expiry are cheap for a reason — they usually expire worthless. The lottery-ticket payoff tempts oversizing, and a string of zeros quietly eats your daily limit. Treat them as speculation, not strategy." },
      { title: "Theta decay works against option buyers every single day", body: "Every day you hold a long option, time value bleeds out — faster as expiry nears. You need the move to happen soon and with size, not eventually. If your thesis is slow, buying options is the wrong vehicle." },
      { title: "Uncovered option selling carries undefined risk", body: "Naked selling can lose far more than the premium collected — a single gap can wipe out months of small gains. Define your risk with spreads or hedges; never let one position threaten the whole account." },
      { title: "Implied volatility can move independently of price direction", body: "You can be right on direction and still lose if IV collapses (a 'vol crush' after events). Understand what volatility you're paying for before an event, and don't assume a correct call guarantees a profit." },
    ] },
  ];
  const SUG_FLAT = [];
  SUG_DATA.forEach(g => g.items.forEach(it => SUG_FLAT.push({ ...it, cat: g.cat, hue: g.hue })));

  const TAG_COLORS = {
    "Start here": ["#15803D", "#E7F6EC", "#BFE6CB"],
    "Popular": ["#0D9488", "#E6F7F5", "#BFEAE4"],
    "New": ["#2563EB", "#EAF1FE", "#CFE0FB"],
    "Essential": ["#C53D22", "#FCEEE9", "#F3D3C8"],
    "Reference": ["#6D28D9", "#F1EBFE", "#DDD0FA"],
  };

  let activeTab = "videos";
  let activeCat = "all";

  function tagStyle(tag) {
    if (!tag) return "display:none;";
    const c = TAG_COLORS[tag] || ["#5B6B82", "#F1F4F8", "#E3E9F1"];
    return `color:${c[0]}; background:${c[1]}; border:1px solid ${c[2]};`;
  }

  function catsFor(tab) {
    if (tab === "videos") return ["all", ...Array.from(new Set(VIDEOS.map(v => v.cat)))];
    if (tab === "books") return ["all", ...Array.from(new Set(BOOKS.map(b => b.cat)))];
    return [];
  }

  function setLearnTab(tab) {
    activeTab = tab;
    activeCat = "all";
    render();
  }

  function setLearnCat(cat) {
    activeCat = cat;
    render();
  }

  function renderTabBar() {
    document.querySelectorAll(".learn-tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.learnTab === activeTab);
    });
    const vc = document.getElementById("learn-video-count");
    const bc = document.getElementById("learn-book-count");
    const sc = document.getElementById("learn-sug-count");
    if (vc) vc.innerText = VIDEOS.length;
    if (bc) bc.innerText = BOOKS.length;
    if (sc) sc.innerText = SUG_FLAT.length;
  }

  function renderChips() {
    const row = document.getElementById("learn-chip-row");
    if (!row) return;
    const cats = catsFor(activeTab);
    if (cats.length === 0) { row.innerHTML = ""; return; }
    row.innerHTML = cats.map(c => `
      <button type="button" class="learn-chip ${c === activeCat ? "active" : ""}" onclick="setLearnCat('${c.replace(/'/g, "\\'")}')">${c === "all" ? "All" : c}</button>
    `).join("");
  }

  function renderVideos() {
    const items = VIDEOS.filter(v => activeCat === "all" || v.cat === activeCat);
    return `<div class="learn-video-grid">${items.map(v => `
      <div class="learn-video-card">
        <div class="learn-video-thumb" style="background:linear-gradient(135deg, hsl(${v.hue},62%,58%), hsl(${(v.hue + 40) % 360},58%,42%));">
          <div class="learn-video-thumb-play"><span><svg width="18" height="18" viewBox="0 0 24 24" fill="#1C2A3F"><path d="M8 5v14l11-7z"/></svg></span></div>
          <span class="learn-video-len">${v.len}</span>
          ${v.tag ? `<span class="learn-video-tag" style="${tagStyle(v.tag)}">${v.tag}</span>` : ""}
        </div>
        <div class="learn-video-body">
          <div class="learn-video-title">${v.title}</div>
          <div class="learn-video-author">${v.author}</div>
          <div class="learn-video-meta">
            <span class="learn-video-cat">${v.cat}</span>
            <span class="learn-video-level">${v.level}</span>
            ${v.watched ? `<span class="learn-video-watched"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#15803D" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>Watched</span>` : ""}
          </div>
        </div>
      </div>
    `).join("")}</div>`;
  }

  function renderBooks() {
    const items = BOOKS.filter(b => activeCat === "all" || b.cat === activeCat);
    return `<div class="learn-book-grid">${items.map(b => `
      <div class="learn-book-card">
        <div class="learn-book-spine" style="background:linear-gradient(135deg, hsl(${b.hue},55%,52%), hsl(${(b.hue + 30) % 360},52%,38%));"><span></span></div>
        <div class="learn-book-body">
          <div class="learn-book-top">
            <div class="learn-book-title">${b.title}</div>
            ${b.tag ? `<span class="learn-book-tag" style="${tagStyle(b.tag)}">${b.tag}</span>` : ""}
          </div>
          <div class="learn-book-author">${b.author}</div>
          <div class="learn-book-meta">
            <span class="learn-video-cat">${b.cat}</span>
            <span class="learn-book-rating"><svg width="13" height="13" viewBox="0 0 24 24" fill="#E0A62B" stroke="none"><path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6z"/></svg>${b.rating}</span>
            <span class="learn-book-pages">${b.pages} pages</span>
          </div>
        </div>
      </div>
    `).join("")}</div>`;
  }

  function renderSuggestions() {
    let flatCursor = 0;
    const groups = SUG_DATA.map(g => {
      const rows = g.items.map(() => {
        const idx = flatCursor;
        flatCursor++;
        const item = SUG_FLAT[idx];
        return `
          <div class="learn-sug-row" onclick="openSuggestionPanel(${idx})">
            <span class="learn-sug-row-title">${item.title}</span>
            <svg class="learn-sug-row-arrow" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
          </div>
        `;
      }).join("");
      return `
        <div class="learn-sug-group">
          <div class="learn-sug-group-header">
            <span class="learn-sug-dot" style="background:hsl(${g.hue},60%,52%);"></span>
            <span class="learn-sug-group-title">${g.cat}</span>
            <span class="learn-sug-group-count">${g.items.length}</span>
          </div>
          <div class="learn-sug-grid">${rows}</div>
        </div>
      `;
    }).join("");
    return `<p class="learn-sug-intro">Behavioural and risk-discipline guidance for retail F&amp;O traders — not trade signals, not "buy here, sell there." These are the patterns that quietly cost most new traders, and the option-specific traps that catch people who are otherwise doing everything right.</p>${groups}`;
  }

  function render() {
    renderTabBar();
    renderChips();
    const area = document.getElementById("learn-content-area");
    if (!area) return;
    if (activeTab === "videos") area.innerHTML = renderVideos();
    else if (activeTab === "books") area.innerHTML = renderBooks();
    else area.innerHTML = renderSuggestions();
  }

  let currentPanelIndex = -1;

  function openSuggestionPanel(flatIndex) {
    currentPanelIndex = flatIndex;
    const item = SUG_FLAT[flatIndex];
    if (!item) return;
    const categoryEl = document.getElementById("suggestions-panel-category");
    const titleEl = document.getElementById("suggestions-panel-title");
    const textEl = document.getElementById("suggestions-panel-text");
    if (categoryEl) categoryEl.innerText = item.cat;
    if (titleEl) titleEl.innerText = item.title;
    if (textEl) textEl.innerText = item.body;
    const overlay = document.getElementById("suggestions-panel-overlay");
    if (overlay) overlay.classList.remove("hidden");
  }

  function closeSuggestionPanel(event) {
    if (event && event.target.id !== "suggestions-panel-overlay") return;
    const overlay = document.getElementById("suggestions-panel-overlay");
    if (overlay) overlay.classList.add("hidden");
  }

  window.setLearnTab = setLearnTab;
  window.setLearnCat = setLearnCat;
  window.openSuggestionPanel = openSuggestionPanel;
  window.closeSuggestionPanel = closeSuggestionPanel;

  render();

})();
/* === END COMPONENT: learn (logic) === */
