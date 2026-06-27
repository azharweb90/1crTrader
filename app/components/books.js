/* ===========================================================
   COMPONENT: books (logic)
   Loaded lazily by dashboard.js the first time this tab opens.

   PLACEHOLDER CONTENT: every book entry below is a clearly-marked stand-in
   (isPlaceholder: true). Swap in a real title/author/link once decided —
   the grid and filtering layout do not need to change.
   =========================================================== */

(function () {

  const CATEGORIES = ["All", "Trading Psychology", "Risk & Money Management", "Strategy & Technical", "Trader Biographies"];

  // Each entry: { title, author, category, url, isPlaceholder }
  const BOOKS = [
    { title: "Placeholder: Trading Psychology Title", author: "Add author name", category: "Trading Psychology", url: "#", isPlaceholder: true },
    { title: "Placeholder: Mindset & Discipline Title", author: "Add author name", category: "Trading Psychology", url: "#", isPlaceholder: true },
    { title: "Placeholder: Risk Management Title", author: "Add author name", category: "Risk & Money Management", url: "#", isPlaceholder: true },
    { title: "Placeholder: Position Sizing Title", author: "Add author name", category: "Risk & Money Management", url: "#", isPlaceholder: true },
    { title: "Placeholder: Price Action Strategy Title", author: "Add author name", category: "Strategy & Technical", url: "#", isPlaceholder: true },
    { title: "Placeholder: Technical Analysis Title", author: "Add author name", category: "Strategy & Technical", url: "#", isPlaceholder: true },
    { title: "Placeholder: Market Wizards-style Title", author: "Add author name", category: "Trader Biographies", url: "#", isPlaceholder: true },
    { title: "Placeholder: Trading Memoir Title", author: "Add author name", category: "Trader Biographies", url: "#", isPlaceholder: true },
  ];

  let activeCategory = "All";

  function renderFilterBar() {
    const bar = document.getElementById('books-filter-bar');
    if (!bar) return;
    bar.innerHTML = CATEGORIES.map(cat => `
      <button type="button" class="learn-filter-btn ${cat === activeCategory ? 'active' : ''}" onclick="setBooksFilter('${cat.replace(/'/g, "\\'")}')">${cat}</button>
    `).join('');
  }

  function setBooksFilter(category) {
    activeCategory = category;
    renderFilterBar();
    renderGrid();
  }

  function renderGrid() {
    const grid = document.getElementById('books-grid-area');
    if (!grid) return;

    const items = activeCategory === "All" ? BOOKS : BOOKS.filter(b => b.category === activeCategory);

    if (items.length === 0) {
      grid.innerHTML = '<div class="roadmap-empty-state">No books in this category yet.</div>';
      return;
    }

    grid.innerHTML = `<div class="learn-card-grid">${items.map(b => `
      <a href="${b.url}" target="_blank" rel="noopener" class="learn-card ${b.isPlaceholder ? 'learn-card-placeholder' : ''}">
        <div class="learn-card-thumb">${b.isPlaceholder ? '📖' : '📘'}</div>
        <div class="learn-card-body">
          <div class="learn-card-category-tag">${b.category}</div>
          <div class="learn-card-title">${b.title}</div>
          <div class="learn-card-creator">${b.author}</div>
          ${b.isPlaceholder ? '<div class="learn-card-placeholder-tag">Placeholder &mdash; add real title</div>' : ''}
        </div>
      </a>
    `).join('')}</div>`;
  }

  window.setBooksFilter = setBooksFilter;

  renderFilterBar();
  renderGrid();

})();
/* === END COMPONENT: books (logic) === */