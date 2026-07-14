// ============================================================
//  Firebase config
//  1. Go to https://console.firebase.google.com/ → create a project
//  2. Add a Web App (</> icon) → copy the config object below
//  3. In the console: Build → Authentication → Sign-in method →
//     enable "Anonymous"
//  4. Build → Firestore Database → Create database (Production mode)
//     then paste the security rules from README-FIREBASE.md
// ============================================================

// ---- LOCAL DEV MODE ---------------------------------------
// Leave this `true` to build the UI/UX with NO Firebase — messages
// are stored in your browser (localStorage) and a fake "other person"
// replies so you can see both bubble styles. Flip to `false` once you
// paste real keys below and want to go live.
export const USE_MOCK = true;
// -----------------------------------------------------------

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// Optional: set an admin passcode. Anyone entering this in "관리자 모드"
// (admin mode) can delete messages. Real enforcement lives in the
// Firestore security rules — this is just the client-side gate.
export const ADMIN_PASSCODE = "changeme";
