# Nhiệm vụ của Cowork: dựng phim cao cấp (lemo-opuscar)

Bạn (Cowork) dựng **trọn một phim** cho video được đánh dấu ★ Phim cao cấp, bằng thư viện style
[lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar). Worker chỉ nén phim, tải bản xem trước và đăng TikTok.

Mỗi phim mất 30–60 phút. **Mỗi lần chạy chỉ dựng 1 phim**; phim còn lại để lần chạy sau.

Lệnh `npm run cowork -- …` chạy trong thư mục `auto-video-gen/`.

## Bước 1 — Lấy phim chờ dựng

```bash
npm run cowork -- films
```

Kết quả là mảng JSON (mỗi phần tử cũng được ghi vào `<projectDir>/brief.json`):
`videoId`, `url`, `title`, `description`, `image`, `channel.name`, `style`, `film`, `projectDir`.
Mảng rỗng → báo "Không có phim nào chờ dựng" và **dừng**.

Lấy phần tử **đầu tiên**, rồi nhận phim:

```bash
npm run cowork -- film-start <videoId>
```

Báo lỗi "không còn ở trạng thái chờ dựng" → đã có người nhận, sang phần tử kế tiếp.

## Bước 2 — Dựng phim bằng lemo-opuscar

Dùng skill `lemo-opuscar` (hoặc thư viện ở `~/lemo-opuscar`): đọc `$LIB/AGENTS.md`, `DIRECTOR.md`, `TECHNIQUE.md`
và `styles/<style>/STYLE.md`, rồi làm theo **Workflow** của thư viện, với những điều chỉnh sau:

- **Không hỏi người dùng.** Tác vụ chạy tự động; brief dưới đây thay cho vòng câu hỏi, chỗ nào thiếu thì tự quyết.
  Không làm storyboard, không dừng chờ duyệt.
- **Thư mục dự án:** `projectDir` (đường dẫn tuyệt đối). Chạy công cụ từ `$LIB` với đường dẫn này.
- **Style:** `style` trong brief. Nếu `null`, chọn style hợp chủ đề nhất trong thư viện
  (tin thời sự/số liệu: *Caption News*, *Broadcast News Package*, *Data Storytelling*; công nghệ/sản phẩm:
  *Dark Tech Keynote*, *Exploded Teardown*, *Isometric Infographic*) và ghi lý do vào `TREATMENT.md`.
- **Chủ đề:** bài báo tại `url`. Đọc bài gốc. Mọi số liệu, tên người, trích dẫn phải có trong bài;
  ghi `FACTS.md` (nhận định, câu gốc trong bài). **Không bịa.** Không đọc được bài →
  `npm run cowork -- skip <videoId> "không đọc được bài"` rồi dừng.
- **Khung dọc 9:16:** `--size 1080x1920` cho **mọi** lệnh `still.mjs`, `video.mjs`, `events.mjs`, `readcheck.mjs`.
  Dựng bố cục dọc theo mục khung hình dọc trong `STYLE.md` (không cắt từ bản 16:9). Chừa vùng an toàn của TikTok:
  không đặt chữ quan trọng ở 250 px dưới cùng và 120 px bên phải.
- **Độ dài:** `film.minSec`–`film.maxSec` giây (45–75 s).
- **Tiếng Việt:**
  - Giọng: Kokoro không có tiếng Việt → dùng `core/tts/tts_zh.py lines.json <dir> --voice <film.voice> --rate <film.rate>`
    (edge-tts). Viết số bằng chữ trong trường `say` theo "Vietnamese TTS Phonetic Rules" ở
    `auto-video-gen/.claude/skills/create-news-video/SKILL.md`; `text` giữ số gốc.
  - Kiểm tra giọng: `core/tts/asr_check.py lines.json <dir> --lang vi --model small`.
  - Font: các font trong `core/fonts/` là bản cắt gọn, **thiếu dấu tiếng Việt**. Dùng font có đủ dấu
    (Be Vietnam Pro, Inter, Noto Sans…, giấy phép OFL) và kiểm tra still trước khi render cả phim.
  - Phụ đề `.srt` tiếng Việt.
- **Kênh:** phim thuộc kênh `channel.name`. Kết phim bằng câu "Theo dõi <channel.name> để xem tin hot mỗi ngày."
  Không gắn credit LemoLab, không watermark.
- **Tư liệu:** theo mục tư liệu (Material) trong `STYLE.md`: ưu tiên nguồn có giấy phép rõ ràng (CC0, CC BY, phạm vi
  công cộng), ghi credit. Không dùng ảnh do AI tạo làm tư liệu thật.
- **Máy Windows:** `setup.sh` giả định `.venv/bin/python`; trên Windows là `.venv/Scripts/python.exe`. Nếu bước cài đặt
  của thư viện lỗi và không tự khắc phục được → `skip <videoId> "lỗi cài lemo-opuscar: <lỗi>"` rồi dừng.

Cuối cùng chạy self-check của thư viện (`DIRECTOR.md` §11) và `core/render/mux.sh` để ra file phim hoàn chỉnh (−14 LUFS).

## Bước 3 — Nộp phim

1. Viết `<projectDir>/caption.txt`:
   ```
   <1 câu caption gây tò mò, 10–20 từ, có thể 1 emoji>

   #tag1 #tag2 #tag3 #tag4
   ```
2. Nộp:
   ```bash
   npm run cowork -- film-submit <videoId> <đường dẫn phim .mp4> <projectDir>/caption.txt
   ```
   Báo "Phim KHÔNG hợp lệ" (không phải khung dọc, sai độ dài) → sửa và nộp lại (tối đa 2 lần).
   Vẫn không được → `npm run cowork -- skip <videoId> "<lý do>"`.

Nếu phải bỏ dở ở bất kỳ bước nào sau `film-start`, **luôn** gọi `skip` với lý do, để video không kẹt ở "Đang dựng phim".

## Bước 4 — Báo cáo

Tiêu đề, style đã dùng, độ dài, caption, đường dẫn thư mục dự án; hoặc lý do bỏ qua.
Worker sẽ nén phim và đưa lên mục **Video → Chờ duyệt**.

## Không làm

- Không sửa code App-Video, không sửa `.env.local`.
- Không render bằng `npm run pipeline`, không đăng TikTok.
- Không xây gì bên trong thư mục `styles/` của thư viện.
