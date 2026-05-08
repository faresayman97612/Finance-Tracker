/* settings.js — drawer for account/theme/currency/freelancers/data */

const SettingsUI = (function () {
  const els = {};

  function init() {
    els.drawer = document.getElementById('settings-drawer');
    els.accountBody = document.getElementById('settings-account-body');
    els.themeSeg = document.getElementById('theme-segmented');
    els.currency = document.getElementById('currency-select');
    els.freelancers = document.getElementById('settings-freelancers');
    els.newFreelancer = document.getElementById('settings-new-freelancer');
    els.addBtn = document.getElementById('settings-add-freelancer');
    els.exportBtn = document.getElementById('export-btn');
    els.importBtn = document.getElementById('import-btn');
    els.importFile = document.getElementById('import-file');
    els.clearBtn = document.getElementById('clear-btn');

    els.themeSeg.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        Theme.apply(btn.dataset.themePick);
        refresh();
      });
    });

    els.currency.addEventListener('change', () => {
      const settings = Storage.getSettings();
      settings.currency = els.currency.value;
      Storage.saveSettings(settings);
      Utils.toast(`Currency: ${els.currency.value}`, 'info', 1200);
      JobsTable.render();
      Dashboard.render();
    });

    els.addBtn.addEventListener('click', addFreelancer);
    els.newFreelancer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addFreelancer(); }
    });

    els.exportBtn.addEventListener('click', exportData);
    els.importBtn.addEventListener('click', () => els.importFile.click());
    els.importFile.addEventListener('change', importData);
    els.clearBtn.addEventListener('click', clearAll);
  }

  function open() { refresh(); els.drawer.hidden = false; }
  function close() { els.drawer.hidden = true; }

  function renderAccount() {
    const mode = Storage.getMode();
    const user = Auth.getUser();
    if (mode === 'firebase' && user) {
      els.accountBody.innerHTML = `
        <div class="auth-status">
          <span class="as-dot"></span>
          <div class="as-text">
            <strong>${Utils.escapeHTML(user.displayName || user.email)}</strong>
            ${Utils.escapeHTML(user.email)} · synced to cloud
          </div>
        </div>
        <button type="button" class="btn btn-secondary" id="signout-btn" style="width:100%; justify-content:center">Sign out</button>
      `;
      const btn = document.getElementById('signout-btn');
      btn.addEventListener('click', () => {
        App.confirm('Sign out?', 'Local cached data will be cleared. Cloud data is safe.', async () => {
          await Auth.signOut();
          location.reload();
        });
      });
    } else {
      const configured = Auth.isConfigured();
      els.accountBody.innerHTML = `
        <div class="auth-status">
          <span class="as-dot local"></span>
          <div class="as-text">
            <strong>Local mode</strong>
            ${configured ? 'Cloud config found — sign in to sync' : 'Firebase not configured (firebase-config.js)'}
          </div>
        </div>
        ${configured ? '<button type="button" class="btn btn-primary" id="signin-from-settings" style="width:100%; justify-content:center">Sign in with Google</button>' : ''}
      `;
      const signinBtn = document.getElementById('signin-from-settings');
      if (signinBtn) signinBtn.addEventListener('click', () => Auth.signIn());
    }
  }

  function refresh() {
    const settings = Storage.getSettings();
    renderAccount();
    els.themeSeg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.themePick === Theme.getPref());
    });
    els.currency.value = settings.currency;
    els.freelancers.innerHTML = '';
    if (settings.freelancers.length === 0) {
      const empty = document.createElement('span');
      empty.style.cssText = 'color:var(--text-muted);font-size:12px;';
      empty.textContent = 'No freelancers yet.';
      els.freelancers.appendChild(empty);
    } else {
      settings.freelancers.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'chip chip-removable';
        chip.innerHTML = `${Utils.escapeHTML(name)}<span class="x">×</span>`;
        chip.querySelector('.x').addEventListener('click', () => {
          const s = Storage.getSettings();
          s.freelancers = s.freelancers.filter(f => f !== name);
          Storage.saveSettings(s);
          refresh();
        });
        els.freelancers.appendChild(chip);
      });
    }
  }

  function addFreelancer() {
    const name = els.newFreelancer.value.trim();
    if (!name) return;
    const settings = Storage.getSettings();
    if (!settings.freelancers.includes(name)) {
      settings.freelancers.push(name);
      Storage.saveSettings(settings);
    }
    els.newFreelancer.value = '';
    refresh();
  }

  function exportData() {
    const data = Storage.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance-backup-${Utils.todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Utils.toast('Backup exported', 'success');
  }

  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const payload = JSON.parse(ev.target.result);
        App.confirm('Import backup?', 'This will replace all current data.', async () => {
          await Storage.importAll(payload);
          Jobs.load();
          Theme.apply(Storage.getSettings().theme);
          refresh();
          JobsTable.render();
          Dashboard.render();
          Utils.toast('Data imported', 'success');
        });
      } catch (err) {
        Utils.toast('Invalid JSON file', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function clearAll() {
    App.confirm('Clear ALL data?', 'All jobs, payments, and settings will be erased.', async () => {
      await Storage.clearAll();
      Jobs.load();
      Theme.apply('system');
      refresh();
      JobsTable.render();
      Dashboard.render();
      Utils.toast('All data cleared', 'success');
    });
  }

  return { init, open, close, refresh };
})();
