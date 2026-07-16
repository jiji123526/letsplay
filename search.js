/* ============================================================
   Search — find messages with navigation arrows
   ============================================================ */

let searchResults = [];
let searchIndex = -1;

/**
 * Initialize search button listener.
 */
export function initSearch() {
  document.querySelector(".hdr-search")?.addEventListener("click", () => {
    toggleSearchBar();
  });
}

/**
 * Set callbacks for search operations that need app state.
 */
let _getMessages = null;
let _getAllMessages = null;
let _searchServer = null;
let _onServerResults = null;
let _banner = null;
let _isMock = false;

export function configureSearch({ getMessages, getAllMessages, searchServer, onServerResults, banner, isMock }) {
  _getMessages = getMessages;
  _getAllMessages = getAllMessages;
  _searchServer = searchServer;
  _onServerResults = onServerResults;
  _banner = banner;
  _isMock = isMock;
}

function toggleSearchBar() {
  const existing = document.querySelector(".search-bar");
  if (existing) { closeSearchBar(); return; }

  const bar = document.createElement("div");
  bar.className = "search-bar";
  bar.innerHTML = `
    <input class="search-input" type="text" placeholder="검색..." autocomplete="off" />
    <button class="search-nav-btn search-prev" aria-label="Previous">
      <svg viewBox="0 0 24 24" width="24" height="24"><path d="M18 15l-6-6-6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button class="search-nav-btn search-next" aria-label="Next">
      <svg viewBox="0 0 24 24" width="24" height="24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button class="search-close-btn">✕</button>
  `;

  document.querySelector(".chat-header").insertAdjacentElement("afterend", bar);

  const searchInput = bar.querySelector(".search-input");
  const prevBtn = bar.querySelector(".search-prev");
  const nextBtn = bar.querySelector(".search-next");
  prevBtn.disabled = true;
  nextBtn.disabled = true;

  searchInput.focus();

  searchInput.addEventListener("input", () => {
    clearHighlights();
    searchResults = [];
    searchIndex = -1;
    const bar = document.querySelector(".search-bar");
    if (bar) {
      bar.querySelector(".search-prev").disabled = true;
      bar.querySelector(".search-next").disabled = true;
    }
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      if (searchResults.length === 0) {
        performSearch(searchInput.value.trim());
      } else {
        navigateSearch(-1);
      }
    }
    if (e.key === "Escape") closeSearchBar();
  });

  prevBtn.addEventListener("click", () => navigateSearch(-1));
  nextBtn.addEventListener("click", () => navigateSearch(1));
  bar.querySelector(".search-close-btn").addEventListener("click", closeSearchBar);
}

export function closeSearchBar() {
  document.querySelector(".search-bar")?.remove();
  clearHighlights();
  searchResults = [];
  searchIndex = -1;
}

function clearHighlights() {
  document.querySelectorAll(".search-match").forEach((el) => {
    const parent = el.parentNode;
    el.replaceWith(el.textContent);
    if (parent) parent.normalize();
  });
}

async function performSearch(query) {
  clearHighlights();
  searchResults = [];
  searchIndex = -1;

  if (!query) return;

  const messages = _getMessages ? _getMessages() : [];
  const queryLower = query.toLowerCase();

  messages.forEach((m) => {
    if (m.text && m.text.toLowerCase().includes(queryLower)) {
      const row = document.getElementById(`msg-${m.id}`);
      if (row) {
        const bubble = row.querySelector(".bubble");
        if (bubble) {
          highlightTextInBubble(bubble, query);
          searchResults.push(row);
        }
      }
    }
  });

  // if no local results, try server-side search
  if (searchResults.length === 0 && !_isMock && _searchServer) {
    try {
      const serverResults = await _searchServer(query);
      if (serverResults.length > 0) {
        if (_onServerResults) _onServerResults(serverResults);
        // re-search locally now that messages are loaded
        const updatedMessages = _getMessages ? _getMessages() : [];
        updatedMessages.forEach((m) => {
          if (m.text && m.text.toLowerCase().includes(queryLower)) {
            const row = document.getElementById(`msg-${m.id}`);
            if (row) {
              const bubble = row.querySelector(".bubble");
              if (bubble) {
                highlightTextInBubble(bubble, query);
                searchResults.push(row);
              }
            }
          }
        });
      }
    } catch (e) { /* server search failed */ }
  }

  if (searchResults.length > 0) {
    searchIndex = searchResults.length - 1;
    highlightCurrent();
  } else if (_banner) {
    _banner("검색 결과가 없습니다", "#666");
  }
}

export function highlightTextInBubble(bubble, query) {
  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, "gi");
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach((node) => {
    if (regex.test(node.textContent)) {
      const span = document.createElement("span");
      span.innerHTML = node.textContent.replace(regex, '<mark class="search-match">$1</mark>');
      node.replaceWith(span);
    }
  });
}

function navigateSearch(direction) {
  if (searchResults.length === 0) return;
  searchResults[searchIndex]?.querySelector(".search-active")?.classList.remove("search-active");

  searchIndex += direction;
  if (searchIndex >= searchResults.length) searchIndex = searchResults.length - 1;
  if (searchIndex < 0) searchIndex = 0;

  highlightCurrent();
}

function highlightCurrent() {
  const row = searchResults[searchIndex];
  if (!row) return;
  const match = row.querySelector(".search-match");
  if (match) match.classList.add("search-active");
  row.scrollIntoView({ behavior: "smooth", block: "center" });

  const bar = document.querySelector(".search-bar");
  if (bar) {
    const prevBtn = bar.querySelector(".search-prev");
    const nextBtn = bar.querySelector(".search-next");
    prevBtn.disabled = searchIndex <= 0;
    nextBtn.disabled = searchIndex >= searchResults.length - 1;
  }
}

/**
 * Re-apply search highlights after a re-render (called by app.js render()).
 */
export function restoreSearchHighlights(messages) {
  if (!document.querySelector(".search-bar")) return;
  const searchInput = document.querySelector(".search-input");
  if (!searchInput || !searchInput.value.trim()) return;

  const query = searchInput.value.trim();
  const queryLower = query.toLowerCase();
  searchResults = [];

  messages.forEach((m) => {
    if (m.text && m.text.toLowerCase().includes(queryLower)) {
      const row = document.getElementById(`msg-${m.id}`);
      if (row) {
        const bubble = row.querySelector(".bubble");
        if (bubble) {
          highlightTextInBubble(bubble, query);
          searchResults.push(row);
        }
      }
    }
  });

  if (searchResults.length > 0) {
    if (searchIndex >= searchResults.length) searchIndex = searchResults.length - 1;
    if (searchIndex < 0) searchIndex = searchResults.length - 1;
    const row = searchResults[searchIndex];
    const match = row?.querySelector(".search-match");
    if (match) match.classList.add("search-active");
  }
}
