/* ============================================================
   Backend abstraction
   ------------------------------------------------------------
   app.js talks ONLY to this module. It loads the correct
   backend based on the BACKEND setting in config.js.
   ============================================================ */

import { BACKEND, USE_MOCK } from "../../config.js";

let impl;

if (USE_MOCK || BACKEND === "mock") {
  impl = await import("./mock.js");
} else {
  impl = await import("./supabase.js");
}

export const initAuth           = impl.initAuth;
export const initFromServer     = impl.initFromServer || (async () => null);
export const onConnectionChange = impl.onConnectionChange || (() => () => {});
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
export const setAdminCredential = impl.setAdminCredential || (() => {});
export const setClientFingerprint = impl.setClientFingerprint || (() => {});
export const getChannelPasscode = impl.getChannelPasscode || (async () => null);
export const getLiveStatus      = impl.getLiveStatus || (async () => false);
export const subscribeLiveStatus = impl.subscribeLiveStatus || (() => () => {});
export const broadcastLiveStatus = impl.broadcastLiveStatus || (() => {});
export const subscribeLivePresence = impl.subscribeLivePresence || ((_channelId, cb) => { cb(1); return () => {}; });
export const initBroadcast      = impl.initBroadcast || (() => {});
export const onEditBroadcast    = impl.onEditBroadcast || (() => () => {});
export const onEmojiBroadcast   = impl.onEmojiBroadcast || (() => () => {});
export const broadcastEdit      = impl.broadcastEdit || (() => {});
export const broadcastDelete    = impl.broadcastDelete || (() => {});
export const onDeleteBroadcast  = impl.onDeleteBroadcast || (() => () => {});
export const broadcastRefresh   = impl.broadcastRefresh || (() => {});
export const onRefreshBroadcast = impl.onRefreshBroadcast || (() => () => {});
export const broadcastFreeze    = impl.broadcastFreeze || (() => {});
export const onFreezeBroadcast  = impl.onFreezeBroadcast || (() => () => {});
export const broadcastProfile   = impl.broadcastProfile || (() => {});
export const onProfileBroadcast = impl.onProfileBroadcast || (() => () => {});
export const broadcastEmoji     = impl.broadcastEmoji || (() => {});
export const IS_MOCK            = USE_MOCK || BACKEND === "mock";
