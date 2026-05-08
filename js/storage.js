/* storage.js — unified storage layer (Firestore when configured, localStorage otherwise)
 *
 * Public API:
 *   await Storage.init({ user, firestore, mode })  // called by app.js
 *   Storage.getJobs()         — sync, returns cached array
 *   Storage.getSettings()     — sync, returns cached object
 *   Storage.saveJobs(jobs)    — updates cache + writes to backend (returns Promise)
 *   Storage.saveSettings(s)   — updates cache + writes to backend (returns Promise)
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
    freelancers: ['Ahmed Ajaj', 'Hamza Mohamed', 'Ammar Mohamed']
  };

  let backend = 'local'; // 'firebase' | 'local'
  let firestore = null;
  let userId = null;
  let cache = { jobs: [], settings: { ...DEFAULT_SETTINGS } };
  let pendingSave = null;
  let saveTimer = null;

  // ─── Local backend ──────────────────────────────────────────────────

  function localLoad() {
    try {
      const rawJobs = localStorage.getItem(KEYS.JOBS);
      const rawSettings = localStorage.getItem(KEYS.SETTINGS);
      cache.jobs = rawJobs ? JSON.parse(rawJobs) : [];
      const s = rawSettings ? JSON.parse(rawSettings) : {};
      cache.settings = { ...DEFAULT_SETTINGS, ...s };
    } catch (e) {
      console.warn('Local load failed', e);
      cache = { jobs: [], settings: { ...DEFAULT_SETTINGS } };
    }
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
        cache.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
      } else {
        // First-time user — migrate any local-mode data
        const rawJobs = localStorage.getItem(KEYS.JOBS);
        const rawSettings = localStorage.getItem(KEYS.SETTINGS);
        if (rawJobs || rawSettings) {
          try {
            cache.jobs = rawJobs ? JSON.parse(rawJobs) : [];
            const s = rawSettings ? JSON.parse(rawSettings) : {};
            cache.settings = { ...DEFAULT_SETTINGS, ...s };
            Utils.toast('Migrated your local data to cloud', 'success', 2500);
          } catch (parseErr) {
            cache = { jobs: [], settings: { ...DEFAULT_SETTINGS } };
          }
        } else {
          cache = { jobs: [], settings: { ...DEFAULT_SETTINGS } };
        }
        await window.FB.setDoc(userDoc(), { jobs: cache.jobs, settings: cache.settings });
      }
    } catch (e) {
      console.error('Firestore load failed', e);
      Utils.toast('Could not load from cloud — using local cache', 'error', 3000);
      localLoad();
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

  function exportAll() {
    return {
      version: 2,
      exportedAt: Utils.nowISO(),
      jobs: cache.jobs,
      settings: cache.settings
    };
  }

  async function importAll(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid import file');
    if (Array.isArray(payload.jobs)) cache.jobs = payload.jobs;
    if (payload.settings && typeof payload.settings === 'object') {
      cache.settings = { ...DEFAULT_SETTINGS, ...payload.settings };
    }
    if (backend === 'firebase') {
      await window.FB.setDoc(userDoc(), { jobs: cache.jobs, settings: cache.settings });
    } else {
      localSave();
    }
  }

  async function clearAll() {
    cache = { jobs: [], settings: { ...DEFAULT_SETTINGS } };
    if (backend === 'firebase') {
      await window.FB.setDoc(userDoc(), { jobs: [], settings: cache.settings });
    } else {
      localStorage.removeItem(KEYS.JOBS);
      localStorage.removeItem(KEYS.SETTINGS);
    }
  }

  function getMode() { return backend; }

  return {
    KEYS, DEFAULT_SETTINGS,
    init,
    getJobs, getSettings,
    saveJobs, saveSettings,
    exportAll, importAll, clearAll,
    getMode
  };
})();
