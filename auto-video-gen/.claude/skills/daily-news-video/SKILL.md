---
name: daily-news-video
description: Quy trình hằng ngày — tự tìm tin hot (RSS báo VN + Google Trends), chọn tin hấp dẫn nhất, tạo video TikTok 9:16 và caption. Trigger khi user nói "làm video hôm nay", "tìm tin hot rồi làm video", "chạy daily", hoặc khi được gọi từ lịch tự động (Cowork / scheduled task).
---

# Daily News Video

Chạy trong thư mục gốc của project `auto-video-gen`.

## Input (tùy chọn)

- Số video cần làm hôm nay: mặc định **1**, tối đa 3.
- Nếu user đưa sẵn URL → bỏ qua Bước 1–2, làm luôn Bước 3 với URL đó.

## Bước 1: Tìm tin hot

```bash
npm run news:find -- --top 10
```

Lệnh in ra bảng xếp hạng và lưu `output/news/<timestamp>.json`. Mỗi tin có `score`, `reasons`, `trendKeyword`, `alsoCoveredBy`. Tin đã làm video trong 7 ngày qua được tự loại.

Nếu lệnh lỗi hoặc không có tin nào → báo user và dừng.

## Bước 2: Chọn tin

Đọc file JSON vừa tạo. Điểm số chỉ là gợi ý — chọn lại theo tiêu chí TikTok:

1. **Có "câu móc" được không?** Tin có con số gây sốc, nghịch lý, câu hỏi tò mò, hoặc ảnh hưởng trực tiếp tới người xem (giá cả, điện thoại, mạng xã hội, tiền bạc).
2. **Đủ chất liệu cho 45–60s** (không phải tin 2 dòng).
3. **Hợp chủ đề kênh** (`preferKeywords` trong `news-sources.json`).
4. **Tránh:** tin tai nạn/chết người, chính trị nhạy cảm, tố tụng chưa kết luận về cá nhân cụ thể, tin quảng cáo/PR doanh nghiệp (thường có "được vinh danh", "ra mắt dự án", "ưu đãi").

Chọn N tin, ghi 1 dòng lý do cho mỗi tin.

## Bước 3: Tạo video cho từng tin

Với mỗi tin đã chọn, làm đúng quy trình skill `create-news-video` với URL của tin, kèm các điều chỉnh sau:

- `script.json` phải theo đúng schema trong `src/render/script-schema.ts` (mỗi scene có `templateData`, xem mẫu `tests/fixtures/sample-script-with-image.json`).
- `voice`: `{ "provider": "edge-tts", "voiceId": "${VOICE_ID}", "speed": 1.0 }` (trừ khi `.env.local` chọn provider khác).
- **Tên kênh:** lấy `TIKTOK_DISPLAY_NAME` trong `.env.local`, dùng cho `metadata.channel`, outro `channelName` và câu outro "Theo dõi <tên kênh> để xem tin hot mỗi ngày." Hashtag kênh lấy từ `TIKTOK_HANDLE` (bỏ `@`). Không dùng "CườngIT" nếu `.env.local` đặt tên khác.
- Nếu trang chặn đọc (paywall/JS) → bỏ tin đó, lấy tin kế tiếp trong danh sách.

## Bước 4: Đánh dấu tin đã dùng

Chỉ khi pipeline render thành công:

```bash
npm run news:used -- <url> <tiêu đề>
```

## Bước 5: Báo cáo

```markdown
## Video hôm nay

1. **<tiêu đề>** — <lý do chọn>
   - Video: [video.mp4](output/<dir>/video.mp4)
   - Caption: <dòng caption> <hashtags>
```

Kết thúc bằng lời nhắc: **xem lại video trước khi đăng**, bật nhãn "Nội dung do AI tạo" khi đăng TikTok, và ghi nguồn báo trong caption.

## Không làm

- Không tự đăng lên TikTok trong skill này (chưa có tích hợp Content Posting API).
- Không làm quá 3 video/lần chạy.
- Không bịa số liệu/trích dẫn không có trong bài gốc.
