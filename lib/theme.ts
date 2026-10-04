/**
 * Light / dark / system theme — a per-browser choice, like sidebar collapse,
 * so it lives in localStorage rather than per-token prefs.
 *
 * The stored value is the *preference*; `data-theme` on <html> is always the
 * *resolved* mode ('light' | 'dark'), so the CSS only ever has one light block
 * and never needs a prefers-color-scheme duplicate. THEME_SCRIPT runs in <head>
 * before first paint (no dark flash on a light-mode reload) and keeps
 * following the OS while the page is open when the choice is 'system'.
 */

export type ThemePref = 'dark' | 'light' | 'system'

export const THEME_KEY = 'kindling:theme'
const THEME_EVENT = 'kindling:theme'

/** Browser chrome colour per mode — each is that mode's --color-bg. */
const THEME_COLOR = { dark: '#141018', light: '#f6efe6' } as const

/** Dark is the default for a browser that has never chosen. */
const parsePref = (raw: string | null): ThemePref =>
  raw === 'light' || raw === 'system' ? raw : 'dark'

/*
 * Keep this and applyTheme below in step: this copy has to be a self-contained
 * string because it runs before any bundle loads.
 */
export const THEME_SCRIPT = `(function(){
  var m = window.matchMedia('(prefers-color-scheme: light)');
  var apply = function () {
    var p = null;
    try { p = localStorage.getItem('${THEME_KEY}'); } catch (e) {}
    var light = p === 'light' || (p === 'system' && m.matches);
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '${THEME_COLOR.light}' : '${THEME_COLOR.dark}');
  };
  apply();
  m.addEventListener('change', apply);
  window.addEventListener('storage', function (e) { if (e.key === '${THEME_KEY}') apply(); });
})();`

const applyTheme = (pref: ThemePref): void => {
  const light =
    pref === 'light' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)
  document.documentElement.dataset.theme = light ? 'light' : 'dark'
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', light ? THEME_COLOR.light : THEME_COLOR.dark)
}

export const readTheme = (): ThemePref => {
  try {
    return parsePref(localStorage.getItem(THEME_KEY))
  } catch {
    return 'dark'
  }
}

export const subscribeTheme = (onChange: () => void): (() => void) => {
  window.addEventListener('storage', onChange)
  window.addEventListener(THEME_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(THEME_EVENT, onChange)
  }
}

export const writeTheme = (pref: ThemePref): void => {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    /* private mode: the choice applies now but won't persist */
  }
  applyTheme(pref)
  window.dispatchEvent(new Event(THEME_EVENT))
}
