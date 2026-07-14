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
  getFirestore, collection, addDoc, deleteDoc, doc,
  onSnapshot, orderBy, query, serverTimestamp, limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const msgCol = collection(db, "messages");

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

export async function sendMessage({ uid, nick, text, is_admin }) {
  await addDoc(msgCol, { uid, nick, text, is_admin: !!is_admin, createdAt: serverTimestamp() });
}

export async function removeMessage(id) {
  await deleteDoc(doc(db, "messages", id));
}
