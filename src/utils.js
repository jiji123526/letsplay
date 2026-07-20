/* ============================================================
   Shared Utilities
   ============================================================ */

/** SHA-256 hash a string, returning hex digest */
export async function hashString(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
