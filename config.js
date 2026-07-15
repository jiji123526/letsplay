// ============================================================
//  App Configuration
// ============================================================

// ---- BACKEND SELECTION ----
// "supabase" | "mock"
export const BACKEND = "supabase";

// ---- LOCAL DEV MODE ----
export const USE_MOCK = false;

// ---- Supabase Config ----
export const supabaseConfig = {
  url: "https://wpwlqpkawssrywlqgncg.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indwd2xxcGthd3Nzcnl3bHFnbmNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMzE0MzAsImV4cCI6MjA5OTcwNzQzMH0.de5Jqfs97oOrIddr3yS1k3rQE2DaowYsHH40KKAXTYY",
};

// ---- Admin Passcode ----
export const ADMIN_PASSCODE = "changeme";
