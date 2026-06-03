/* app.js — boot, auth flow, tab switching, modal close handlers, confirm dialog */

const App = (function () {
  let confirmCb = null;
  let booted = false;

  function init() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Header buttons
    document.getElementById('add-job-btn').addEventListener('click', () => JobForm.open());
    document.getElementById('settings-btn').addEventListener('click', () => SettingsUI.open());

    // Modal close-on-backdrop and close buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.close).hidden = true;
      });
    });
    document.querySelectorAll('.modal-backdrop, .drawer-backdrop').forEach(bd => {
      bd.addEventListener('click', (e) => { if (e.target === bd) bd.hidden = true; });
    });

    // Esc closes top-most modal
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = Array.from(document.querySelectorAll('.modal-backdrop, .drawer-backdrop'))
        .filter(el => !el.hidden);
      if (open.length) open[open.length - 1].hidden = true;
    });

    // Confirm dialog wiring
    document.getElementById('confirm-yes').addEventListener('click', () => {
      const cb = confirmCb;
      confirmCb = null;
      document.getElementById('confirm-modal').hidden = true;
      if (typeof cb === 'function') cb();
    });
    document.getElementById('confirm-no').addEventListener('click', () => {
      confirmCb = null;
      document.getElementById('confirm-modal').hidden = true;
    });

  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.view').forEach(v => {
      v.classList.toggle('active', v.id === `view-${name}`);
    });
    if (name === 'dashboard') Dashboard.render();
    if (name === 'jobs') JobsTable.render();
    if (name === 'payments') PaymentLog.render();
    if (name === 'clientpay') ClientPay.render();
    if (name === 'team') Team.render();
    if (name === 'insights') Insights.render();
  }

  function confirm(title, message, onYes) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message || '';
    confirmCb = onYes;
    document.getElementById('confirm-modal').hidden = false;
  }

  function showAuthState(state) {
    const overlay = document.getElementById('auth-overlay');
    overlay.hidden = false;
    overlay.querySelectorAll('.auth-state').forEach(el => {
      el.hidden = el.dataset.state !== state;
    });
  }

  function hideAuth() {
    document.getElementById('auth-overlay').hidden = true;
  }

  async function bootApp({ mode, user, firestore }) {
    if (booted) return;
    booted = true;
    await Storage.init({
      mode: mode === 'authed' ? 'firebase' : 'local',
      user,
      firestoreInst: firestore
    });
    Jobs.load();
    Theme.init();
    JobForm.init();
    JobsTable.init();
    Payments.init();
    PaymentLog.init();
    ClientPay.init();
    Dashboard.init();
    Team.init();
    Insights.init();
    SettingsUI.init();
    init();
    Dashboard.render();
    JobsTable.render();
  }

  function onAuthChange({ mode, user, firestore }) {
    if (mode === 'pending') {
      showAuthState('loading');
    } else if (mode === 'signin') {
      showAuthState('signin');
    } else if (mode === 'error') {
      showAuthState('error');
    } else if (mode === 'setup') {
      showAuthState('setup');
    } else if (mode === 'authed') {
      hideAuth();
      bootApp({ mode, user, firestore });
    } else if (mode === 'local') {
      hideAuth();
      bootApp({ mode, user: null, firestore: null });
    }
  }

  return { init, switchTab, confirm, onAuthChange };
})();

document.addEventListener('DOMContentLoaded', () => {
  // Auth buttons must be wired before auth state is evaluated
  document.getElementById('signin-btn').addEventListener('click', () => Auth.signIn());
  document.getElementById('signin-retry').addEventListener('click', () => Auth.signIn());
  document.getElementById('continue-local-btn').addEventListener('click', () => Auth.continueLocal());

  Auth.onChange(App.onAuthChange);
  Auth.init();
});
