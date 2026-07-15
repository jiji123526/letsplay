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
  apiKey: "AIzaSyCjDPXcwiKHdzC5nbEwS7tRnY3xj9BlsZU",
  authDomain: "playground-4a5b2.firebaseapp.com",
  projectId: "playground-4a5b2",
  storageBucket: "playground-4a5b2.firebasestorage.app",
  messagingSenderId: "13988513328",
  appId: "1:13988513328:web:cae8a378bd7ce958be8ff5",
  measurementId: "G-2Q4R3040QX"
};

// Optional: set an admin passcode. Anyone entering this in "관리자 모드"
// (admin mode) can delete messages. Real enforcement lives in the
// Firestore security rules — this is just the client-side gate.
export const ADMIN_PASSCODE = "changeme";
