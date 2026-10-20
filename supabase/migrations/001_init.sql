-- ════════════════════════════════════════════════════════════════════════════
-- App-Video — Supabase schema
-- Chạy 1 lần trong Supabase Dashboard → SQL Editor (dán toàn bộ file → Run).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Channels ────────────────────────────────────────────────────────────────
create table public.channels (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  handle        text,
  avatar_url    text,
  -- feeds, preferKeywords, blockKeywords, maxAgeHours, voice, rate, theme,
  -- scheduleTimes ["07:00"], videosPerDay, autoPost, timezone
  settings      jsonb not null default '{}'::jsonb,
  -- Public info about the connected TikTok account (secrets live in tiktok_tokens)
  tiktok_display_name text,
  tiktok_avatar_url   text,
  tiktok_connected_at timestamptz,
  created_at    timestamptz not null default now()
);

create or replace function public.is_channel_owner(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.channels where id = cid and owner_id = auth.uid());
$$;

-- ── Stories (news candidates) ───────────────────────────────────────────────
create table public.stories (
  id              uuid primary key default gen_random_uuid(),
  channel_id      uuid not null references public.channels(id) on delete cascade,
  url             text not null,
  title           text not null,
  source          text,
  description     text,
  image           text,
  published_at    timestamptz,
  score           int not null default 0,
  reasons         jsonb not null default '[]'::jsonb,
  trend_keyword   text,
  also_covered_by text[] not null default '{}',
  status          text not null default 'new' check (status in ('new','selected','skipped','used')),
  found_at        timestamptz not null default now(),
  unique (channel_id, url)
);
create index stories_channel_found on public.stories (channel_id, found_at desc);

