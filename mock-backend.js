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

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]").map((m) => ({
      ...m, createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
    }));
  } catch { return []; }
}
function save(list) {
  localStorage.setItem(KEY, JSON.stringify(
    list.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))
  ));
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

export async function sendMessage({ uid, nick, text, is_admin, replyTo, report, reportedMsgId, image }) {
  const list = load();
  const msg = { id: id(), uid, nick, text, is_admin: !!is_admin, replyTo: replyTo || null, createdAt: new Date() };
  if (report) { msg.report = true; msg.reportedMsgId = reportedMsgId || null; }
  if (image) { msg.image = image; }
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
  if (msg) { msg.deleted = true; msg.text = ""; }
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

export async function markReported(mid, reported) {
  const list = load();
  const msg = list.find((m) => m.id === mid);
  if (msg) { msg.reported = reported; }
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
    const raw = JSON.parse(localStorage.getItem(BLOCK_KEY) || "[]");
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
    localStorage.setItem(BLOCK_KEY, JSON.stringify(list));
  }
}

export async function unblockUser(uid) {
  const list = loadBlocked().filter((b) => b.uid !== uid);
  localStorage.setItem(BLOCK_KEY, JSON.stringify(list));
}
