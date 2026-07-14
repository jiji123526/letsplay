#!/bin/sh
# This runs during Vercel build to generate firebase-config.js from env vars

cat > firebase-config.js << EOF
export const USE_MOCK = false;

export const firebaseConfig = {
  apiKey: "${FIREBASE_API_KEY}",
  authDomain: "${FIREBASE_AUTH_DOMAIN}",
  projectId: "${FIREBASE_PROJECT_ID}",
  storageBucket: "${FIREBASE_STORAGE_BUCKET}",
  messagingSenderId: "${FIREBASE_MESSAGING_SENDER_ID}",
  appId: "${FIREBASE_APP_ID}",
};

export const ADMIN_PASSCODE = "${ADMIN_PASSCODE}";
EOF
