/* ===========================================================
   COMPONENT: education (logic)
   Loaded lazily by dashboard.js the first time this tab opens.

   PLACEHOLDER CONTENT: every video entry below is a clearly-marked stand-in
   (isPlaceholder: true). Swap `url` with a real YouTube link and flip
   isPlaceholder to false once real content is added — the grid, filtering,
   and card layout do not need to change.
   =========================================================== */

(function () {

  const CATEGORIES = ["All", "Price Action", "SMC", "ICT", "Risk Management", "Psychology & Podcasts"];

  // Each entry: { title, creator, category, url, isPlaceholder }
  const VIDEOS = [
    { title: "Placeholder: Price Action Basics", creator: "Add creator name", category: "Price Action", url: "#", isPlaceholder: true },
    { title: "Placeholder: Reading Candlestick Structure", creator: "Add creator name", category: "Price Action", url: "#", isPlaceholder: true },
    { title: "Placeholder: Smart Money Concepts Intro", creator: "Add creator name", category: "SMC", url: "#", isPlaceholder: true },
    { title: "Placeholder: Order Blocks & Liquidity", creator: "Add creator name", category: "SMC", url: "#", isPlaceholder: true },
    { title: "Placeholder: ICT Core Concepts", creator: "Add creator name", category: "ICT", url: "#", isPlaceholder: true },
    { title: "Placeholder: ICT Killzones Explained", creator: "Add creator name", category: "ICT", url: "#", isPlaceholder: true },
    { title: "Placeholder: Position Sizing & Risk:Reward", creator: "Add creator name", category: "Risk Management", url: "#", isPlaceholder: true },
    { title: "Placeholder: Why Most Traders Blow Up Accounts", creator: "Add creator name", category: "Risk Management", url: "#", isPlaceholder: true },
    { title: "Placeholder: Trading Psychology Interview", creator: "Add creator name", category: "Psychology & Podcasts", url: "#", isPlaceholder: true },
    { title: "Placeholder: How Successful Traders Think", creator: "Add creator name", category: "Psychology & Podcasts", url: "#", isPlaceholder: true },
  ];

  let activeCategory = "All";

  function renderFilterBar() {
    const bar = document.getElementById('education-filter-bar');
    if (!bar) return;
    bar.innerHTML = CATEGORIES.map(cat => `
      <button type="button" class="learn-filter-btn ${cat === activeCategory ? 'active' : ''}" onclick="setEducationFilter('${cat.replace(/'/g, "\\'")}')">${cat}</button>
    `).join('');
  }

  function setEducationFilter(category) {
    activeCategory = category;
    renderFilterBar();
    renderGrid();
  }

  function renderGrid() {
    const grid = document.getElementById('education-grid-area');
    if (!grid) return;

    const items = activeCategory === "All" ? VIDEOS : VIDEOS.filter(v => v.category === activeCategory);

    if (items.length === 0) {
      grid.innerHTML = '<div class="roadmap-empty-state">No videos in this category yet.</div>';
      return;
    }

    grid.innerHTML = `<div class="learn-card-grid">${items.map(v => `
      <a href="${v.url}" target="_blank" rel="noopener" class="learn-card ${v.isPlaceholder ? 'learn-card-placeholder' : ''}">
        <div class="learn-card-thumb">${v.isPlaceholder ? '🎬' : '▶️'}</div>
        <div class="learn-card-body">
          <div class="learn-card-category-tag">${v.category}</div>
          <div class="learn-card-title">${v.title}</div>
          <div class="learn-card-creator">${v.creator}</div>
          ${v.isPlaceholder ? '<div class="learn-card-placeholder-tag">Placeholder &mdash; add real link</div>' : ''}
        </div>
      </a>
    `).join('')}</div>`;
  }

  window.setEducationFilter = setEducationFilter;

  renderFilterBar();
  renderGrid();

})();
/* === END COMPONENT: education (logic) === */