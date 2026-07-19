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
let _ensureMessageLoaded = null;
let _banner = null;
let _isMock = false;

export function configureSearch({ getMessages, getAllMessages, searchServer, ensureMessageLoaded, banner, isMock }) {
  _getMessages = getMessages;
  _getAllMessages = getAllMessages;
  _searchServer = searchServer;
  _ensureMessageLoaded = ensureMessageLoaded;
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

  let blurFromEnter = false;

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      blurFromEnter = true;
      searchInput.blur(); // dismiss keyboard
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

  // treat keyboard dismiss (blur) as submit — skip if Enter caused it
  searchInput.addEventListener("blur", () => {
    if (blurFromEnter) { blurFromEnter = false; return; }
    const query = searchInput.value.trim();
    if (query && searchResults.length === 0) {
      performSearch(query);
    }
  });

  // iOS: detect keyboard dismiss via viewport resize
  if (window.visualViewport) {
    let prevHeight = window.visualViewport.height;
    const onResize = () => {
      const newHeight = window.visualViewport.height;
      // keyboard closed = viewport got taller
      if (newHeight > prevHeight + 50 && document.activeElement === searchInput) {
        const query = searchInput.value.trim();
        if (query && searchResults.length === 0) {
          performSearch(query);
        }
      }
      prevHeight = newHeight;
    };
    window.visualViewport.addEventListener("resize", onResize);
  }
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
  let matchedMessages = messages.filter((m) => m.text && m.text.toLowerCase().includes(queryLower));

  // Always ask the server so the arrows also know about unloaded old matches.
  if (!_isMock && _searchServer) {
    try {
      const serverResults = await _searchServer(query);
      const byId = new Map(matchedMessages.map((message) => [message.id, message]));
      serverResults.forEach((message) => byId.set(message.id, message));
      matchedMessages = [...byId.values()];
    } catch (e) { /* server search failed */ }
  }

  searchResults = matchedMessages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (searchResults.length > 0) {
    searchIndex = searchResults.length - 1;
    await highlightCurrent(true);
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
    if (node.textContent.toLowerCase().includes(query.toLowerCase())) {
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      for (const match of node.textContent.matchAll(new RegExp(regex.source, regex.flags))) {
        if (match.index > lastIndex) fragment.appendChild(document.createTextNode(node.textContent.slice(lastIndex, match.index)));
        const mark = document.createElement("mark");
        mark.className = "search-match";
        mark.textContent = match[0];
        fragment.appendChild(mark);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < node.textContent.length) fragment.appendChild(document.createTextNode(node.textContent.slice(lastIndex)));
      node.replaceWith(fragment);
    }
  });
}

async function navigateSearch(direction) {
  if (searchResults.length === 0) return;
  document.querySelector(".search-active")?.classList.remove("search-active");

  searchIndex += direction;
  if (searchIndex >= searchResults.length) searchIndex = searchResults.length - 1;
  if (searchIndex < 0) searchIndex = 0;

  await highlightCurrent();
}

async function highlightCurrent(initial) {
  const message = searchResults[searchIndex];
  if (!message) return;
  if (!document.getElementById(`msg-${message.id}`) && _ensureMessageLoaded) {
    await _ensureMessageLoaded(message);
  }
  clearHighlights();
  const query = document.querySelector(".search-input")?.value.trim();
  const loadedMessages = _getMessages ? _getMessages() : [];
  loadedMessages.forEach((loaded) => {
    if (!query || !loaded.text?.toLowerCase().includes(query.toLowerCase())) return;
    const bubble = document.getElementById(`msg-${loaded.id}`)?.querySelector(".bubble");
    if (bubble) highlightTextInBubble(bubble, query);
  });
  const row = document.getElementById(`msg-${message.id}`);
  if (!row) return;
  const match = row.querySelector(".search-match");
  if (match) match.classList.add("search-active");
  row.scrollIntoView({ behavior: initial ? "auto" : "smooth", block: "nearest" });

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

  messages.forEach((m) => {
    if (m.text && m.text.toLowerCase().includes(queryLower)) {
      const row = document.getElementById(`msg-${m.id}`);
      if (row) {
        const bubble = row.querySelector(".bubble");
        if (bubble) {
          highlightTextInBubble(bubble, query);
        }
      }
    }
  });

  if (searchResults.length > 0) {
    if (searchIndex >= searchResults.length) searchIndex = searchResults.length - 1;
    if (searchIndex < 0) searchIndex = searchResults.length - 1;
    const activeMessage = searchResults[searchIndex];
    const row = activeMessage ? document.getElementById(`msg-${activeMessage.id}`) : null;
    const match = row?.querySelector(".search-match");
    if (match) match.classList.add("search-active");
  }
}