-- ── Videos ──────────────────────────────────────────────────────────────────
create table public.videos (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.channels(id) on delete cascade,
  story_id     uuid references public.stories(id) on delete set null,
  source_url   text,
  title        text not null,
  status       text not null default 'waiting_script' check (status in
               ('waiting_script','script_ready','rendering','review','approved','posting','posted','rejected','failed')),
  script       jsonb,
  caption      text,
  hashtags     text[] not null default '{}',
  duration_sec numeric,
  preview_path text,      -- path in storage bucket "previews"
  local_dir    text,      -- folder on the worker machine
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index videos_channel_created on public.videos (channel_id, created_at desc);

-- ── Posts (TikTok uploads) ──────────────────────────────────────────────────
create table public.posts (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.channels(id) on delete cascade,
  video_id    uuid not null references public.videos(id) on delete cascade,
  mode        text not null default 'inbox' check (mode in ('inbox','direct')),
  publish_id  text,
  status      text not null default 'processing' check (status in ('processing','sent_to_inbox','published','failed')),
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── TikTok video stats (snapshot from /v2/video/list) ───────────────────────
create table public.tiktok_videos (
  channel_id     uuid not null references public.channels(id) on delete cascade,
  tiktok_id      text not null,
  title          text,
  share_url      text,
  cover_url      text,
  create_time    timestamptz,
  view_count     bigint not null default 0,
  like_count     bigint not null default 0,
  comment_count  bigint not null default 0,
  share_count    bigint not null default 0,
  fetched_at     timestamptz not null default now(),
  primary key (channel_id, tiktok_id)
);

create table public.stats_daily (
  channel_id   uuid not null references public.channels(id) on delete cascade,
  day          date not null,
  videos       int not null default 0,
  views        bigint not null default 0,
  likes        bigint not null default 0,
  comments     bigint not null default 0,
  shares       bigint not null default 0,
  primary key (channel_id, day)
);

-- ── Jobs queue (UI enqueues, worker executes) ───────────────────────────────
create table public.jobs (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid references public.channels(id) on delete cascade,
  type        text not null check (type in ('find_news','render','post','fetch_stats','backup')),
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending' check (status in ('pending','running','done','failed')),
  result      jsonb,
  error       text,
  attempts    int not null default 0,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
create index jobs_pending on public.jobs (created_at) where status = 'pending';
create index jobs_channel_created on public.jobs (channel_id, created_at desc);

-- Worker atomically claims the oldest pending job
create or replace function public.claim_job()
returns setof public.jobs language sql as $$
  update public.jobs set status = 'running', started_at = now(), attempts = attempts + 1
  where id = (
    select id from public.jobs where status = 'pending'
    order by created_at for update skip locked limit 1
  )
  returning *;
$$;
revoke execute on function public.claim_job() from public, anon, authenticated;
grant execute on function public.claim_job() to service_role;

-- ── Secrets: TikTok tokens (encrypted by the Edge Function, service role only) ──
create table public.tiktok_tokens (
  channel_id          uuid primary key references public.channels(id) on delete cascade,
  open_id             text not null,
  scope               text,
  access_token_enc    text not null,
  refresh_token_enc   text not null,
  expires_at          timestamptz not null,
  refresh_expires_at  timestamptz not null,
  updated_at          timestamptz not null default now()
);

create table public.oauth_states (
  state       text primary key,
  channel_id  uuid not null references public.channels(id) on delete cascade,
  user_id     uuid not null,
  created_at  timestamptz not null default now()
);

-- ── Worker heartbeat ────────────────────────────────────────────────────────
create table public.worker_heartbeat (
  id         text primary key,
  last_seen  timestamptz not null default now(),
  info       jsonb not null default '{}'::jsonb
);

-- ── updated_at triggers ─────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger videos_touch before update on public.videos for each row execute function public.touch_updated_at();
create trigger posts_touch  before update on public.posts  for each row execute function public.touch_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security: a user only sees channels they own.
-- The worker uses the service_role key, which bypasses RLS.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.channels         enable row level security;
alter table public.stories          enable row level security;
alter table public.videos           enable row level security;
alter table public.posts            enable row level security;
alter table public.tiktok_videos    enable row level security;
alter table public.stats_daily      enable row level security;
alter table public.jobs             enable row level security;
alter table public.tiktok_tokens    enable row level security;  -- no policies → service role only
alter table public.oauth_states     enable row level security;  -- no policies → service role only
alter table public.worker_heartbeat enable row level security;

create policy channels_owner on public.channels for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy stories_owner on public.stories for all to authenticated
  using (public.is_channel_owner(channel_id)) with check (public.is_channel_owner(channel_id));
create policy videos_owner on public.videos for all to authenticated
  using (public.is_channel_owner(channel_id)) with check (public.is_channel_owner(channel_id));
create policy posts_owner on public.posts for select to authenticated
  using (public.is_channel_owner(channel_id));
create policy tiktok_videos_owner on public.tiktok_videos for select to authenticated
  using (public.is_channel_owner(channel_id));
create policy stats_daily_owner on public.stats_daily for select to authenticated
  using (public.is_channel_owner(channel_id));

-- Jobs: owner can read and enqueue (only as pending) for own channels; backup jobs have no channel
create policy jobs_select on public.jobs for select to authenticated
  using (channel_id is null or public.is_channel_owner(channel_id));
create policy jobs_insert on public.jobs for insert to authenticated
  with check (status = 'pending' and (channel_id is null or public.is_channel_owner(channel_id)));

create policy heartbeat_read on public.worker_heartbeat for select to authenticated using (true);

-- ════════════════════════════════════════════════════════════════════════════
-- Storage: private bucket for compressed preview videos (<channel_id>/<video_id>.mp4)
-- ════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit)
values ('previews', 'previews', false, 52428800)
on conflict (id) do nothing;

create policy previews_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'previews' and public.is_channel_owner(((storage.foldername(name))[1])::uuid));

-- ════════════════════════════════════════════════════════════════════════════
-- Realtime: UI updates live when the worker changes these tables
-- ════════════════════════════════════════════════════════════════════════════
alter publication supabase_realtime add table public.jobs, public.videos, public.stories, public.posts;
