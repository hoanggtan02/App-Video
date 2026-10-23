# App-Video — tự động làm video tin hot cho TikTok

```
Giao diện (GitHub Pages)  ⇄  Supabase (đăng nhập, dữ liệu, file)  ⇄  Worker (máy bạn: tìm tin, render, đăng)
                                         ⇡
                               Cowork (viết kịch bản theo lịch)
```

| Thư mục | Là gì |
|---|---|
| `web/` | Giao diện React — deploy lên GitHub Pages |
| `supabase/` | SQL tạo database + Edge Function kết nối TikTok |
| `auto-video-gen/` | Engine render video + worker (`src/worker`) + tìm tin (`src/news`) |
| `COWORK.md` | Hướng dẫn cho Cowork viết kịch bản |
| `backups/` | Bản sao lưu hằng đêm (không đưa lên GitHub) |

## Luồng mỗi ngày

1. **07:00** — worker tìm tin hot (8 báo + Google Trends), chấm điểm, chọn N tin → tạo video "Chờ kịch bản".
2. **07:15** — Cowork đọc bài, viết kịch bản + caption, nộp lên Supabase.
3. Worker render (~3 phút/video), nén, tải bản xem trước lên → "Chờ duyệt".
4. Bạn mở giao diện (điện thoại cũng được) → xem video → **Duyệt & đăng**.
5. Worker đẩy video vào **hộp thư nháp TikTok** → mở app TikTok, dán caption, bật nhãn AI → Đăng.
6. **02:00** — sao lưu toàn bộ dữ liệu vào `backups/`.

---

## Cài đặt (làm 1 lần)

### 1. Supabase

