/* ============================================================
   Backend abstraction
   ------------------------------------------------------------
   app.js talks ONLY to this module. It loads the correct
   backend based on the BACKEND setting in config.js.
   ============================================================ */

import { BACKEND, USE_MOCK } from "./config.js";

let impl;

if (USE_MOCK || BACKEND === "mock") {
  impl = await import("./mock-backend.js");
} else {
  impl = await import("./supabase-backend.js");
}

export const initAuth           = impl.initAuth;
export const subscribe          = impl.subscribe;
export const sendMessage        = impl.sendMessage;
export const removeMessage      = impl.removeMessage;
export const softDeleteMessage  = impl.softDeleteMessage;
export const editMessage        = impl.editMessage;
export const addReaction        = impl.addReaction;
export const removeReaction     = impl.removeReaction;
export const blockUser          = impl.blockUser;
export const unblockUser        = impl.unblockUser;
export const getBlockedUsers    = impl.getBlockedUsers;
export const subscribeBlocked   = impl.subscribeBlocked;
export const sendDm             = impl.sendDm;
export const removeDm           = impl.removeDm;
export const subscribeDm        = impl.subscribeDm;
export const saveToGallery      = impl.saveToGallery;
export const subscribeGallery   = impl.subscribeGallery;
export const removeFromGallery  = impl.removeFromGallery;
export const setNotice          = impl.setNotice;
export const subscribeNotice    = impl.subscribeNotice;
export const searchMessages     = impl.searchMessages || (async () => []);
export const loadMoreMessages   = impl.loadMoreMessages || (async () => []);
export const setChannel         = impl.setChannel || (() => {});
export const getChannelPasscode = impl.getChannelPasscode || (async () => null);
export const IS_MOCK            = USE_MOCK || BACKEND === "mock";
