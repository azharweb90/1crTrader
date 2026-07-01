/* Tour content — per-tab step data, consumed by product-tour.js */
window.TOUR_CONTENT = {
  "tab-dashboard": [
    {
      eyebrow: "Dashboard",
      title: "Welcome to your home screen",
      text: "A quick snapshot of where things stand every time you open 1CrTrader, plus shortcuts to where you'll actually spend your time.",
    },
    {
      eyebrow: "Dashboard",
      title: "Your numbers at a glance",
      text: "Current balance, win rate, total trades, and net P&L — pulled from your actual logged trading, not estimates.",
      target: "#dash-stat-grid",
    },
    {
      eyebrow: "Dashboard",
      title: "Your risk rules, right now",
      text: "Your tier, today's max loss, and how many lots you're cleared for — the exact same numbers the Daily Limits Tool enforces, shown here so you never have to go looking for them.",
      target: "#dash-risk-wrap",
    },
    {
      eyebrow: "Dashboard",
      title: "Jump back in",
      text: "One tap into the screens you'll use daily — logging today's trades, checking your progress, or writing up your journal.",
      target: ".dash-quicklink-grid",
    },
  ],

  "tab-calculator": [
    {
      eyebrow: "Daily Limits Tool",
      title: "Your main working screen",
      text: "This is where you log today's trades and stay inside your risk limits — the screen you'll open every single trading day.",
    },
    {
      eyebrow: "Daily Limits Tool",
      title: "Every tier, side by side",
      text: "Curious why a smaller account allows a bigger loss percentage? This reference table has every tier's rules — collapsed by default, one click to open.",
      target: "#tier-ref-wrap",
    },
    {
      eyebrow: "Daily Limits Tool",
      title: "Your instruments, your numbers",
      text: "Type your own stop-loss in points for any index and see exactly what it would cost in rupees at your current lot count — with a warning if it exceeds what your tier allows.",
      target: "#instrument-sl-wrap",
    },
    {
      eyebrow: "Daily Limits Tool",
      title: "Connect your broker",
      text: "Sync your real order history, browse it day by day, and import any day straight into your Trade Log when you're ready.",
      target: "#broker-synced-panel",
    },
  ],

  "tab-trade-manager": [
    {
      eyebrow: "Trade Manager",
      title: "Manage a live trade",
      text: "Once you're in a position, this tracks it for you — including moving your stop-loss as the trade goes in your favor, so you don't have to make that call under pressure.",
    },
    {
      eyebrow: "Trade Manager",
      title: "Set up the trade",
      text: "Type the strike (like '23200 CE') along with your entry, stop-loss, and target. Direction is figured out automatically from what you type.",
      target: "#tm-setup-wrap",
    },
    {
      eyebrow: "Trade Manager",
      title: "Check in anytime",
      text: "Type the current price whenever you want an update. Your stop-loss trails upward automatically once the trade moves in your favor — and once it moves far enough, the trade is genuinely risk-free.",
      target: "#tm-current-price",
    },
  ],

  "tab-roadmap": [
    {
      eyebrow: "Roadmap",
      title: "Your path to the next tier",
      text: "See exactly how far you are from your next tier — and further out, from Rs. 1 crore — based on your real trading pace, not a generic projection.",
    },
    {
      eyebrow: "Roadmap",
      title: "Where you stand today",
      text: "Your current balance and how far you've come on the journey to your next unlock.",
      target: "#roadmap-balance-value",
    },
    {
      eyebrow: "Roadmap",
      title: "Pick a goal",
      text: "Choose any target from your next tier all the way to Rs. 1 crore. The app shows how many trades and days it would take — including an honest answer if your current pace isn't getting you there.",
      target: "#goal-amount-grid",
    },
  ],

  "tab-journal": [
    {
      eyebrow: "Trading Journal",
      title: "Write up the thinking, not just the numbers",
      text: "A place to record your reasoning, emotional state, and what you'd do differently — the patterns that don't show up in a P&L number on its own.",
    },
    {
      eyebrow: "Trading Journal",
      title: "Log a trade",
      text: "Instrument, direction, entry and exit, and the reward-to-risk you actually got.",
      target: "#jf-instrument",
    },
    {
      eyebrow: "Trading Journal",
      title: "Be honest about mistakes",
      text: "This is exactly where the patterns you want to fix get caught — revenge trades, ignored stop-losses, FOMO entries. Future you will thank present you.",
      target: "#jf-mistakes",
    },
  ],

  "tab-education": [
    {
      eyebrow: "Education",
      title: "Go deeper, on your own time",
      text: "Structured lessons on the concepts this app enforces day to day — for whenever you want more than just the rule.",
    },
    {
      eyebrow: "Education",
      title: "Browse by topic",
      text: "Filter lessons to whatever you're focused on right now.",
      target: "#education-filter-bar",
    },
  ],

  "tab-books": [
    {
      eyebrow: "Books",
      title: "A curated reading list",
      text: "Trading and psychology books worth your time — filtered by what you're trying to improve.",
    },
    {
      eyebrow: "Books",
      title: "Filter by topic",
      text: "Narrow the list down to what's actually relevant to where you are right now.",
      target: "#books-filter-bar",
    },
  ],

  "tab-strategies": [
    {
      eyebrow: "Strategies",
      title: "Document your own setups",
      text: "A space to write up and review specific trading strategies — separate from day-to-day logging in your Journal.",
    },
    {
      eyebrow: "Strategies",
      title: "Add a strategy",
      text: "Name it, describe the setup, and track its win rate and typical reward-to-risk over time.",
      target: "#st-name",
    },
  ],

  "tab-suggestions": [
    {
      eyebrow: "Suggestions",
      title: "The mistakes that quietly cost traders money",
      text: "Not trade signals — behavioral and risk-discipline guidance grouped by category. Tap any title to read the full reasoning.",
    },
    {
      eyebrow: "Suggestions",
      title: "Browse by category",
      text: "Psychology, Risk Management, and Options-Specific. Tap any title to open the full explanation in a side panel.",
      target: "#suggestions-list-area",
    },
  ],

  "tab-settings": [
    {
      eyebrow: "Account",
      title: "Your full profile, at a glance",
      text: "See everything in one place and change your tier, capital, trading style, or instruments without redoing the whole setup from scratch.",
    },
    {
      eyebrow: "Account",
      title: "Your risk rules",
      text: "The exact same numbers shown on Dashboard and Daily Limits Tool — tier, max loss, and lots, computed live from your current balance.",
      target: "#account-risk-grid",
    },
  ],

  "tab-subs": [
    {
      eyebrow: "Subscription Pricing",
      title: "Plans for wherever you are",
      text: "Your current tier's matching plan is highlighted so it's always clear which one applies to you.",
      target: ".pricing-card.popular",
    },
  ],
};
