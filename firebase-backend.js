/* ============================================================
   FIREBASE backend  —  Firestore + Anonymous Auth.
   Same interface as mock-backend.js so app.js doesn't care which
   one is active. Used when USE_MOCK === false.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, deleteDoc, doc, updateDoc,
  onSnapshot, orderBy, query, serverTimestamp, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const msgCol = collection(db, "messages");
const dmCol = collection(db, "dm");
const galleryCol = collection(db, "gallery");
const noticeDoc = doc(db, "config", "notice");

export function initAuth() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, (user) => { if (user) resolve(user.uid); });
    signInAnonymously(auth).catch(reject);
  });
}

export function subscribe(cb) {
  const q = query(msgCol, orderBy("createdAt", "asc"), limit(500));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id, ...data,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
      };
    }));
  });
}

export async function sendMessage({ uid, nick, text, is_admin, replyTo, report, reportedMsgId, image, dm, galleryId }) {
  const authUid = auth.currentUser.uid;
  const data = { uid, authUid, nick, text, is_admin: !!is_admin, createdAt: serverTimestamp() };
  if (replyTo) data.replyTo = replyTo;
  if (report) { data.report = true; data.reportedMsgId = reportedMsgId || null; }
  if (image) data.image = image;
  if (dm) data.dm = true;
  if (galleryId) data.galleryId = galleryId;
  await addDoc(msgCol, data);
}

export async function removeMessage(id) {
  await deleteDoc(doc(db, "messages", id));
}

export async function softDeleteMessage(id) {
  await updateDoc(doc(db, "messages", id), { deleted: true, text: "" });
}

export async function editMessage(id, newText) {
  await updateDoc(doc(db, "messages", id), { text: newText, edited: true });
}

export async function markReported(id, reported) {
  await updateDoc(doc(db, "messages", id), { reported: !!reported });
}

export async function addReaction(id, emoji, uid) {
  const key = `${uid}_${emoji.codePointAt(0).toString(16)}`;
  const msgRef = doc(db, "messages", id);
  const { getDoc: getDocSnap } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const snap = await getDocSnap(msgRef);
  const reactions = snap.data()?.reactions || {};
  if (reactions[key]) {
    // toggle off
    const { deleteField } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    await updateDoc(msgRef, { [`reactions.${key}`]: deleteField() });
  } else {
    await updateDoc(msgRef, { [`reactions.${key}`]: emoji });
  }
}

export async function removeReaction(id, uid) {
  // remove a specific reaction by key
  const { deleteField } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  await updateDoc(doc(db, "messages", id), { [`reactions.${uid}`]: deleteField() });
}

/* ---- block list (stored in Firestore blocked collection) ---- */
const blockedCol = collection(db, "blocked");
let _blockedList = [];
let _blockedListeners = new Set();

// realtime subscription to blocked users
onSnapshot(query(blockedCol), (snap) => {
  _blockedList = snap.docs.map((d) => ({ uid: d.data().uid, reason: d.data().reason || "" }));
  _blockedListeners.forEach((cb) => cb(_blockedList));
});

export function getBlockedUsers() {
  return _blockedList;
}

export function subscribeBlocked(cb) {
  _blockedListeners.add(cb);
  cb(_blockedList);
  return () => _blockedListeners.delete(cb);
}

export async function blockUser(uid, reason) {
  await addDoc(blockedCol, { uid, reason: reason || "", blockedAt: serverTimestamp() });
}

export async function unblockUser(uid) {
  const snap = await getDocs(query(blockedCol));
  const docToDelete = snap.docs.find((d) => d.data().uid === uid);
  if (docToDelete) await deleteDoc(doc(db, "blocked", docToDelete.id));
}

/* ---- DM (separate collection, only admin subscribes) ---- */
export async function sendDm({ uid, nick, text, image }) {
  const authUid = auth.currentUser.uid;
  const data = { uid, authUid, nick, text, createdAt: serverTimestamp() };
  if (image) data.image = image;
  await addDoc(dmCol, data);
}

export async function removeDm(id) {
  await deleteDoc(doc(db, "dm", id));
}

export function subscribeDm(cb) {
  const q = query(dmCol, orderBy("createdAt", "asc"), limit(500));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null };
    }));
  });
}

/* ---- Gallery ---- */
export async function saveToGallery(image) {
  const ref = await addDoc(galleryCol, { image, createdAt: serverTimestamp() });
  return ref.id;
}

/* ---- Notice (global, stored in config/notice doc) ---- */
export async function setNotice(text) {
  const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  await setDoc(noticeDoc, { text, updatedAt: serverTimestamp() });
}

export function subscribeNotice(cb) {
  return onSnapshot(noticeDoc, (snap) => {
    if (snap.exists()) {
      cb(snap.data().text || "");
    } else {
      cb("");
    }
  });
}

export function subscribeGallery(cb) {
  const q = query(galleryCol, orderBy("createdAt", "desc"), limit(100));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null };
    }));
  });
}

export async function removeFromGallery(id) {
  await deleteDoc(doc(db, "gallery", id));
}
