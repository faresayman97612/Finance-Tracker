/* settings.js — drawer for account/theme/currency/freelancers/data */

const SettingsUI = (function () {
  const ROLE_OPTIONS = [
    { value: '',          label: '— Role —' },
    { value: 'designer',  label: 'Designer' },
    { value: 'dev',       label: 'Developer' },
    { value: 'pm',        label: 'Project manager' },
    { value: 'qa',        label: 'QA' },
    { value: 'other',     label: 'Other' }
  ];

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
    renderFreelancers();
  }

  function renderFreelancers() {
    const settings = Storage.getSettings();
    els.freelancers.innerHTML = '';
    els.freelancers.className = 'freelancer-editor';

    if (!settings.freelancers || settings.freelancers.length === 0) {
      const empty = document.createElement('span');
      empty.style.cssText = 'color:var(--text-muted);font-size:12px;';
      empty.textContent = 'No freelancers yet.';
      els.freelancers.appendChild(empty);
      return;
    }

    settings.freelancers.forEach(f => {
      els.freelancers.appendChild(renderFreelancerRow(f));
    });
  }

  function renderFreelancerRow(f) {
    const row = document.createElement('div');
    row.className = 'fl-row' + (f.active === false ? ' inactive' : '');
    row.dataset.id = f.id;

    const roleOptions = ROLE_OPTIONS.map(o =>
      `<option value="${o.value}" ${o.value === (f.role || '') ? 'selected' : ''}>${Utils.escapeHTML(o.label)}</option>`
    ).join('');

    row.innerHTML = `
      <div class="fl-row-main">
        <input class="input fl-name" type="text" value="${Utils.escapeHTML(f.name || '')}" placeholder="Name" aria-label="Name">
        <select class="input fl-role" aria-label="Role">${roleOptions}</select>
        <label class="fl-active" title="Active">
          <input type="checkbox" class="fl-active-cb" ${f.active === false ? '' : 'checked'}>
          <span>Active</span>
        </label>
        <button type="button" class="row-action danger fl-del" title="Delete" aria-label="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
      <details class="fl-row-more">
        <summary>More options</summary>
        <div class="fl-row-extra">
          <label class="field">
            <span>Default share %</span>
            <input class="input fl-share" type="number" min="0" max="100" step="0.5" value="${f.defaultSharePercent != null ? f.defaultSharePercent : ''}" placeholder="—">
          </label>
          <label class="field">
            <span>Preferred method</span>
            <select class="input fl-method">
              <option value="">—</option>
              ${['Telda','Instapay','VodafoneCash','Cash'].map(m => `<option value="${m}" ${m === (f.preferredMethod || '') ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Email</span>
            <input class="input fl-email" type="email" value="${Utils.escapeHTML(f.email || '')}" placeholder="—">
          </label>
          <label class="field">
            <span>Phone</span>
            <input class="input fl-phone" type="text" value="${Utils.escapeHTML(f.phone || '')}" placeholder="—">
          </label>
          <label class="field" style="grid-column:1 / -1">
            <span>Notes</span>
            <input class="input fl-notes" type="text" value="${Utils.escapeHTML(f.notes || '')}" placeholder="—">
          </label>
        </div>
      </details>
    `;

    // Wire up inputs
    const onChange = () => saveRow(row);
    row.querySelectorAll('.fl-name, .fl-role, .fl-share, .fl-method, .fl-email, .fl-phone, .fl-notes')
      .forEach(el => el.addEventListener('change', onChange));
    row.querySelector('.fl-active-cb').addEventListener('change', onChange);

    row.querySelector('.fl-del').addEventListener('click', () => {
      const name = row.querySelector('.fl-name').value.trim() || '(unnamed)';
      App.confirm(`Remove "${name}"?`, 'Existing job assignments keep showing the name. They can be reassigned later.', () => {
        removeFreelancer(f.id);
      });
    });

    return row;
  }

  function saveRow(row) {
    const id = row.dataset.id;
    const settings = Storage.getSettings();
    const f = (settings.freelancers || []).find(x => x.id === id);
    if (!f) return;
    f.name = row.querySelector('.fl-name').value.trim();
    f.role = row.querySelector('.fl-role').value;
    f.defaultSharePercent = row.querySelector('.fl-share').value === ''
      ? null : Number(row.querySelector('.fl-share').value);
    f.preferredMethod = row.querySelector('.fl-method').value;
    f.email = row.querySelector('.fl-email').value.trim();
    f.phone = row.querySelector('.fl-phone').value.trim();
    f.notes = row.querySelector('.fl-notes').value.trim();
    f.active = row.querySelector('.fl-active-cb').checked;
    Storage.saveSettings(settings);
    row.classList.toggle('inactive', f.active === false);
    JobsTable.render();
    Dashboard.render();
    if (typeof Team !== 'undefined' && Team.render) Team.render();
  }

  function addFreelancer() {
    const name = els.newFreelancer.value.trim();
    if (!name) return;
    const settings = Storage.getSettings();
    if (!Array.isArray(settings.freelancers)) settings.freelancers = [];
    if (settings.freelancers.some(f => f.name === name)) {
      Utils.toast('Freelancer already exists', 'info', 1500);
      els.newFreelancer.value = '';
      return;
    }
    const newF = { id: Utils.uuid(), name, role: '', active: true };
    settings.freelancers.push(newF);
    Storage.saveSettings(settings);
    els.newFreelancer.value = '';
    refresh();
    if (typeof Team !== 'undefined' && Team.render) Team.render();
  }

  function removeFreelancer(id) {
    const settings = Storage.getSettings();
    settings.freelancers = (settings.freelancers || []).filter(f => f.id !== id);
    Storage.saveSettings(settings);
    refresh();
    JobsTable.render();
    Dashboard.render();
    if (typeof Team !== 'undefined' && Team.render) Team.render();
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
          if (typeof Team !== 'undefined' && Team.render) Team.render();
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
      if (typeof Team !== 'undefined' && Team.render) Team.render();
      Utils.toast('All data cleared', 'success');
    });
  }

  return { init, open, close, refresh };
})();