1. Tạo project tại [supabase.com](https://supabase.com) (region **Singapore**).
2. **SQL Editor** → dán toàn bộ `supabase/migrations/001_init.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email**: tắt **Allow new users to sign up** (chỉ bạn đăng nhập được).
4. **Authentication → Users → Add user**: nhập email + mật khẩu của bạn, tick *Auto Confirm*.
5. **Project Settings → API**: ghi lại `Project URL`, `anon public` key, `service_role` key (**bí mật**).

### 2. Worker (máy render)

Đã có sẵn Node, Python, FFmpeg. Trong `auto-video-gen/.env.local` điền:

```
SUPABASE_URL=<Project URL>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

(`TOKEN_ENC_KEY` đã được tạo sẵn — giữ nguyên, bước 4 cần copy nó.)

```bash
cd auto-video-gen
npm install
npm run tts:setup
npm run worker
```

Thấy `Worker "..." started` là được. Để tự chạy khi bật máy: `Win + R` → `shell:startup` → tạo shortcut tới `start-worker.cmd`.

### 3. Giao diện trên GitHub Pages

1. Mở **GitHub Desktop** → commit toàn bộ → **Push** lên `hoanggtan02/App-Video`.
   Repo phải **Public** (GitHub Pages miễn phí chỉ cho repo public). Code giao diện công khai vẫn an toàn: dữ liệu được bảo vệ bằng đăng nhập + RLS, key bí mật không nằm trong repo.
2. Repo trên github.com → **Settings → Pages** → Source: **GitHub Actions**.
3. **Settings → Secrets and variables → Actions → tab Variables** → thêm:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public key
4. **Actions** → *Deploy web to GitHub Pages* → **Run workflow**.
5. Mở `https://hoanggtan02.github.io/App-Video/` → đăng nhập → tạo kênh.
6. Supabase → **Authentication → URL Configuration** → Site URL = địa chỉ trên.

### 4. Kết nối TikTok

1. [developers.tiktok.com](https://developers.tiktok.com) → tạo app → thêm **Login Kit** và **Content Posting API**.
   - Scopes: `user.info.basic`, `video.upload`, `video.list`
   - Redirect URI (Login Kit → Web): `https://hoanggtan02.github.io/App-Video/`
   - Khi app chưa được TikTok duyệt: dùng **Sandbox**, thêm tài khoản TikTok của bạn vào *Target users*.
2. Ghi `Client key` + `Client secret` vào `auto-video-gen/.env.local` (`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`).
3. Deploy Edge Function (thay `<ref>` = mã project trong URL Supabase):
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase secrets set TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=... TIKTOK_REDIRECT_URI=https://hoanggtan02.github.io/App-Video/ TOKEN_ENC_KEY=<giống .env.local>
   npx supabase functions deploy tiktok-auth
   ```
4. Giao diện → **Cài đặt → Kết nối TikTok**.

### 5. Cowork viết kịch bản

Trong Cowork tạo **tác vụ định kỳ** mỗi ngày lúc **07:15** (sau giờ chạy của kênh ~15 phút), thư mục làm việc `App-Video`, nội dung:

> Đọc file COWORK.md trong thư mục này và làm theo.

Có thể chạy tay bất cứ lúc nào khi thấy video "Chờ kịch bản".

### 6. Phim cao cấp (tùy chọn)

Bên cạnh video template, có thể cho Cowork **dựng cả phim** bằng thư viện style
[lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) (Caption News, Broadcast News Package, Data Storytelling…).
Đẹp hơn nhiều nhưng mỗi phim mất 30–60 phút và tốn nhiều token, nên chỉ dùng cho tin quan trọng.

1. Supabase **SQL Editor** → dán `supabase/migrations/002_premium_films.sql` → **Run**.
2. Trong terminal của máy chạy Cowork, cài skill:
   ```bash
   claude plugin marketplace add lemomo-ai/lemo-opuscar
   claude plugin install lemo-opuscar@lemolab
   ```
   Cần Node 20+, ffmpeg, Python 3.11+ (đã có sẵn cho worker).
3. Trong Cowork tạo **tác vụ riêng** (chạy tay, hoặc định kỳ vào giờ máy rảnh), thư mục làm việc `App-Video`, nội dung:
   > Đọc file COWORK-FILM.md trong thư mục này và làm theo.

Dùng: **Tin hot → ★ Phim cao cấp** (chọn style hoặc để Cowork chọn), tick ★ khi dán link, hoặc
**Video → Làm thành phim cao cấp**. Phim hiện "Chờ dựng phim" → "Đang dựng phim" → "Chờ duyệt", duyệt và đăng như video thường.

---

## Lệnh hữu ích (trong `auto-video-gen/`)

| Lệnh | Làm gì |
|---|---|
| `npm run worker` | Chạy worker |
| `npm run worker -- restore ../backups/backup-xxx.zip` | Khôi phục dữ liệu từ bản sao lưu |
| `npm run cowork -- pending` | Xem video chờ kịch bản |
| `npm run cowork -- films` | Xem phim cao cấp chờ dựng |
| `npm run news:find` | Thử tìm tin hot (in ra màn hình, không ghi DB) |
| `npm test` | Chạy test |
| `npm run audio:make` | Tạo lại nhạc nền + hiệu ứng âm thanh (tự tạo khi render lần đầu) |

### Phụ đề, ảnh, nhạc nền

- **Phụ đề karaoke** chạy theo giọng đọc, chữ đang đọc tô vàng. Tắt: `CAPTIONS_ENABLED=false` trong `.env.local`.
- **Ảnh cho mọi cảnh**: worker lấy thêm ảnh trong bài báo gốc; bài ít ảnh thì dùng lại ảnh với kiểu zoom/lia khác nhau.
- **Nhạc nền + SFX** được tổng hợp sẵn (không lo bản quyền), nhạc tự nhỏ lại khi có giọng đọc.
  Muốn dùng nhạc riêng: chép file mp3 miễn phí bản quyền (vd. YouTube Audio Library) vào `auto-video-gen/assets/music/`.
  Chỉnh âm lượng: `BGM_VOLUME=0.2`; cố định 1 bài: `BGM_TRACK=ten-file.mp3`; tắt: `BGM_ENABLED=false`.

## Gặp lỗi

| Hiện tượng | Cách xử lý |
|---|---|
| Giao diện báo "Worker đang tắt" | Chạy `start-worker.cmd` trên máy render |
| Video kẹt ở "Chờ kịch bản" | Cowork chưa chạy → chạy tay tác vụ Cowork |
| Render lỗi "edge-tts" | `npm run tts:setup` để cập nhật thư viện giọng đọc |
| "Phiên TikTok đã hết hạn" | Cài đặt → Kết nối TikTok lại |
| Đăng nhập không được sau khi deploy | Kiểm tra 2 biến `VITE_SUPABASE_*` trong GitHub → chạy lại workflow |

## Giới hạn gói miễn phí Supabase

Khoảng 500 MB database, 1 GB file, 50 MB/file (kiểm tra lại trên trang giá Supabase). Worker nén video còn ~10–20 MB,
chỉ giữ bản xem trước trên Supabase và tự xóa 7 ngày sau khi đăng. Video gốc nằm ở `auto-video-gen/output/`.
