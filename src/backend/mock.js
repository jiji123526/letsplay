/* ============================================================
   MOCK backend  —  no Firebase, everything in localStorage.
   Lets you build the UI/UX flow end-to-end:
     • a stable fake uid per browser
     • messages persist across refresh (localStorage)
     • a fake "other person" auto-replies so you see recv bubbles
     • cross-tab sync via the storage event (open 2 tabs to test)
   ============================================================ */

const KEY = "mock_messages";
const listeners = new Set();

let channelId = "main";
export function setChannel(id) { channelId = id; }
export function getChannel() { return channelId; }

function getKey(base) { return `${base}_${channelId}`; }

function load() {
  try {
    return JSON.parse(localStorage.getItem(getKey("mock_messages")) || "[]").map((m) => ({
      ...m, createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
    }));
  } catch { return []; }
}
function save(list) {
  try {
    localStorage.setItem(getKey("mock_messages"), JSON.stringify(
      list.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))
    ));
  } catch { /* ignore quota errors in mock mode */ }
}
function emit() {
  const list = load();
  listeners.forEach((cb) => cb(list));
}

/* seed a couple of messages the first time */
function seedIfEmpty() {
  if (load().length) return;
  const now = Date.now();
  save([
    { id: id(), uid: "bot", nick: "레몬봇", is_admin: false, text: "여기는 로컬 미리보기예요 🍋", createdAt: new Date(now - 60000) },
    { id: id(), uid: "bot", nick: "레몬봇", is_admin: false, text: "메시지를 보내보세요!", createdAt: new Date(now - 30000) },
  ]);
}
function id() {
  return "m_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function initAuth() {
  let uid = localStorage.getItem("mock_uid");
  if (!uid) { uid = "u_" + Math.random().toString(36).slice(2); localStorage.setItem("mock_uid", uid); }
  seedIfEmpty();
  return uid;
}

export function subscribe(cb) {
  listeners.add(cb);
  cb(load());
  // cross-tab updates
  window.addEventListener("storage", (e) => { if (e.key === KEY) cb(load()); });
  return () => listeners.delete(cb);
}

export async function sendMessage({ uid, nick, text, is_admin, replyTo, report, reportedMsgId, image, storedImage, dm, galleryId, imageW, imageH }) {
  const list = load();
  const msg = { id: id(), uid, nick, text, is_admin: !!is_admin, replyTo: replyTo || null, createdAt: new Date() };
  if (report) { msg.report = true; msg.reportedMsgId = reportedMsgId || null; }
  if (image) { msg.image = image instanceof Blob ? URL.createObjectURL(image) : image; }
  else if (storedImage) { msg.image = storedImage; }
  if (imageW) { msg.imageW = imageW; }
  if (imageH) { msg.imageH = imageH; }
  if (dm) { msg.dm = true; }
  if (galleryId) { msg.galleryId = galleryId; }
  list.push(msg);
  save(list);
  emit();

  // fake reply so you can see the gray "recv" bubble styling
  clearTimeout(sendMessage._t);
  sendMessage._t = setTimeout(() => {
    const replies = ["ㅋㅋㅋ", "좋아요 👍", "오 신기하다", "🍋🍋", "그러게요!", "완전 iMessage 같네요"];
    const l = load();
    l.push({
      id: id(), uid: "bot", nick: "레몬봇", is_admin: false,
      text: replies[Math.floor(Math.random() * replies.length)],
      createdAt: new Date(),
    });
    save(l);
    emit();
  }, 900 + Math.random() * 700);
}

export async function removeMessage(mid) {
  save(load().filter((m) => m.id !== mid));
  emit();
}

export async function softDeleteMessage(mid) {
  const list = load();
  const msg = list.find((m) => m.id === mid);
  if (msg) { msg.deleted = true; msg.text = ""; msg.image = null; msg.galleryId = null; }
  save(list);
  emit();
}

export async function editMessage(mid, newText) {
  const list = load();
  const msg = list.find((m) => m.id === mid);
  if (msg) { msg.text = newText; msg.edited = true; }
  save(list);
  emit();
}

