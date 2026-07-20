# letsplay

A real-time anonymous chat application with multi-channel support, built with vanilla JavaScript and Supabase.

## Features

### Chat
- Real-time messaging via Supabase Realtime subscriptions
- Anonymous authentication — no sign-up required
- Reactions, replies, message editing, and soft-delete
- Image sharing with client-side compression (2000px, 0.85 JPEG quality)
- Multi-photo select (each photo sent as a separate message)
- GIF support (no compression, preserves animation)
- Link previews with OG meta scraping
- Native Twitter/X and Instagram embeds (preserved across re-renders)
- Full-text search with keyboard dismiss detection
- Dark/light theme (follows system preference)
- Customizable bubble color (7 presets + custom picker)
- Adjustable font size

### Multi-Channel
- Multiple channels via URL (`/ch/channel-id`)
- Per-channel passcode protection (SHA-256 hashed, DB-backed)
- Per-channel bubble color defaults
- Per-channel notice banners (title + optional expandable body)
- Per-channel blocked users
- Channel picker with profile images

### Live Mode
- Admin-initiated temporary chat sessions
- Users get a popup to join or decline
- Completely isolated from normal chat (separate `channel_id`)
- All messages deleted when admin ends the session
- Custom title displayed in banners
- Emoji bar with customizable presets during live session

### Admin
- Admin panel: notice, bubble color, passcode, banned words, blocked users, live mode
- All admin actions go through Vercel serverless functions (service role key)
- `is_admin` flag re-verified server-side on every message — cannot be faked by clients
- Cross-device admin color sync via Supabase
- Report system with click-to-navigate to reported messages
- Instant message deletion broadcast to all connected clients

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS (ES modules), CSS |
| Build | Vite |
| Backend | Supabase (PostgreSQL + Realtime + Auth + Storage) |
| Serverless | Vercel Functions |
| Auth | Supabase Anonymous Auth |

## Project Structure

```
letsplay/
├── index.html              — Main HTML
├── styles.css              — All styles
├── config.js               — Supabase config, channel definitions
├── schema.sql              — Database schema
├── package.json
├── vite.config.js
├── vercel.json             — Vercel build config + URL rewrites
├── src/
│   ├── app.js              — Orchestrator: state, subscriptions, message rendering
│   ├── utils.js            — Shared utilities (hashString)
│   ├── admin/
│   │   └── api.js          — Admin API client (calls /api/admin)
│   ├── backend/
│   │   ├── index.js        — Backend abstraction layer
│   │   ├── supabase.js     — Supabase implementation
│   │   └── mock.js         — localStorage mock for local dev
│   └── modules/
│       ├── dialogs.js      — Confirm, prompt, edit, passcode dialogs
│       ├── context-menu.js — Long-press context menu + reactions
│       ├── admin-panels.js — Admin settings panels
│       ├── notice.js       — Notice banner, input, panel
│       ├── settings.js     — Header menu + settings panel
│       ├── embeds.js       — Twitter/Instagram/link previews
│       ├── photo.js        — Image compression + lightbox
│       ├── gallery.js      — Gallery panel
│       ├── links-panel.js  — Shared links panel
│       ├── search.js       — Search bar + navigation
│       ├── live.js         — Live mode
│       └── fingerprint.js  — Browser fingerprint for ban enforcement
├── api/                    — Vercel serverless functions
│   ├── messages.js         — Send, delete, edit, react (validates ownership)
│   ├── admin.js            — Admin actions (passcode-gated, service role)
│   ├── gallery.js          — Gallery uploads
│   ├── preview.js          — OG meta link preview scraper
│   ├── dm.js               — Direct messages to admin
│   ├── data.js             — Message reads + search
│   └── version.js          — App version endpoint
├── server/
│   ├── auth.js             — Admin passcode verification
│   └── rate-limit.js       — In-memory rate limiter
└── public/
    ├── profile.jpg
    ├── profile2.jpg
    └── og-image.jpg
```

## Setup

### Prerequisites
- Node.js 18+
- A Supabase project
- A Vercel account (for deployment)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Supabase

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Enable Anonymous Auth: Dashboard → Authentication → Providers → Anonymous → Enable
3. Run `schema.sql` in the SQL Editor
4. Create a storage bucket named `media` (set to Public)
5. Update `config.js` with your project URL and anon key

### 3. Environment Variables (Vercel)

Set these in Vercel project settings → Environment Variables:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key (server-side only) |
| `ADMIN_PASSCODE` | Admin password — verified server-side on every admin action |

### 4. Run locally

```bash
npm run dev
```

For local development without Supabase, switch to mock mode in `config.js`:

```js
export const BACKEND = "mock";
export const USE_MOCK = true;
```

This uses localStorage instead of Supabase — no network required. Remember to revert before committing.

### 5. Deploy

Push to GitHub. Vercel auto-deploys on push to `main`.

## Adding a Channel

1. Add an entry to the `channels` array in `config.js`:

```js
{
  id: "gaming",
  name: "Gaming",
  emoji: "🎮",
  profile: "/profile2.jpg",
  passcode: "sha256-hash-here", // omit for no passcode
  bubble: "#2e7d32",
  notice: [
    { title: "Rules", items: ["Game talk only"] },
  ],
}
```

To generate a passcode hash, run in browser console:
```js
const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("yourpassword"));
console.log(Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join(""));
```

2. Access via: `yoursite.com/ch/gaming`

## Database Schema

| Table | Purpose |
|---|---|
| `messages` | Chat messages — text, reactions, replies, images, reports |
| `blocked` | Blocked users per channel (uid + fingerprint) |
| `dm` | Direct messages to admin |
| `gallery` | Image gallery entries |
| `config` | Key-value store for notices, passcodes, live status, admin colors, banned words |

## Security Model

All writes go through Vercel serverless functions using the service role key — the Supabase client in the browser is used for reads and Realtime subscriptions only.

| Concern | How it's handled |
|---|---|
| Fake admin messages | `is_admin` re-verified server-side against `ADMIN_PASSCODE` env var |
| Admin panel access | Every admin API call requires `ADMIN_PASSCODE` — IP rate-limited on failures |
| Ban enforcement | UID and browser fingerprint checked on every message send |
| Rate limiting | 5 messages per 10 seconds per UID, server-side |
| Banned words | Checked server-side on every message insert |
| Own-message enforcement | Delete/edit verify `msg.uid === uid` server-side |
| Passcode storage | SHA-256 hashed, stored in DB — fallback to `config.js` |

## License

Private project.
