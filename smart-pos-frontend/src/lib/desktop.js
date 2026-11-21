/**
 * Access to the NUMZ POS desktop bridge (window.numzDesktop), which only exists
 * when the app runs inside the Electron shell. In a normal browser this returns
 * null and every caller falls back to the existing web behaviour, so the web
 * build is unaffected.
 */
export function getDesktopBridge() {
  if (typeof window === 'undefined') return null;
  const bridge = window.numzDesktop;
  return bridge && bridge.isDesktop === true ? bridge : null;
}

export function isDesktopApp() {
  return getDesktopBridge() !== null;
}