export async function addReaction(mid, emoji, uid) {
  const list = load();
  const msg = list.find((m) => m.id === mid);
  if (msg) {
    if (!msg.reactions) msg.reactions = {};
    const key = `${uid}_${emoji}`;
    if (msg.reactions[key]) {
      // toggle off if same emoji already exists
      delete msg.reactions[key];
      if (Object.keys(msg.reactions).length === 0) delete msg.reactions;
    } else {
      msg.reactions[key] = emoji;
    }
  }
  save(list);
  emit();
}

export async function removeReaction(mid, uid) {
  const list = load();
  const msg = list.find((m) => m.id === mid);
  if (msg && msg.reactions) {
    // remove all reactions from this user
    Object.keys(msg.reactions).forEach((key) => {
      if (key.startsWith(`${uid}_`)) delete msg.reactions[key];
    });
    if (Object.keys(msg.reactions).length === 0) delete msg.reactions;
  }
  save(list);
  emit();
}

/* ---- block list ---- */
const BLOCK_KEY = "mock_blocked";

function loadBlocked() {
  try {
    const raw = JSON.parse(localStorage.getItem(getKey("mock_blocked")) || "[]");
    // support both old format (string[]) and new format ({uid, reason}[])
    return raw.map((b) => typeof b === "string" ? { uid: b, reason: "" } : b);
  } catch { return []; }
}

export function getBlockedUsers() {
  return loadBlocked();
}

export function subscribeBlocked(cb) {
  cb(loadBlocked());
  window.addEventListener("storage", (e) => { if (e.key === BLOCK_KEY) cb(loadBlocked()); });
}

export async function blockUser(uid, reason) {
  const list = loadBlocked();
  if (!list.find((b) => b.uid === uid)) {
    list.push({ uid, reason: reason || "" });
    localStorage.setItem(getKey("mock_blocked"), JSON.stringify(list));
  }
}

export async function unblockUser(uid) {
  const list = loadBlocked().filter((b) => b.uid !== uid);
  localStorage.setItem(getKey("mock_blocked"), JSON.stringify(list));
}

/* ---- DM (separate storage) ---- */
const DM_KEY = "mock_dm";
const dmListeners = new Set();

function loadDm() {
  try {
    return JSON.parse(localStorage.getItem(getKey("mock_dm")) || "[]").map((m) => ({
      ...m, createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
    }));
  } catch { return []; }
}
function saveDm(list) {
  localStorage.setItem(getKey("mock_dm"), JSON.stringify(
    list.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))
  ));
}

export async function sendDm({ uid, nick, text, image }) {
  const list = loadDm();
  const msg = { id: id(), uid, nick, text, createdAt: new Date() };
  if (image) msg.image = image instanceof Blob ? URL.createObjectURL(image) : image;
  list.push(msg);
  saveDm(list);
  dmListeners.forEach((cb) => cb(loadDm()));
}

export async function removeDm(mid) {
  saveDm(loadDm().filter((m) => m.id !== mid));
  dmListeners.forEach((cb) => cb(loadDm()));
}

export function subscribeDm(cb) {
  dmListeners.add(cb);
  cb(loadDm());
  window.addEventListener("storage", (e) => { if (e.key === DM_KEY) cb(loadDm()); });
  return () => dmListeners.delete(cb);
}

/* ---- Gallery ---- */
const GALLERY_KEY = "mock_gallery";

/* ---- Notice ---- */
const noticeListeners = new Map();

export async function setNotice(text) {
  const key = getKey("mock_notice");
  localStorage.setItem(key, text);
  noticeListeners.get(key)?.forEach((cb) => cb(text));
}

