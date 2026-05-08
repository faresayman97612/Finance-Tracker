/* firebase-config.js
 * ─────────────────────────────────────────────────────────────────────
 * Fill in the values from your Firebase Web app config:
 *   1. Go to https://console.firebase.google.com and create/select a project.
 *   2. Add a Web app and copy the firebaseConfig object Firebase shows you.
 *   3. Paste the values below.
 *   4. In Firebase console, enable: Authentication → Google sign-in
 *   5. In Firebase console, enable: Firestore Database (production mode)
 *   6. In Firestore Rules, paste:
 *
 *      rules_version = '2';
 *      service cloud.firestore {
 *        match /databases/{database}/documents {
 *          match /users/{userId}/{document=**} {
 *            allow read, write: if request.auth != null
 *              && request.auth.token.email == 'faresayman12316@gmail.com'
 *              && request.auth.uid == userId;
 *          }
 *        }
 *      }
 *
 * Until you fill this in, the app runs in local-only mode (data in browser only).
 * ─────────────────────────────────────────────────────────────────────
 */

window.FIREBASE_CONFIG = {
    apiKey: "AIzaSyADklabLYhXP3AdwxvntwJBH1IExlncs90",
    authDomain: "finance-20abc.firebaseapp.com",
    projectId: "finance-20abc",
    storageBucket: "finance-20abc.firebasestorage.app",
    messagingSenderId: "950335810510",
    appId: "1:950335810510:web:89696d1c350472804fd99f"
  };

// Only this email can sign in. Do not change.
window.FIREBASE_ALLOWED_EMAIL = 'faresayman12316@gmail.com';
