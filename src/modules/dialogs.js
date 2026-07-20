/* ============================================================
   Dialogs Module — reusable confirm/prompt/edit/passcode dialogs
   ============================================================ */

import { hashString } from "../utils.js";

/**
 * Show a confirmation dialog with title, message, and confirm/cancel buttons.
 */
export function showConfirmDialog(title, message, onConfirm) {
  const dialog = document.createElement("div");
  dialog.className = "confirm-dialog";
  dialog.innerHTML = `
    <div class="edit-dialog-content">
      <div class="edit-dialog-title">${title}</div>
      <div style="font-size:var(--bubble-font-size, 14px);color:var(--meta);margin-bottom:16px;line-height:1.5;">${message}</div>
      <div class="edit-dialog-buttons">
        <button class="edit-dialog-cancel">취소</button>
        <button class="edit-dialog-save">확인</button>
      </div>
    </div>
  `;
  dialog.querySelector(".edit-dialog-save").addEventListener("click", () => { dialog.remove(); onConfirm(); });
  dialog.querySelector(".edit-dialog-cancel").addEventListener("click", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.remove(); });
  document.body.appendChild(dialog);
}

/**
 * Show a prompt dialog with a single text input.
 */
export function showPromptDialog(title, placeholder, onSubmit) {
  const dialog = document.createElement("div");
  dialog.className = "confirm-dialog";
  dialog.innerHTML = `
    <div class="edit-dialog-content">
      <div class="edit-dialog-title">${title}</div>
      <input class="notice-edit-title" type="text" placeholder="${placeholder}" />
      <div class="edit-dialog-buttons">
        <button class="edit-dialog-cancel">취소</button>
        <button class="edit-dialog-save">확인</button>
      </div>
    </div>
  `;
  const input = dialog.querySelector("input");
  dialog.querySelector(".edit-dialog-save").addEventListener("click", () => {
    const val = input.value.trim();
    if (val) { dialog.remove(); onSubmit(val); }
  });
  dialog.querySelector(".edit-dialog-cancel").addEventListener("click", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.remove(); });
  document.body.appendChild(dialog);
  input.focus();
}

/**
 * Show an edit dialog with a textarea pre-filled with current text.
 */
export function showEditDialog(currentText, onSave) {
  document.querySelector(".edit-dialog")?.remove();

  const dialog = document.createElement("div");
  dialog.className = "edit-dialog";
  dialog.innerHTML = `
    <div class="edit-dialog-content">
      <div class="edit-dialog-title">메시지 수정</div>
      <textarea class="edit-dialog-input" rows="4">${currentText || ""}</textarea>
      <div class="edit-dialog-buttons">
        <button class="edit-dialog-cancel">취소</button>
        <button class="edit-dialog-save">저장</button>
      </div>
    </div>
  `;

  const textarea = dialog.querySelector(".edit-dialog-input");

  dialog.querySelector(".edit-dialog-save").addEventListener("click", () => {
    const text = textarea.value;
    dialog.remove();
    onSave(text);
  });
  dialog.querySelector(".edit-dialog-cancel").addEventListener("click", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.remove(); });

  document.body.appendChild(dialog);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

/**
 * Show a passcode dialog for channel access.
 * @param {object} targetChannel - channel config with .name, .passcode, .id
 * @param {function} onSuccess - called when passcode matches
 * @param {object} deps - { getChannelPasscode, IS_MOCK }
 */
export function showPasscodeDialog(targetChannel, onSuccess, { getChannelPasscode, IS_MOCK }) {
  document.querySelector(".passcode-dialog")?.remove();

  const dialog = document.createElement("div");
  dialog.className = "passcode-dialog";
  dialog.innerHTML = `
    <div class="passcode-dialog-content">
      <div class="passcode-dialog-title">${targetChannel.name}</div>
      <div class="passcode-dialog-subtitle">비밀번호를 입력하세요</div>
      <input class="passcode-dialog-input" type="password" autocomplete="off" inputmode="numeric" />
      <div class="passcode-dialog-error" style="display:none">비밀번호가 틀렸습니다</div>
      <div class="passcode-dialog-buttons">
        <button class="passcode-dialog-cancel">취소</button>
        <button class="passcode-dialog-confirm">확인</button>
      </div>
    </div>
  `;

  const input = dialog.querySelector(".passcode-dialog-input");
  const errorEl = dialog.querySelector(".passcode-dialog-error");

  // fetch passcode hash from DB, fall back to config.js
  let storedHash = targetChannel.passcode || null;
  let hashReady = IS_MOCK;
  if (!IS_MOCK) {
    getChannelPasscode(targetChannel.id).then(dbHash => {
      if (dbHash) storedHash = dbHash;
      hashReady = true;
    }).catch(() => { hashReady = true; });
  }

  function submit() {
    if (!hashReady) return; // wait for DB fetch
    const code = input.value.trim();
    if (!code) return;
    hashString(code).then(hashed => {
      if (storedHash && hashed === storedHash) {
        dialog.remove();
        onSuccess();
      } else {
        errorEl.style.display = "block";
        input.value = "";
        input.focus();
      }
    });
  }

  dialog.querySelector(".passcode-dialog-confirm").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  });
  dialog.querySelector(".passcode-dialog-cancel").addEventListener("click", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.remove(); });

  document.body.appendChild(dialog);
  setTimeout(() => input.focus(), 100);
}
