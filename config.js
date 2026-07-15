// ============================================================
//  App Configuration
//  Switch between Firebase and Supabase backends
// ============================================================

// ---- BACKEND SELECTION ----
// "firebase" | "supabase" | "mock"
export const BACKEND = "supabase";

// ---- LOCAL DEV MODE ----
export const USE_MOCK = false;

// ---- Firebase Config ----
export const firebaseConfig = {
  apiKey: "AIzaSyCjDPXcwiKHdzC5nbEwS7tRnY3xj9BlsZU",
  authDomain: "playground-4a5b2.firebaseapp.com",
  projectId: "playground-4a5b2",
  storageBucket: "playground-4a5b2.firebasestorage.app",
  messagingSenderId: "13988513328",
  appId: "1:13988513328:web:cae8a378bd7ce958be8ff5",
  measurementId: "G-2Q4R3040QX"
};

// ---- Supabase Config ----
export const supabaseConfig = {
  url: "https://wpwlqpkawssrywlqgncg.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indwd2xxcGthd3Nzcnl3bHFnbmNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMzE0MzAsImV4cCI6MjA5OTcwNzQzMH0.de5Jqfs97oOrIddr3yS1k3rQE2DaowYsHH40KKAXTYY",
};

// ---- Admin Passcode ----
export const ADMIN_PASSCODE = "changeme";
