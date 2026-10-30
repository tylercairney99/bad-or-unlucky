// js/theme.js — synchronous theme bootstrap, loaded in <head> before first paint (classic script, no module).
// Sets <html data-theme> from the saved choice, else from the OS setting, so the page never flashes the wrong theme.
// The toggle button and OS-change listener live in js/app.js.
(function () {
  var root = document.documentElement;
  var saved = null;
  try {
    saved = window.localStorage.getItem('bou:theme');
  } catch (e) {
    /* storage blocked (private mode, sandbox) — fall back to the OS setting */
  }
  var theme = saved === 'light' || saved === 'dark' ? saved : null;
  if (!theme) {
    var dark = false;
    try {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) {
      /* very old browser */
    }
    theme = dark ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', theme);

  // A saved choice overrides the OS, so both theme-color metas must follow it.
  if (saved === theme) {
    var color = theme === 'dark' ? '#0F1115' : '#F7F5F0';
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', color);
  }
})();
