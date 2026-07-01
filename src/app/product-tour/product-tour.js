/* ===========================================================
   PRODUCT TOUR ENGINE — 1CrTrader
   Generic spotlight-style tour, reusable across every tab. Step CONTENT
   (titles/descriptions/target selectors per tab) lives separately in
   tour-content.js as plain data — this file only knows how to walk a
   step array and render the spotlight, it has no per-tab knowledge.

   Triggered from switchTab()'s loadComponent().then() in app-shell.js,
   the first time each tab is visited (confirmed scope: every tab gets
   its own tour). Seen-state persists via localStorage, same pattern as
   the existing dark-mode preference — once shown (completed OR
   skipped), never auto-shows again for that tab.
   =========================================================== */

(function () {
  const TOUR_SEEN_STORAGE_PREFIX = "tourSeen:";

  let activeSteps = [];
  let activeStepIndex = 0;
  let activeTabId = null;

  function hasTourBeenSeen(tabId) {
    return localStorage.getItem(TOUR_SEEN_STORAGE_PREFIX + tabId) === "true";
  }

  function markTourSeen(tabId) {
    localStorage.setItem(TOUR_SEEN_STORAGE_PREFIX + tabId, "true");
  }

  // Called from switchTab() after a tab's component has loaded and
  // rendered. Only starts if: (a) this tab actually has tour content
  // defined, (b) it hasn't been seen before, and (c) every target
  // element the tour needs actually exists in the DOM right now — a
  // tour step pointing at nothing would be worse than no tour at all,
  // so a missing target silently skips that one step rather than
  // breaking the whole sequence (see renderStep()).
  function startTabTourIfNeeded(tabId) {
    if (typeof window.TOUR_CONTENT === "undefined") return;
    const steps = window.TOUR_CONTENT[tabId];
    if (!steps || steps.length === 0) return;
    if (hasTourBeenSeen(tabId)) return;

    activeSteps = steps;
    activeStepIndex = 0;
    activeTabId = tabId;
    ensureOverlayExists();
    renderStep();
  }

  // Manual re-trigger (e.g. a "Replay tour" link could call this later)
  // — bypasses the seen-check, since this is an explicit request.
  function startTabTourNow(tabId) {
    if (typeof window.TOUR_CONTENT === "undefined") return;
    const steps = window.TOUR_CONTENT[tabId];
    if (!steps || steps.length === 0) return;

    activeSteps = steps;
    activeStepIndex = 0;
    activeTabId = tabId;
    ensureOverlayExists();
    renderStep();
  }

  function ensureOverlayExists() {
    if (document.getElementById("tour-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "tour-overlay";
    overlay.className = "tour-overlay hidden";
    overlay.innerHTML = `
      <div id="tour-dim-top" class="tour-dim-panel"></div>
      <div id="tour-dim-bottom" class="tour-dim-panel"></div>
      <div id="tour-dim-left" class="tour-dim-panel"></div>
      <div id="tour-dim-right" class="tour-dim-panel"></div>
      <div id="tour-spotlight-box" class="tour-spotlight-box"></div>
      <div id="tour-tooltip" class="tour-tooltip">
        <button type="button" class="tour-skip-link" onclick="skipTour()">Skip tour</button>
        <div id="tour-tooltip-eyebrow" class="tour-tooltip-eyebrow"></div>
        <h4 id="tour-tooltip-title" class="tour-tooltip-title"></h4>
        <p id="tour-tooltip-text" class="tour-tooltip-text"></p>
        <div class="tour-tooltip-footer">
          <span id="tour-tooltip-progress" class="tour-tooltip-progress"></span>
          <div class="tour-tooltip-actions">
            <button type="button" id="tour-back-btn" class="tour-btn tour-btn-back" onclick="tourBack()">Back</button>
            <button type="button" id="tour-next-btn" class="tour-btn tour-btn-next" onclick="tourNext()">Next</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    window.addEventListener("resize", repositionIfActive);
    window.addEventListener("scroll", repositionIfActive, true);
  }

  function repositionIfActive() {
    const overlay = document.getElementById("tour-overlay");
    if (!overlay || overlay.classList.contains("hidden")) return;
    positionSpotlight(activeSteps[activeStepIndex]);
  }

  function renderStep() {
    while (activeStepIndex < activeSteps.length) {
      const step = activeSteps[activeStepIndex];
      const targetEl = step.target ? document.querySelector(step.target) : null;
      if (step.target && !targetEl) {
        activeStepIndex++;
        continue;
      }
      break;
    }

    if (activeStepIndex >= activeSteps.length) {
      finishTour();
      return;
    }

    const step = activeSteps[activeStepIndex];
    const overlay = document.getElementById("tour-overlay");
    overlay.classList.remove("hidden");

    document.getElementById("tour-tooltip-eyebrow").innerText =
      step.eyebrow || "";
    document.getElementById("tour-tooltip-title").innerText = step.title;
    document.getElementById("tour-tooltip-text").innerText = step.text;
    document.getElementById("tour-tooltip-progress").innerText =
      `${activeStepIndex + 1} of ${activeSteps.length}`;

    const backBtn = document.getElementById("tour-back-btn");
    const nextBtn = document.getElementById("tour-next-btn");
    backBtn.style.visibility = activeStepIndex === 0 ? "hidden" : "visible";
    nextBtn.innerText =
      activeStepIndex === activeSteps.length - 1 ? "Got it" : "Next";

    positionSpotlight(step);
  }

  function positionSpotlight(step) {
    const targetEl = step.target ? document.querySelector(step.target) : null;
    const spotlightBox = document.getElementById("tour-spotlight-box");
    const tooltip = document.getElementById("tour-tooltip");
    const padding = 8;

    if (!targetEl) {
      spotlightBox.style.display = "none";
      [
        "tour-dim-top",
        "tour-dim-bottom",
        "tour-dim-left",
        "tour-dim-right",
      ].forEach((id) => {
        const el = document.getElementById(id);
        el.style.top = "0";
        el.style.left = "0";
        el.style.width = "100%";
        el.style.height = "100%";
      });
      document.getElementById("tour-dim-bottom").style.height = "0";
      document.getElementById("tour-dim-left").style.width = "0";
      document.getElementById("tour-dim-right").style.width = "0";
      tooltip.style.top = "50%";
      tooltip.style.left = "50%";
      tooltip.style.transform = "translate(-50%, -50%)";
      return;
    }

    if (targetEl.scrollIntoView) {
      targetEl.scrollIntoView({
        block: "center",
        behavior: "instant" in window ? "instant" : "auto",
      });
    }
    const rect = targetEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const boxTop = rect.top - padding;
    const boxLeft = rect.left - padding;
    const boxWidth = rect.width + padding * 2;
    const boxHeight = rect.height + padding * 2;

    spotlightBox.style.display = "block";
    spotlightBox.style.top = `${boxTop}px`;
    spotlightBox.style.left = `${boxLeft}px`;
    spotlightBox.style.width = `${boxWidth}px`;
    spotlightBox.style.height = `${boxHeight}px`;

    const top = document.getElementById("tour-dim-top");
    top.style.top = "0";
    top.style.left = "0";
    top.style.width = "100%";
    top.style.height = `${Math.max(boxTop, 0)}px`;

    const bottom = document.getElementById("tour-dim-bottom");
    bottom.style.top = `${boxTop + boxHeight}px`;
    bottom.style.left = "0";
    bottom.style.width = "100%";
    bottom.style.height = `${Math.max(vh - (boxTop + boxHeight), 0)}px`;

    const left = document.getElementById("tour-dim-left");
    left.style.top = `${boxTop}px`;
    left.style.left = "0";
    left.style.width = `${Math.max(boxLeft, 0)}px`;
    left.style.height = `${boxHeight}px`;

    const right = document.getElementById("tour-dim-right");
    right.style.top = `${boxTop}px`;
    right.style.left = `${boxLeft + boxWidth}px`;
    right.style.width = `${Math.max(vw - (boxLeft + boxWidth), 0)}px`;
    right.style.height = `${boxHeight}px`;

    tooltip.style.transform = "none";
    const tooltipWidth = 300;
    let tooltipLeft = rect.left;
    if (tooltipLeft + tooltipWidth > vw - 16)
      tooltipLeft = vw - tooltipWidth - 16;
    if (tooltipLeft < 16) tooltipLeft = 16;

    const spaceBelow = vh - (boxTop + boxHeight);
    const placeBelow = spaceBelow > 180;
    const tooltipTop = placeBelow
      ? boxTop + boxHeight + 14
      : Math.max(boxTop - 14 - 220, 16);

    tooltip.style.left = `${tooltipLeft}px`;
    tooltip.style.top = `${tooltipTop}px`;
  }

  function tourNext() {
    activeStepIndex++;
    renderStep();
  }

  function tourBack() {
    if (activeStepIndex === 0) return;
    activeStepIndex--;
    renderStep();
  }

  function skipTour() {
    finishTour();
  }

  function finishTour() {
    if (activeTabId) markTourSeen(activeTabId);
    const overlay = document.getElementById("tour-overlay");
    if (overlay) overlay.classList.add("hidden");
    activeSteps = [];
    activeStepIndex = 0;
    activeTabId = null;
  }

  // ---------- Resource Hub ----------
  // A permanent "?" floating action button in the bottom-right corner.
  // Opens a panel with two options: (1) replay this page's tour — always
  // prominent at the top, since this is what a lost user most often wants;
  // (2) browse all tours by tab name, so any specific screen can be
  // revisited. Confirmed scope: always visible, on-demand replay of any tour.

  const TAB_LABELS = {
    "tab-dashboard": "Dashboard",
    "tab-calculator": "Daily Limits Tool",
    "tab-trade-manager": "Trade Manager",
    "tab-roadmap": "Roadmap",
    "tab-journal": "Trading Journal",
    "tab-education": "Education",
    "tab-books": "Books",
    "tab-strategies": "Strategies",
    "tab-suggestions": "Suggestions",
    "tab-settings": "Account",
    "tab-subs": "Subscription Pricing",
  };

  function getCurrentTabId() {
    const activeLink = document.querySelector(".sidebar-link.active");
    return activeLink ? activeLink.dataset.tab : null;
  }

  function createResourceHub() {
    if (document.getElementById("resource-hub-fab")) return;

    const fab = document.createElement("button");
    fab.id = "resource-hub-fab";
    fab.type = "button";
    fab.className = "resource-hub-fab";
    fab.setAttribute("aria-label", "Resource Hub — help and tours");
    fab.innerHTML = "?";
    fab.onclick = toggleResourceHubPanel;
    document.body.appendChild(fab);

    const panel = document.createElement("div");
    panel.id = "resource-hub-panel";
    panel.className = "resource-hub-panel hidden";
    document.body.appendChild(panel);

    // Close the panel if the user clicks anywhere outside it
    document.addEventListener("click", (e) => {
      const p = document.getElementById("resource-hub-panel");
      const f = document.getElementById("resource-hub-fab");
      if (
        p &&
        !p.classList.contains("hidden") &&
        !p.contains(e.target) &&
        e.target !== f
      ) {
        p.classList.add("hidden");
      }
    });
  }

  function toggleResourceHubPanel() {
    const panel = document.getElementById("resource-hub-panel");
    if (!panel) return;
    if (panel.classList.contains("hidden")) {
      renderResourceHubPanel();
      panel.classList.remove("hidden");
    } else {
      panel.classList.add("hidden");
    }
  }

  function closeResourceHubPanel() {
    const panel = document.getElementById("resource-hub-panel");
    if (panel) panel.classList.add("hidden");
  }

  function renderResourceHubPanel() {
    const panel = document.getElementById("resource-hub-panel");
    if (!panel) return;

    const currentTabId = getCurrentTabId();
    const currentTabLabel =
      (currentTabId && TAB_LABELS[currentTabId]) || "this page";
    const hasTourForCurrentTab =
      typeof window.TOUR_CONTENT !== "undefined" &&
      currentTabId &&
      window.TOUR_CONTENT[currentTabId];

    // All-tours list — every tab that has tour content defined
    const allTourItems =
      typeof window.TOUR_CONTENT !== "undefined"
        ? Object.keys(TAB_LABELS)
            .filter((tabId) => window.TOUR_CONTENT[tabId])
            .map(
              (tabId) => `
            <button type="button" class="resource-hub-tour-item"
              onclick="replayTourFromHub('${tabId}')">
              <span class="resource-hub-tour-item-name">${TAB_LABELS[tabId]}</span>
              <span class="resource-hub-tour-item-arrow">›</span>
            </button>
          `,
            )
            .join("")
        : '<p style="padding:10px 16px;font-size:12px;color:#8A98AD;">No tours available yet.</p>';

    panel.innerHTML = `
      <div class="resource-hub-panel-header">
        <span class="resource-hub-panel-title">
          <span class="resource-hub-panel-title-icon">✦</span> Resource Hub
        </span>
        <button type="button" class="resource-hub-panel-close"
          onclick="closeResourceHubPanel()" aria-label="Close">&times;</button>
      </div>

      ${
        hasTourForCurrentTab
          ? `
        <button type="button" class="resource-hub-replay-btn"
          onclick="replayTourFromHub('${currentTabId}')">
          <span class="resource-hub-replay-icon">▶</span>
          <span class="resource-hub-replay-text">
            Replay tour for this page
            <span class="resource-hub-replay-sub">${currentTabLabel}</span>
          </span>
        </button>
      `
          : ""
      }

      <div class="resource-hub-section-label">All tours</div>
      <div class="resource-hub-tour-list">${allTourItems}</div>
    `;
  }

  // Replays a specific tab's tour from the Resource Hub panel:
  // - If the user is already on that tab, start the tour directly
  // - If they're on a different tab, switch to it first, then start after
  //   the component load delay (same 300ms pattern used in switchTab)
  function replayTourFromHub(tabId) {
    closeResourceHubPanel();
    const currentTabId = getCurrentTabId();
    if (currentTabId === tabId) {
      startTabTourNow(tabId);
    } else {
      if (typeof window.switchTab === "function") {
        window.switchTab(null, tabId);
        setTimeout(() => startTabTourNow(tabId), 400);
      } else {
        startTabTourNow(tabId);
      }
    }
  }

  // Create the hub as soon as the DOM is ready — it should be visible from
  // the very first moment the app shell renders, not deferred until a tab
  // is visited (confirmed: this is a permanent always-visible widget).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createResourceHub);
  } else {
    createResourceHub();
  }

  window.startTabTourIfNeeded = startTabTourIfNeeded;
  window.startTabTourNow = startTabTourNow;
  window.tourNext = tourNext;
  window.tourBack = tourBack;
  window.skipTour = skipTour;
  window.toggleResourceHubPanel = toggleResourceHubPanel;
  window.closeResourceHubPanel = closeResourceHubPanel;
  window.replayTourFromHub = replayTourFromHub;
})();
