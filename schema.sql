-- ============================================================
-- Supabase Schema for 놀이터 Chat App
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Messages table
create table messages (
  id uuid default gen_random_uuid() primary key,
  uid text not null,
  auth_uid uuid not null,
  nick text,
  text text default '',
  is_admin boolean default false,
  reply_to uuid references messages(id) on delete set null,
  report boolean default false,
  reported_msg_id uuid,
  gallery_id uuid,
  dm boolean default false,
  deleted boolean default false,
  edited boolean default false,
  reported boolean default false,
  reactions jsonb default '{}',
  image text,
  image_w integer,
  image_h integer,
  channel_id text default 'main',
  created_at timestamptz default now()
);

-- Blocked users table
create table blocked (
  id uuid default gen_random_uuid() primary key,
  uid text not null,
  reason text default '',
  channel_id text default 'main',
  created_at timestamptz default now()
);

-- DM table
create table dm (
  id uuid default gen_random_uuid() primary key,
  uid text not null,
  auth_uid uuid,
  nick text,
  text text default '',
  image text,
  channel_id text default 'main',
  created_at timestamptz default now()
);

-- Gallery table
create table gallery (
  id uuid default gen_random_uuid() primary key,
  image text not null,
  image_id text,
  channel_id text default 'main',
  created_at timestamptz default now()
);

-- Config table (for notices, etc.)
create table config (
  id text primary key,
  text text default '',
  channel_id text default 'main',
  updated_at timestamptz default now()
);

-- Enable Row Level Security
alter table messages enable row level security;
alter table blocked enable row level security;
alter table dm enable row level security;
alter table gallery enable row level security;
alter table config enable row level security;

-- Policies: allow authenticated users to read/write
create policy "Allow authenticated read" on messages for select to authenticated using (true);
create policy "Allow authenticated insert" on messages for insert to authenticated with check (true);
create policy "Allow authenticated update" on messages for update to authenticated using (true);
create policy "Allow authenticated delete" on messages for delete to authenticated using (true);

create policy "Allow authenticated read" on blocked for select to authenticated using (true);
create policy "Allow authenticated insert" on blocked for insert to authenticated with check (true);
create policy "Allow authenticated delete" on blocked for delete to authenticated using (true);

create policy "Allow authenticated read" on dm for select to authenticated using (true);
create policy "Allow authenticated insert" on dm for insert to authenticated with check (true);
create policy "Allow authenticated delete" on dm for delete to authenticated using (true);

create policy "Allow authenticated read" on gallery for select to authenticated using (true);
create policy "Allow authenticated insert" on gallery for insert to authenticated with check (true);
create policy "Allow authenticated delete" on gallery for delete to authenticated using (true);

create policy "Allow authenticated read" on config for select to authenticated using (true);
create policy "Allow authenticated insert" on config for insert to authenticated with check (true);
create policy "Allow authenticated update" on config for update to authenticated using (true);

-- Enable realtime for all tables
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table blocked;
alter publication supabase_realtime add table dm;
alter publication supabase_realtime add table gallery;
alter publication supabase_realtime add table config;

-- Full-text search index on messages
create index messages_text_search on messages using gin(to_tsvector('simple', text));

-- ============================================================
-- Storage Setup (run separately or via Dashboard)
-- Dashboard → Storage → New bucket → name: "media" → Public: ON
-- ============================================================
-- If using SQL:
insert into storage.buckets (id, name, public) values ('media', 'media', true);

-- Storage policy: allow authenticated users to upload/read/delete
create policy "Allow authenticated upload" on storage.objects for insert to authenticated with check (bucket_id = 'media');
create policy "Allow public read" on storage.objects for select using (bucket_id = 'media');
create policy "Allow authenticated delete" on storage.objects for delete to authenticated using (bucket_id = 'media');
