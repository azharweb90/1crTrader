/* ===========================================================
   COMPONENT: suggestions (logic)
   Loaded lazily by dashboard.js the first time this tab opens.

   SCOPE (confirmed with the trader): a curated, always-visible list of
   behavioral and risk-discipline suggestions — not personalized, not tied
   to the trader's actual activity, not date/expiry-aware. A static
   reading list grouped under category headers (Psychology, Risk
   Management, Options-Specific), each shown in full every visit. This is
   intentionally the simple first version; smarter triggering (e.g. only
   surfacing the expiry-day warning on a real expiry day) is a deliberately
   separate, later decision — not built here.
   =========================================================== */

(function () {

  // Each suggestion: a short title (the headline) + the full explanation
  // (the "why", not just the rule) — confirmed pattern from the trader's
  // own three examples, which all paired a directive with a concrete
  // consequence, not just a bare instruction.
  const SUGGESTIONS = [
    {
      category: "Psychology",
      icon: "\u{1F9E0}",
      items: [
        {
          title: "Don't take random entries",
          body: "Trading without a plan doesn't just risk your capital \u2014 it wears down your psychology too, and a rattled mind tends to make the next decision worse, not better. A trade you can't explain in one sentence before entering usually isn't one you should take.",
        },
        {
          title: "Revenge trading rarely recovers the loss",
          body: "The urge to \"win it back immediately\" after a loss is one of the most common ways a single bad trade turns into a bad week. The position sizing and clear thinking that made you money earlier are usually the first things to go when you're trying to revenge trade.",
        },
        {
          title: "FOMO entries put you in at the worst price",
          body: "Jumping into a move because it's already happening means you're entering late, often near a short-term extreme, with no real edge \u2014 just urgency. If you missed the setup, you missed it; there will be another one.",
        },
        {
          title: "A losing streak doesn't mean you're a bad trader",
          body: "It usually means the market is choppy right now, or your particular edge isn't active in this condition. Stepping back and waiting protects your capital \u2014 and your confidence \u2014 far more than forcing a trade to feel like you're \"back in control.\"",
        },
      ],
    },
    {
      category: "Risk Management",
      icon: "\u{1F6E1}\uFE0F",
      items: [
        {
          title: "Holding an option position overnight carries gap risk",
          body: "Markets can move sharply overnight on news, global cues, or scheduled events \u2014 and once the market reopens, you can't react until it's already moved against you. If you wouldn't take the same trade fresh tomorrow morning, holding it overnight is a different decision than the one you actually made.",
        },
        {
          title: "Stop-loss isn't optional",
          body: "Moving your stop further away \"to give the trade room\" after you've already entered is one of the most common ways a small, planned loss turns into a large, unplanned one. The time to decide your stop is before you enter \u2014 not after the trade starts going against you.",
        },
        {
          title: "Position sizing matters more than entry timing",
          body: "Two correctly-timed trades sized too large can lose more than five wrong trades sized appropriately. Most traders spend far more energy perfecting their entry than thinking about how much of their capital that entry actually puts at risk.",
        },
        {
          title: "Daily loss limits exist to protect tomorrow, not just today",
          body: "Respecting your limit even when you're \"sure the next trade will work\" is what discipline actually means in practice \u2014 the rule is only ever tested on the day you don't want to follow it. A bad day capped at your limit is recoverable. An uncapped bad day usually isn't.",
        },
      ],
    },
    {
      category: "Options-Specific",
      icon: "\u{1F4C8}",
      items: [
        {
          title: "Expiry-day \"zero hero\" trades are a common way to breach your daily limit",
          body: "Buying deep out-of-the-money options for a few rupees on expiry day, hoping for a big last-minute move, has a very low win rate \u2014 and the combined losses from repeated attempts in the same session are exactly how traders blow through a daily loss limit they'd otherwise have respected.",
        },
        {
          title: "Theta decay works against option buyers every single day",
          body: "Time value erodes faster as expiry approaches, accelerating in the final days. A position that looked perfectly fine yesterday can lose value today even if the underlying hasn't moved at all \u2014 the clock itself is a cost you're paying as a buyer.",
        },
        {
          title: "Uncovered option selling carries undefined risk",
          body: "Unless a short option position is hedged, a single sharp move against it can erase many days' worth of small, steady gains in one session. The premium collected upfront is not the same as the maximum possible loss.",
        },
        {
          title: "Implied volatility can move independently of price direction",
          body: "High IV makes options expensive to buy and attractive to sell, but IV itself can spike or crush sharply around events \u2014 sometimes with little correlation to which way the underlying actually moves. A correct directional call can still lose money if volatility moves against the position.",
        },
      ],
    },
  ];

  function renderSuggestions() {
    const container = document.getElementById('suggestions-list-area');
    if (!container) return;

    let html = '';
    SUGGESTIONS.forEach(section => {
      html += `
        <div class="suggestions-category">
          <div class="suggestions-category-header">
            <span class="suggestions-category-icon">${section.icon}</span>
            <span class="suggestions-category-title">${section.category}</span>
          </div>
          <div class="suggestions-grid">
            ${section.items.map(item => `
              <div class="suggestions-card">
                <div class="suggestions-card-title">${item.title}</div>
                <p class="suggestions-card-body">${item.body}</p>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  window.renderSuggestions = renderSuggestions;

  // Auto-render once on load, the same way other purely-static lazy-loaded
  // tabs (e.g. Books, Education) don't need an external trigger — there's
  // no profile-dependent state this view needs to wait for.
  renderSuggestions();

})();