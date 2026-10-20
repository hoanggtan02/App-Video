import type { JobType, VideoStatus } from "./types";

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

export function num(n: number | null | undefined): string {
  return new Intl.NumberFormat("vi-VN", { notation: "compact", maximumFractionDigits: 1 }).format(n ?? 0);
}

export const VIDEO_STATUS: Record<VideoStatus, { label: string; tone: "muted" | "info" | "warn" | "ok" | "bad" }> = {
  waiting_script: { label: "Chờ kịch bản", tone: "muted" },
  script_ready: { label: "Chờ render", tone: "info" },
  rendering: { label: "Đang render", tone: "info" },
  review: { label: "Chờ duyệt", tone: "warn" },
  approved: { label: "Đã duyệt", tone: "info" },
  posting: { label: "Đang đăng", tone: "info" },
  posted: { label: "Đã đăng", tone: "ok" },
  rejected: { label: "Từ chối", tone: "muted" },
  failed: { label: "Lỗi", tone: "bad" },
};

export const JOB_LABEL: Record<JobType, string> = {
  find_news: "Tìm tin",
  render: "Render video",
  post: "Đăng TikTok",
  fetch_stats: "Lấy thống kê",
  backup: "Sao lưu",
};

export const JOB_STATUS: Record<string, { label: string; tone: "muted" | "info" | "ok" | "bad" }> = {
  pending: { label: "Đang chờ", tone: "muted" },
  running: { label: "Đang chạy", tone: "info" },
  done: { label: "Xong", tone: "ok" },
  failed: { label: "Lỗi", tone: "bad" },
};
