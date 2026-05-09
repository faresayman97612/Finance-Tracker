/* auth.js — Firebase Auth with email allowlist + local-mode fallback */

const Auth = (function () {
  let app = null;
  let authInst = null;
  let firestore = null;
  let currentUser = null;
  let mode = 'pending'; // 'pending' | 'signin' | 'authed' | 'local' | 'setup' | 'error'
  const listeners = [];

  function isConfigured() {
    const c = window.FIREBASE_CONFIG;
    return !!c && c.apiKey && c.apiKey !== 'YOUR_API_KEY';
  }

  function emit() {
    listeners.forEach(fn => { try { fn({ mode, user: currentUser, firestore }); } catch (e) {} });
  }

  function onChange(fn) {
    listeners.push(fn);
    fn({ mode, user: currentUser, firestore });
  }

  async function waitForSDK() {
    if (window.FB) return;
    return new Promise(resolve => {
      window.addEventListener('fb-sdk-ready', resolve, { once: true });
    });
  }

  async function init() {
    if (!isConfigured()) {
      mode = 'setup';
      emit();
      return;
    }
    try {
      await waitForSDK();
      app = window.FB.initializeApp(window.FIREBASE_CONFIG);
      authInst = window.FB.getAuth(app);
      firestore = window.FB.initializeFirestore(app, {
        localCache: window.FB.persistentLocalCache()
      });
      window.FB.onAuthStateChanged(authInst, async (user) => {
        if (user) {
          if (user.email === window.FIREBASE_ALLOWED_EMAIL) {
            currentUser = user;
            mode = 'authed';
            emit();
          } else {
            await window.FB.signOut(authInst);
            currentUser = null;
            mode = 'error';
            const msg = document.getElementById('auth-error-msg');
            if (msg) msg.textContent =
              `Access denied: ${user.email} is not authorized. Only ${window.FIREBASE_ALLOWED_EMAIL} can use this app.`;
            emit();
          }
        } else {
          currentUser = null;
          mode = 'signin';
          emit();
        }
      });
    } catch (err) {
      console.error('Firebase init failed', err);
      mode = 'setup';
      emit();
    }
  }

  async function signIn() {
    if (!authInst) return;
    try {
      const provider = new window.FB.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await window.FB.signInWithPopup(authInst, provider);
    } catch (err) {
      console.error('Sign-in failed', err);
      Utils.toast('Sign-in failed: ' + (err.message || err.code), 'error', 3500);
    }
  }

  async function signOutNow() {
    if (!authInst) return;
    try {
      await window.FB.signOut(authInst);
    } catch (err) {
      console.error('Sign-out failed', err);
    }
  }

  function continueLocal() {
    mode = 'local';
    emit();
  }

  function getMode() { return mode; }
  function getUser() { return currentUser; }
  function getFirestore() { return firestore; }

  return { init, signIn, signOut: signOutNow, continueLocal, onChange, isConfigured, getMode, getUser, getFirestore };
})();