export function subscribeNotice(cb) {
  const key = getKey("mock_notice");
  if (!noticeListeners.has(key)) noticeListeners.set(key, new Set());
  noticeListeners.get(key).add(cb);
  cb(localStorage.getItem(key) || "");
  const onStorage = (e) => { if (e.key === key) cb(e.newValue || ""); };
  window.addEventListener("storage", onStorage);
  return () => {
    noticeListeners.get(key)?.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function subscribeLiveStatus(chId, cb) {
  const activeKey = `liveActive_${chId || "main"}`;
  const titleKey = `liveTitle_${chId || "main"}`;
  const sessionKey = `liveSession_${chId || "main"}`;
  const emitStatus = () => cb({
    active: localStorage.getItem(activeKey) === "true",
    title: localStorage.getItem(titleKey) || "",
    sessionId: localStorage.getItem(sessionKey) || "",
  });
  const onStorage = (e) => {
    if (e.key === activeKey || e.key === titleKey || e.key === sessionKey) emitStatus();
  };
  window.addEventListener("storage", onStorage);
  emitStatus();
  return () => window.removeEventListener("storage", onStorage);
}

export function broadcastLiveStatus() {
  // localStorage writes already notify other mock tabs.
}

export function subscribeLivePresence(chId, cb) {
  const key = `mock_live_presence_${chId || "main"}`;
  const tabId = crypto.randomUUID();
  const ttlMs = 10000;
  let stopped = false;

  const readPresence = () => {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); }
    catch { return {}; }
  };
  const writePresence = (presence) => {
    localStorage.setItem(key, JSON.stringify(presence));
  };
  const sync = (trackSelf = true) => {
    if (stopped) return;
    const now = Date.now();
    const presence = readPresence();
    Object.keys(presence).forEach((id) => {
      if (now - Number(presence[id] || 0) > ttlMs) delete presence[id];
    });
    if (trackSelf) presence[tabId] = now;
    writePresence(presence);
    cb(Object.keys(presence).length);
  };
  const removeSelf = () => {
    const presence = readPresence();
    delete presence[tabId];
    writePresence(presence);
  };
  const onStorage = (event) => {
    if (event.key !== key || stopped) return;
    const now = Date.now();
    const presence = readPresence();
    const count = Object.values(presence)
      .filter((lastSeen) => now - Number(lastSeen || 0) <= ttlMs)
      .length;
    cb(count);
  };
  const onPageHide = () => removeSelf();

  window.addEventListener("storage", onStorage);
  window.addEventListener("pagehide", onPageHide);
  sync();
  const timer = window.setInterval(sync, 3000);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pagehide", onPageHide);
    removeSelf();
  };
}
const galleryListeners = new Set();

function loadGallery() {
  try {
    return JSON.parse(localStorage.getItem(getKey("mock_gallery")) || "[]").map((g) => ({
      ...g, createdAt: g.createdAt ? new Date(g.createdAt) : new Date(),
    }));
  } catch { return []; }
}
function saveGalleryList(list) {
  // skip persisting to localStorage — images are too large for the 5MB quota
  // only save metadata (id + date), not the image data
  try {
    localStorage.setItem(getKey("mock_gallery"), JSON.stringify(
      list.map((g) => ({ id: g.id, image: "[mock]", createdAt: g.createdAt.toISOString() }))
    ));
  } catch { /* ignore quota errors */ }
}

let memoryGallery = [];

export async function saveToGallery(image) {
  const list = loadGallery();
  const newId = id();
  const imageUrl = image instanceof Blob ? URL.createObjectURL(image) : image;
  const item = { id: newId, image: imageUrl, createdAt: new Date() };
  list.unshift(item);
  memoryGallery = list;
  saveGalleryList(list);
  galleryListeners.forEach((cb) => cb(list));
  return { id: newId, image: imageUrl };
}

export function subscribeGallery(cb) {
  galleryListeners.add(cb);
  cb(loadGallery());
  window.addEventListener("storage", (e) => { if (e.key === GALLERY_KEY) cb(loadGallery()); });
  return () => galleryListeners.delete(cb);
}

export async function removeFromGallery(gid) {
  saveGalleryList(loadGallery().filter((g) => g.id !== gid));
  galleryListeners.forEach((cb) => cb(loadGallery()));
}
