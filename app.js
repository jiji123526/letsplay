/* ============================================================
   iMessage UI  —  realtime chat (backend-agnostic)
   ------------------------------------------------------------
   This file is pure UI/UX. It talks only to ./backend.js, which
   is either the local mock (localStorage, no Firebase) or real
   Firebase — controlled by USE_MOCK in firebase-config.js.

   Message object: { id, uid, nick, text, is_admin, createdAt:Date }
   Renders blue "sent" when uid === my uid, else gray "recv".
   ============================================================ */

import { initAuth, subscribe, sendMessage, removeMessage, IS_MOCK } from "./backend.js";
import { ADMIN_PASSCODE } from "./firebase-config.js";

const $ = (s) => document.querySelector(s);
const messagesEl = $("#messages");

/* ---------- local state ---------- */
let myUid   = null;
let myNick  = "";          // derived from uid on sign-in (anonymous tag)
let isAdmin = false;
let messages = [];               // live list from the backend

/* ============================================================
   RENDERING  (your original iMessage logic, driven by live data)
   ============================================================ */
function render() {
  messagesEl.innerHTML = "";

  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const isMe = m.uid === myUid;

    /* date separator when the day changes (or first message) */
    const sepLabel = daySeparator(m, prev);
    if (sepLabel) {
      const sep = document.createElement("div");
      sep.className = "time-sep";
      sep.innerHTML = `<b>${sepLabel}</b>`;
      messagesEl.appendChild(sep);
    }

    /* grouping: same sender back-to-back with no separator between */
    const samePrev = prev && prev.uid === m.uid && !sepLabel;
    const sameNext = next && next.uid === m.uid && !daySeparator(next, m);
    const isTail = !sameNext;

    const row = document.createElement("div");
    row.className = `row ${isMe ? "sent" : "recv"}` + (samePrev ? "" : " group-start");

    const col = document.createElement("div");
    col.className = "bubble-col";

    /* sender nickname atop a group of received messages */
    if (!isMe && !samePrev) {
      const nm = document.createElement("div");
      nm.className = "sender-name";
      nm.textContent = m.nick + (m.is_admin ? " 👑" : "");
      col.appendChild(nm);
    }

    const bubble = document.createElement("div");
    bubble.className = `bubble ${isMe ? "sent" : "recv"}`;
    if (isTail) bubble.classList.add("tail");
    if (samePrev) bubble.classList.add("stacked-top");
    if (sameNext) bubble.classList.add("stacked");
    bubble.textContent = m.text;

    /* admins can delete any message (tap to delete) */
    if (isAdmin) {
      bubble.style.cursor = "pointer";
      bubble.title = "관리자: 탭하여 삭제";
      bubble.addEventListener("click", () => removeMessage(m.id));
    }

    col.appendChild(bubble);
    row.appendChild(col);
    messagesEl.appendChild(row);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* returns a label ("Today" / "Yesterday" / "Mon, Jul 14") if `m`
   starts a new day relative to `prev`, else "" */
function daySeparator(m, prev) {
  const d = tsToDate(m);
  if (!d) return "";
  if (prev) {
    const p = tsToDate(prev);
    if (p && sameDay(d, p)) return "";
  }
  return labelForDay(d);
}

function tsToDate(m) {
  // backend hands us a Date (or null for a beat until a server write lands)
  return m.createdAt instanceof Date ? m.createdAt : null;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}
function labelForDay(d) {
  const now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/* ============================================================
   AUTH  —  everyone is anonymous by default.
   Two roles only:  anonymous  |  admin (password-gated).
   No user-chosen names: an anonymous tag is derived from the uid.
   ============================================================ */
function anonNameFor(uid) {
  // stable per-user tag like "익명#3f9a" so users are distinguishable
  return "익명#" + String(uid).slice(-4);
}

initAuth().then((uid) => {
  myUid = uid;
  myNick = anonNameFor(uid);
  showEntryGate();          // pick a role (anon by default), then enter
}).catch((e) => {
  console.error("auth failed", e);
  banner(IS_MOCK ? "초기화 실패" : "익명 로그인 실패 — Authentication에서 Anonymous를 켜세요");
});

/* ============================================================
   COMPOSER
   ============================================================ */
const input   = $("#msgInput");
const sendBtn = $("#sendBtn");
const micBtn  = $("#micBtn");

function toggleSend() {
  const has = input.value.trim().length > 0;
  sendBtn.hidden = !has;
  micBtn.hidden = has;
}

async function send() {
  const text = input.value.trim();
  if (!text || !myUid) return;
  input.value = "";
  toggleSend();
  const nick = isAdmin ? "관리자" : myNick;
  try { await sendMessage({ uid: myUid, nick, text, is_admin: isAdmin }); }
  catch (e) { console.error("send failed", e); banner("전송 실패"); }
}

input.addEventListener("input", toggleSend);
input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
sendBtn.addEventListener("click", send);

/* ============================================================
   THEME TOGGLE  (unchanged)
   ============================================================ */
$("#themeToggle").addEventListener("click", () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
});

/* ============================================================
   ENTRY GATE  —  no name entry. Anonymous by default; admin is
   password-gated via the "관리자 모드" toggle (mirrors the original).
   ============================================================ */
function showEntryGate() {
  const overlay = document.createElement("div");
  overlay.className = "gate";
  overlay.innerHTML = `
    <div class="gate-card">
      <div class="gate-logo">🍋</div>
      <div class="gate-title">놀이터</div>
      <div class="gate-sub">익명으로 자유롭게 대화해요</div>
      <label class="gate-admin">
        <span class="gate-switch"><input type="checkbox" id="adminChk" /><span class="gate-knob"></span></span>
        <span>관리자 모드</span>
      </label>
      <input id="adminPass" class="gate-input" type="password" placeholder="관리자 비밀번호" style="display:none" />
      <button id="enterBtn" class="gate-btn">익명으로 입장하기 →</button>
      <div id="gateErr" class="gate-err"></div>
    </div>`;
  document.body.appendChild(overlay);

  const adminChk  = overlay.querySelector("#adminChk");
  const adminPass = overlay.querySelector("#adminPass");
  const err       = overlay.querySelector("#gateErr");

  adminChk.addEventListener("change", () => {
    adminPass.style.display = adminChk.checked ? "block" : "none";
    if (adminChk.checked) adminPass.focus();
  });

  const enter = () => {
    if (adminChk.checked) {
      if (adminPass.value !== ADMIN_PASSCODE) { err.textContent = "비밀번호가 틀렸습니다"; return; }
      isAdmin = true;               // admin role
    } else {
      isAdmin = false;              // anonymous role (default)
    }
    overlay.remove();
    startChat();
  };

  overlay.querySelector("#enterBtn").addEventListener("click", enter);
  adminPass.addEventListener("keydown", (e) => { if (e.key === "Enter") enter(); });
}

/* ---------- start ---------- */
let started = false;
function startChat() {
  if (started) return;
  started = true;
  subscribe((list) => { messages = list; render(); });
  toggleSend();
}

/* small non-blocking error banner */
function banner(msg) {
  let b = $("#banner");
  if (!b) {
    b = document.createElement("div");
    b.id = "banner";
    b.className = "banner";
    document.body.appendChild(b);
  }
  b.textContent = msg;
}
