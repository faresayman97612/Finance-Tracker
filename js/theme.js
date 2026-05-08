/* theme.js — light/dark theme with system preference + persistence */

const Theme = (function () {
  const PREFS = ['light', 'dark', 'system'];
  let currentPref = 'system';
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function effective(pref) {
    if (pref === 'system') return mediaQuery.matches ? 'dark' : 'light';
    return pref;
  }

  function apply(pref) {
    currentPref = PREFS.includes(pref) ? pref : 'system';
    const eff = effective(currentPref);
    document.documentElement.setAttribute('data-theme', eff);
    document.documentElement.setAttribute('data-theme-pref', currentPref);
    // Persist into settings + a separate localStorage key for the no-flash inline script
    if (typeof Storage !== 'undefined' && Storage.getSettings) {
      const settings = Storage.getSettings();
      settings.theme = currentPref;
      Storage.saveSettings(settings);
    }
    try { localStorage.setItem('finance.theme', currentPref); } catch (e) {}
    // Notify charts/etc to recolor
    window.dispatchEvent(new CustomEvent('themechange', {
      detail: { pref: currentPref, effective: eff }
    }));
  }

  function init() {
    const settings = Storage.getSettings();
    apply(settings.theme || 'system');

    // React to OS changes when in system mode
    mediaQuery.addEventListener('change', () => {
      if (currentPref === 'system') apply('system');
    });

    // Header toggle cycles through: light → dark → system → light…
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', () => {
        const next = PREFS[(PREFS.indexOf(currentPref) + 1) % PREFS.length];
        apply(next);
        Utils.toast(`Theme: ${next}`, 'info', 1200);
      });
    }
  }

  function getPref() { return currentPref; }
  function getEffective() { return effective(currentPref); }

  return { init, apply, getPref, getEffective };
})();
