/* ============================================================
   Device Fingerprint — for ban enforcement
   ============================================================ */

/**
 * Generate a stable device fingerprint from browser characteristics.
 * Not meant to be cryptographically secure — just enough to identify
 * a device even if the user clears localStorage.
 */
export function generateFingerprint() {
  const nav = window.navigator;
  const scr = window.screen;
  const components = [
    nav.userAgent,
    nav.language,
    nav.hardwareConcurrency,
    scr.width,
    scr.height,
    scr.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join("|");

  // simple hash (same as terislemon)
  let hash = 0;
  for (let i = 0; i < components.length; i++) {
    hash = Math.imul(31, hash) + components.charCodeAt(i) | 0;
  }
  return "fp_" + Math.abs(hash).toString(36);
}
