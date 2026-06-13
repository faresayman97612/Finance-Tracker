/* storage.js — unified storage layer (Firestore when configured, localStorage otherwise)
 *
 * Public API:
 *   await Storage.init({ user, firestore, mode })  // called by app.js
 *   Storage.getJobs()         — sync, returns cached array
 *   Storage.getSettings()     — sync, returns cached object
 *   Storage.saveJobs(jobs)    — updates cache + writes to backend (returns Promise)
 *   Storage.saveSettings(s)   — updates cache + writes to backend (returns Promise)
 *   Storage.getFreelancer(id) / Storage.getFreelancerName(id)
 *   Storage.exportAll()       — sync snapshot
 *   await Storage.importAll(payload)
 *   await Storage.clearAll()
 *   Storage.getMode()         — 'firebase' | 'local'
 */

const Storage = (function () {
  const KEYS = {
    JOBS: 'finance.jobs',
    SETTINGS: 'finance.settings'
  };

  const DEFAULT_SETTINGS = {
    theme: 'system',
    currency: 'EGP',
    freelancers: [
      { id: 'seed-ahmed', name: 'Ahmed Ajaj',    role: '', active: true },
      { id: 'seed-hamza', name: 'Hamza Mohamed', role: '', active: true },
      { id: 'seed-ammar', name: 'Ammar Mohamed', role: '', active: true }
    ],
    expenses: []
  };

  const SCHEMA_VERSION = 4;
  const EXPENSE_CATEGORIES = ['subscriptions', 'tools', 'marketing', 'transport', 'taxes', 'other'];

  let backend = 'local'; // 'firebase' | 'local'
  let firestore = null;
  let userId = null;
  let cache = { jobs: [], settings: cloneDefaultSettings() };
  let pendingSave = null;
  let saveTimer = null;
  let migrationDone = false;

  function cloneDefaultSettings() {
    return {
      theme: DEFAULT_SETTINGS.theme,
      currency: DEFAULT_SETTINGS.currency,
      freelancers: DEFAULT_SETTINGS.freelancers.map(f => ({ ...f })),
      expenses: []
    };
  }

  // ─── Migration ──────────────────────────────────────────────────────
  //
  // Idempotent. Converts schemaVersion-undefined data into v2:
  //   • settings.freelancers: string[] → object[]
  //   • job.freelancers:      string[] → freelancerId[]   (preserves any unknown name as a new "inactive" freelancer)
  //   • job.payments[].to:    string  → freelancerId      (keeps payment.toName as a permanent display fallback)
  //   • job.stage default from job.workStatus
  //   • job.tasks default []
  //   • job.activity default []
  //   • job.schemaVersion = 2
  function migrate(cache) {
    let changed = false;

    // 1. Settings.freelancers → object[]
    const settings = cache.settings || (cache.settings = cloneDefaultSettings());
    if (!Array.isArray(settings.freelancers)) settings.freelancers = [];

    const nameToId = new Map();
    const upgraded = [];
    for (const item of settings.freelancers) {
      if (typeof item === 'string') {
        const id = Utils.uuid();
        upgraded.push({ id, name: item, role: '', active: true });
        nameToId.set(item, id);
        changed = true;
      } else if (item && typeof item === 'object') {
        const id = item.id || Utils.uuid();
        const f = {
          id,
          name: String(item.name || '').trim(),
          role: item.role || '',
          email: item.email || '',
          phone: item.phone || '',
          defaultSharePercent: (item.defaultSharePercent != null && item.defaultSharePercent !== '')
            ? Number(item.defaultSharePercent) : null,
          preferredMethod: item.preferredMethod || '',
          notes: item.notes || '',
          active: item.active !== false
        };
        if (!item.id) changed = true;
        upgraded.push(f);
        if (f.name) nameToId.set(f.name, id);
      }
    }
    settings.freelancers = upgraded;

    function freelancerIdForName(name) {
      const trimmed = String(name || '').trim();
      if (!trimmed) return '';
      if (nameToId.has(trimmed)) return nameToId.get(trimmed);
      const id = Utils.uuid();
      settings.freelancers.push({
        id, name: trimmed, role: '', active: false  // inactive by default — surfaced as "from old data"
      });
      nameToId.set(trimmed, id);
      changed = true;
      return id;
    }

    const knownIds = new Set(settings.freelancers.map(f => f.id));

    // 2. Expenses default (v3)
    if (!Array.isArray(settings.expenses)) {
      settings.expenses = [];
      changed = true;
    }

    // 3. Jobs
    if (!Array.isArray(cache.jobs)) cache.jobs = [];
    for (const job of cache.jobs) {
      if (job.schemaVersion === SCHEMA_VERSION) continue;

      // freelancers: name[] → id[]
      if (Array.isArray(job.freelancers)) {
        const mapped = [];
        for (const entry of job.freelancers) {
          if (typeof entry === 'string') {
            // could already be an id (e.g. partial migration) — accept if known
            if (knownIds.has(entry)) {
              mapped.push(entry);
            } else {
              mapped.push(freelancerIdForName(entry));
              changed = true;
            }
          }
        }
        job.freelancers = mapped;
      } else {
        job.freelancers = [];
      }

      // payments[].to: name → id, preserve toName
      if (Array.isArray(job.payments)) {
        for (const p of job.payments) {
          if (p && p.direction === 'outgoing' && p.to) {
            if (knownIds.has(p.to)) {
              if (!p.toName) {
                const ref = settings.freelancers.find(f => f.id === p.to);
                if (ref) p.toName = ref.name;
              }
            } else {
              // looks like a legacy name
              const displayName = p.to;
              const id = freelancerIdForName(displayName);
              p.to = id;
              p.toName = displayName;
              changed = true;
            }
          }
        }
      } else {
        job.payments = [];
      }

      // stage default
      if (!job.stage) {
        job.stage = job.workStatus === 'delivered' ? 'delivered' : 'in-progress';
        changed = true;
      }

      // collapse legacy stages onto the 4-value status set
      const COLLAPSE = { 'lead': 'proposal', 'accepted': 'in-progress', 'review': 'delivered', 'paid': 'delivered' };
      if (job.stage && COLLAPSE[job.stage]) {
        job.stage = COLLAPSE[job.stage];
        changed = true;
      }

      // tasks default
      if (!Array.isArray(job.tasks)) {
        job.tasks = [];
        changed = true;
      }

      // activity default
      if (!Array.isArray(job.activity)) {
        job.activity = [];
        changed = true;
      }

      job.schemaVersion = SCHEMA_VERSION;
      changed = true;
    }

    return changed;
  }

  // ─── Local backend ──────────────────────────────────────────────────

  function localLoad() {
    try {
      const rawJobs = localStorage.getItem(KEYS.JOBS);
      const rawSettings = localStorage.getItem(KEYS.SETTINGS);
      cache.jobs = rawJobs ? JSON.parse(rawJobs) : [];
      const s = rawSettings ? JSON.parse(rawSettings) : {};
      cache.settings = { ...cloneDefaultSettings(), ...s };
    } catch (e) {
      console.warn('Local load failed', e);
      cache = { jobs: [], settings: cloneDefaultSettings() };
    }
    runMigration({ persistAfter: true });
  }

  function localSave() {
    try {
      localStorage.setItem(KEYS.JOBS, JSON.stringify(cache.jobs));
      localStorage.setItem(KEYS.SETTINGS, JSON.stringify(cache.settings));
    } catch (e) {
      console.error('Local save failed', e);
      Utils.toast('Could not save (storage full?)', 'error');
    }
  }

  // ─── Firestore backend ──────────────────────────────────────────────

  function userDoc() {
    return window.FB.doc(firestore, 'users', userId, 'data', 'main');
  }

  async function firebaseLoad() {
    try {
      const snap = await window.FB.getDoc(userDoc());
      if (snap.exists()) {
        const data = snap.data();
        cache.jobs = Array.isArray(data.jobs) ? data.jobs : [];
        cache.settings = { ...cloneDefaultSettings(), ...(data.settings || {}) };
      } else {
        // First-time user — migrate any local-mode data
        const rawJobs = localStorage.getItem(KEYS.JOBS);
        const rawSettings = localStorage.getItem(KEYS.SETTINGS);
        if (rawJobs || rawSettings) {
          try {
            cache.jobs = rawJobs ? JSON.parse(rawJobs) : [];
            const s = rawSettings ? JSON.parse(rawSettings) : {};
            cache.settings = { ...cloneDefaultSettings(), ...s };
            Utils.toast('Migrated your local data to cloud', 'success', 2500);
          } catch (parseErr) {
            cache = { jobs: [], settings: cloneDefaultSettings() };
          }
        } else {
          cache = { jobs: [], settings: cloneDefaultSettings() };
        }
        await window.FB.setDoc(userDoc(), { jobs: cache.jobs, settings: cache.settings });
      }
    } catch (e) {
      console.error('Firestore load failed', e);
      if (e && e.code === 'unavailable') {
        Utils.toast('Firestore not reachable — check Firebase Console has Firestore enabled', 'error', 5000);
      } else {
        Utils.toast('Could not load from cloud — using local cache', 'error', 3000);
      }
      localLoad();
      return;
    }
    runMigration({ persistAfter: true });
  }

  function runMigration({ persistAfter }) {
    try {
      const changed = migrate(cache);
      if (changed && !migrationDone) {
        Utils.toast('Data updated to new team-workflow schema', 'info', 2200);
      }
      migrationDone = true;
      if (changed && persistAfter) {
        if (backend === 'firebase') scheduleFirebaseSave();
        else localSave();
      }
    } catch (e) {
      console.error('Migration failed — keeping cache as-is', e);
      Utils.toast('Could not upgrade data — please export a backup', 'error', 5000);
    }
  }

  function scheduleFirebaseSave() {
    // Debounce writes to reduce Firestore costs
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        pendingSave = window.FB.setDoc(userDoc(), {
          jobs: cache.jobs,
          settings: cache.settings,
          updatedAt: Utils.nowISO()
        });
        await pendingSave;
      } catch (e) {
        console.error('Firestore save failed', e);
      }
    }, 400);
  }

  // ─── Public API ─────────────────────────────────────────────────────

  async function init({ mode, user, firestoreInst }) {
    if (mode === 'firebase' && user && firestoreInst) {
      backend = 'firebase';
      firestore = firestoreInst;
      userId = user.uid;
      await firebaseLoad();
    } else {
      backend = 'local';
      localLoad();
    }
  }

  function getJobs() { return cache.jobs; }
  function getSettings() { return cache.settings; }

  function saveJobs(jobs) {
    cache.jobs = jobs;
    if (backend === 'firebase') scheduleFirebaseSave();
    else localSave();
  }

  function saveSettings(settings) {
    cache.settings = { ...cache.settings, ...settings };
    if (backend === 'firebase') scheduleFirebaseSave();
    else localSave();
  }

  function getFreelancer(id) {
    if (!id) return null;
    const list = (cache.settings && cache.settings.freelancers) || [];
    return list.find(f => f.id === id) || null;
  }

  function getFreelancerName(id, fallback) {
    const f = getFreelancer(id);
    if (f && f.name) return f.name;
    return fallback || '';
  }

  function getExpenses() {
    if (!cache.settings) return [];
    if (!Array.isArray(cache.settings.expenses)) cache.settings.expenses = [];
    return cache.settings.expenses;
  }

  function saveExpenses(list) {
    if (!cache.settings) cache.settings = cloneDefaultSettings();
    cache.settings.expenses = Array.isArray(list) ? list : [];
    if (backend === 'firebase') scheduleFirebaseSave();
    else localSave();
  }

  function exportAll() {
    return {
      version: 4,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: Utils.nowISO(),
      jobs: cache.jobs,
      settings: cache.settings
    };
  }

  async function importAll(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid import file');
    if (Array.isArray(payload.jobs)) cache.jobs = payload.jobs;
    if (payload.settings && typeof payload.settings === 'object') {
      cache.settings = { ...cloneDefaultSettings(), ...payload.settings };
    }
    // Re-run migration on imported data so old backups upgrade in place
    migrationDone = false;
    runMigration({ persistAfter: false });
    if (backend === 'firebase') {
      await window.FB.setDoc(userDoc(), { jobs: cache.jobs, settings: cache.settings });
    } else {
      localSave();
    }
  }

  async function clearAll() {
    cache = { jobs: [], settings: cloneDefaultSettings() };
    if (backend === 'firebase') {
      await window.FB.setDoc(userDoc(), { jobs: [], settings: cache.settings });
    } else {
      localStorage.removeItem(KEYS.JOBS);
      localStorage.removeItem(KEYS.SETTINGS);
    }
  }

  function getMode() { return backend; }

  return {
    KEYS, DEFAULT_SETTINGS, SCHEMA_VERSION, EXPENSE_CATEGORIES,
    init,
    getJobs, getSettings,
    saveJobs, saveSettings,
    getFreelancer, getFreelancerName,
    getExpenses, saveExpenses,
    exportAll, importAll, clearAll,
    getMode
  };
})();
