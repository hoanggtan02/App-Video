# Nhiệm vụ của Cowork: viết kịch bản video

Bạn (Cowork) chỉ làm **một việc**: viết kịch bản cho các video đang chờ. Việc tìm tin, render và đăng TikTok do worker lo.

Mọi lệnh chạy trong thư mục `auto-video-gen/`.

## Bước 1 — Lấy danh sách video chờ kịch bản

```bash
npm run cowork -- pending
```

Kết quả là mảng JSON, mỗi phần tử có: `videoId`, `url`, `title`, `description`, `image`, `channel.name`, `workDir`.
Mảng rỗng → báo "Không có video nào chờ kịch bản" và **dừng**.

## Bước 2 — Với từng video

1. **Đọc bài gốc** tại `url` (WebFetch hoặc mở trình duyệt). Không đọc được (paywall, lỗi) →
   `npm run cowork -- skip <videoId> "không đọc được bài"` rồi sang video tiếp theo.
2. **Viết `script.json`** vào `<workDir>/script.json`:
   - Cấu trúc: theo **đúng** `src/render/script-schema.ts`. Mẫu chuẩn: `tests/fixtures/sample-script-with-image.json`.
     Mỗi scene có `id`, `type`, `voiceText`, `templateData` (KHÔNG dùng trường `visual`).
   - 5–8 scene: scene đầu `type: "hook"`, scene cuối `type: "outro"`.
   - Template: `hook`, `stat-hero`, `feature-list`, `comparison`, `callout`, `outro`. Tôn trọng giới hạn độ dài ký tự trong schema.
   - Tổng `voiceText` khoảng 150–200 từ, văn nói, câu ngắn, kết thúc bằng `.` hoặc `?`.
   - **Quy tắc đọc số cho TTS** (rất quan trọng): đọc phần "Vietnamese TTS Phonetic Rules" trong
     `.claude/skills/create-news-video/SKILL.md` — viết số bằng chữ trong `voiceText`
     (vd "82.7%" → "tám mươi hai phẩy bảy phần trăm"); `templateData` thì giữ số gốc.
   - Hook: câu gây tò mò/số liệu sốc trong 3 giây đầu, không mở đầu chung chung.
   - Có ảnh (`image` khác null) → `metadata.source.image = image`, scene hook dùng `"bgSrc": "$source.image"`.
   - `metadata.channel` và outro `channelName` = `channel.name`; outro `voiceText`: "Theo dõi <channel.name> để xem tin hot mỗi ngày."
   - `voice`: `{ "provider": "edge-tts", "voiceId": "${VOICE_ID}", "speed": 1.0 }`.
   - **Không bịa** số liệu, trích dẫn, tên người không có trong bài.
3. **Viết `caption.txt`** vào `<workDir>/caption.txt`:
   ```
   <1 câu caption gây tò mò, 10–20 từ, có thể 1 emoji>

   #tag1 #tag2 #tag3 #tag4
   ```
4. **Nộp:**
   ```bash
   npm run cowork -- submit <videoId> <workDir>/script.json <workDir>/caption.txt
   ```
   Nếu báo "Kịch bản KHÔNG hợp lệ" → sửa đúng các lỗi được liệt kê, submit lại (tối đa 3 lần).

## Bước 3 — Báo cáo

Liệt kê: video nào đã nộp (tiêu đề + caption), video nào bỏ qua và lý do.
Worker sẽ tự render; video hiện trên giao diện ở mục **Video → Chờ duyệt**.

## Không làm

- Không chạy `npm run pipeline`, không render, không đăng TikTok.
- Không sửa code, không sửa `.env.local`.
