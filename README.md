# 찍이네 (letsplay)

A real-time anonymous chat application with multi-channel support, built with vanilla JavaScript and Supabase.

## Features

### Chat
- Real-time messaging with Supabase Realtime subscriptions
- Anonymous authentication (no sign-up required)
- Reactions, replies, message editing, and soft-delete
- Image sharing with client-side compression (2000px, 0.85 JPEG quality)
- Multi-photo select (sends each as a separate message)
- GIF support (no compression, preserves animation)
- Link previews with OG meta scraping
- Native Twitter/X and Instagram embeds
- Full-text search with keyboard dismiss detection
- Dark/light theme (follows system setting)
- Customizable bubble color (7 presets + custom picker)
- Adjustable font size

### Multi-Channel
- Multiple channels via URL (`/ch/channel-id`)
- Per-channel passcode protection (SHA-256 hashed)
- Per-channel bubble color defaults
- Per-channel notice banners (title + optional expandable body)
- Per-channel blocked users
- Channel picker with profile images

### Live Mode
- Admin-initiated temporary chat sessions
- Users get a popup to join or decline
- Completely isolated from normal chat (separate channel_id)
- All messages deleted when admin ends the session
- Custom title displayed in banners
- Join banner for users who declined (can join later)

### Admin
- Admin panel with settings for notice, color, passcode, blocked users, and live mode
- Admin actions via Vercel serverless functions (service role key)
- Cross-device admin color sync via Supabase
- Report system with click-to-navigate to reported messages

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS (ES modules), CSS |
| Build | Vite |
| Backend | Supabase (PostgreSQL + Realtime + Auth + Storage) |
| Deployment | Vercel (static + serverless functions) |
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
│   ├── app.js              — Main entry point, orchestrator
│   ├── admin/
│   │   └── api.js          — Admin API client
│   ├── backend/
│   │   ├── index.js        — Backend abstraction layer
│   │   ├── supabase.js     — Supabase implementation
│   │   └── mock.js         — localStorage mock for dev
│   └── modules/
│       ├── embeds.js       — Twitter/Instagram/link previews
│       ├── photo.js        — Image compression + lightbox
│       ├── gallery.js      — Gallery panel
│       ├── links-panel.js  — Shared links panel
│       ├── search.js       — Search bar + navigation
│       └── live.js         — Live mode
├── api/                    — Vercel serverless functions
│   ├── admin.js            — Admin actions (bypasses RLS)
│   └── preview.js          — OG meta link preview scraper
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
4. Create a storage bucket named `media` (public)
5. Update `config.js` with your project URL and anon key

### 3. Environment Variables (Vercel)

Set these in Vercel project settings:
- `SUPABASE_URL` — Your Supabase project URL
- `SUPABASE_SERVICE_KEY` — Service role key (for admin API)
- `ADMIN_PASSCODE` — Admin password for the serverless API

### 4. Run locally

```bash
npm run dev
```

For local development, set `BACKEND = "mock"` and `USE_MOCK = true` in `config.js`. This uses localStorage instead of Supabase — no network required.

> **Note:** The pre-commit hook automatically switches back to production mode before committing.

### 5. Deploy

Push to GitHub. Vercel auto-deploys on push to `main`.

## Adding a Channel

1. Add to `config.js`:

```js
export const channels = [
  {
    id: "main",
    name: "Main Chat",
    emoji: "🐮",
    profile: "/profile.jpg",
    passcode: "sha256-hash-here", // or omit for no passcode
    bubble: "#3b8df0",
    notice: [
      { title: "Rules", items: ["Be nice", "No spam"] },
    ],
  },
  {
    id: "gaming",
    name: "Gaming",
    emoji: "🎮",
    profile: "/profile2.jpg",
    passcode: "sha256-hash-here",
    bubble: "#2e7d32",
    notice: [
      { title: "Rules", items: ["Game talk only"] },
    ],
  },
];
```

2. Run the channel migration SQL (if not already done):

```sql
ALTER TABLE messages ADD COLUMN channel_id text DEFAULT 'main';
ALTER TABLE blocked ADD COLUMN channel_id text DEFAULT 'main';
ALTER TABLE dm ADD COLUMN channel_id text DEFAULT 'main';
ALTER TABLE gallery ADD COLUMN channel_id text DEFAULT 'main';
ALTER TABLE config ADD COLUMN channel_id text DEFAULT 'main';
CREATE INDEX messages_channel_idx ON messages(channel_id, created_at);
```

3. Access via: `yoursite.com/ch/gaming`

## Database Schema

- `messages` — Chat messages with reactions, replies, images, channel_id
- `blocked` — Blocked users per channel
- `dm` — Direct messages to admin
- `gallery` — Image gallery entries
- `config` — Key-value store for notices, passcodes, live status, admin colors

## Security

- Passcodes are stored as SHA-256 hashes (client-side comparison)
- Admin actions go through serverless API with service role key (bypasses RLS)
- RLS policies: authenticated users can read all tables, write to messages/dm/gallery/blocked
- Remove write policies on `config` table for production security

## License

Private project.
