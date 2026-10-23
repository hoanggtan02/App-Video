-- ════════════════════════════════════════════════════════════════════════════
-- App-Video — "phim cao cấp": Cowork dựng cả phim bằng lemo-opuscar
-- Chạy sau 001_init.sql (Supabase Dashboard → SQL Editor → dán → Run).
-- ════════════════════════════════════════════════════════════════════════════

-- standard = kịch bản JSON → worker render bằng template
-- premium  = Cowork dựng nguyên phim (lemo-opuscar) → worker chỉ nén + tải bản xem trước
alter table public.videos
  add column if not exists kind text not null default 'standard' check (kind in ('standard','premium')),
  -- Tên style lemo-opuscar (vd "Caption News"); null = để Cowork tự chọn
  add column if not exists film_style text;

-- Cowork liệt kê phim chờ dựng theo kind
create index if not exists videos_kind_status on public.videos (kind, status);
