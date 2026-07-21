// ============================================================
//  App Configuration
// ============================================================

// ---- BACKEND SELECTION ----
// "supabase" | "mock"
export const BACKEND = "supabase";

// ---- LOCAL DEV MODE ----
export const USE_MOCK = true;

// ---- Supabase Config ----
export const supabaseConfig = {
  url: "https://wpwlqpkawssrywlqgncg.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indwd2xxcGthd3Nzcnl3bHFnbmNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMzE0MzAsImV4cCI6MjA5OTcwNzQzMH0.de5Jqfs97oOrIddr3yS1k3rQE2DaowYsHH40KKAXTYY",
};

// ---- Channels ----
export const channels = [
  {
    id: "main",
    name: "--",
    emoji: "🐮",
    profile: "/profile.jpg",
    passcode: "6ecf763ff6e7cef7b47e6611e1bf76fe2608a2e32a97b2d88b083ae1d8d02c82",
    bubble: "#3b8df0",
    notice: [
      {
        title: "이용 안내",
        items: [
          "꾹 눌러서 리액션/답장/신고 가능",
          "본인이 쓴 채팅 삭제 가능, 답장 달렸을 시 삭제된 채팅으로 표시",
          "신고 철회 가능",
          "비밀 메시지는 찍이한테만 보이고 보낸 사람한테도 안보임",
          "우측 상단 메뉴에 설정/갤러리/링크",
          "사진/링크 타고 채팅으로 이동 가능",
        ],
      },
      {
        title: "규칙",
        items: [
          "호모:순덕 비율 알잘딱깔센",
          "빡치는 채팅 있을경우 플 늘리지 말고 신고하면 다지워줌",
          "차단당한거 억울하면 탄원서 제출가능 (기회1번)",
        ],
      },
    ],
  },
  {
    id: "nextpadre",
    name: "-_-",
    emoji: "🎮",
    profile: "/profile2.jpg",
    passcode: "d20bdc364b3d7dfdcd81be5a3fd192d0f513fa79e92463bf0ed9efd2f46c243b",
    bubble: "#2e7d32",
    notice: [
      {
        title: "이용 안내",
        items: [
          "꾹 눌러서 리액션/답장/신고 가능",
          "본인이 쓴 채팅 삭제 가능, 답장 달렸을 시 삭제된 채팅으로 표시",
          "신고 철회 가능",
          "비밀 메시지는 찍이한테만 보이고 보낸 사람한테도 안보임",
          "우측 상단 메뉴에 설정/갤러리/링크",
          "사진/링크 타고 채팅으로 이동 가능",
        ],
      },
      {
        title: "규칙",
        items: [
          "퍼가지마",
        ],
      },
    ],
  },
];
