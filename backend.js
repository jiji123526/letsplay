/* ============================================================
   Backend abstraction
   ------------------------------------------------------------
   app.js talks ONLY to this module, never to Firebase directly.
   It exposes one small interface, backed by either:
     • a local mock (localStorage) when USE_MOCK === true
     • real Firebase (Firestore + Anonymous Auth) otherwise

   Interface:
     initAuth()                  -> Promise<uid>
     subscribe(cb)               cb(messages[])  on every change
     sendMessage({uid,nick,text,is_admin})
     removeMessage(id)
   Message object: { id, uid, nick, text, is_admin, createdAt:Date }
   ============================================================ */

import { USE_MOCK } from "./firebase-config.js";

let impl;

if (USE_MOCK) {
  impl = await import("./mock-backend.js");
} else {
  impl = await import("./firebase-backend.js");
}

export const initAuth      = impl.initAuth;
export const subscribe     = impl.subscribe;
export const sendMessage   = impl.sendMessage;
export const removeMessage = impl.removeMessage;
export const IS_MOCK       = USE_MOCK;
