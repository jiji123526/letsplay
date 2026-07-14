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

export async function sendMessage({ uid, nick, text, is_admin }) {
  const list = load();
  list.push({ id: id(), uid, nick, text, is_admin: !!is_admin, createdAt: new Date() });
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
