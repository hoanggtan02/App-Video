import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import type { WorkerConfig } from "./config.js";
import { decryptToken, encryptToken } from "./crypto.js";
import { must } from "./db.js";

const API = "https://open.tiktokapis.com/v2";
/** Refresh when the access token has less than this left */
const REFRESH_MARGIN_MS = 10 * 60_000;
// TikTok chunk rules: 5–64 MB per chunk, a file under 64 MB may go in one chunk
const MAX_SINGLE_CHUNK = 64 * 1024 * 1024;
const CHUNK = 10 * 1024 * 1024;

function needTiktokConfig(cfg: WorkerConfig) {
  if (!cfg.tiktokClientKey || !cfg.tiktokClientSecret || !cfg.tokenEncKey) {
    throw new Error("Thiếu TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET / TOKEN_ENC_KEY trong .env.local");
  }
  return { clientKey: cfg.tiktokClientKey, clientSecret: cfg.tiktokClientSecret, encKey: cfg.tokenEncKey };
}

/** Returns a valid access token for the channel, refreshing (and persisting) it if needed. */
export async function getAccessToken(db: SupabaseClient, cfg: WorkerConfig, channelId: string): Promise<string> {
  const { clientKey, clientSecret, encKey } = needTiktokConfig(cfg);
  const row = must(await db.from("tiktok_tokens").select("*").eq("channel_id", channelId).maybeSingle(), "load tiktok token");
  if (!row) throw new Error("Kênh chưa kết nối TikTok");

  if (new Date(row.expires_at).getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return decryptToken(row.access_token_enc, encKey);
  }
  if (new Date(row.refresh_expires_at).getTime() < Date.now()) {
    throw new Error("Phiên TikTok đã hết hạn, hãy bấm Kết nối TikTok lại");
  }

  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: await decryptToken(row.refresh_token_enc, encKey),
    }),
  });
  const tok = await res.json();
  if (!tok.access_token) throw new Error(`Không gia hạn được token TikTok: ${tok.error_description ?? tok.error ?? res.status}`);

  const now = Date.now();
  must(
    await db.from("tiktok_tokens").update({
      access_token_enc: await encryptToken(tok.access_token, encKey),
      refresh_token_enc: await encryptToken(tok.refresh_token, encKey),
      expires_at: new Date(now + tok.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(now + tok.refresh_expires_in * 1000).toISOString(),
      scope: tok.scope,
      updated_at: new Date().toISOString(),
    }).eq("channel_id", channelId),
    "save refreshed token",
  );
  return tok.access_token;
}

async function api(token: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.error?.code && data.error.code !== "ok")) {
    throw new Error(`TikTok ${path}: ${data.error?.code ?? res.status} ${data.error?.message ?? ""}`.trim());
  }
  return data.data;
}

export function chunkPlan(size: number): { chunkSize: number; count: number } {
  if (size <= MAX_SINGLE_CHUNK) return { chunkSize: size, count: 1 };
  // The last chunk absorbs the remainder, so count is floored
  return { chunkSize: CHUNK, count: Math.floor(size / CHUNK) };
}

/** Upload a video to the creator's TikTok inbox (drafts). Returns publish_id. */
export async function uploadToInbox(token: string, filePath: string): Promise<string> {
  const file = await readFile(filePath);
  const { chunkSize, count } = chunkPlan(file.length);
  const init = await api(token, "/post/publish/inbox/video/init/", {
    source_info: { source: "FILE_UPLOAD", video_size: file.length, chunk_size: chunkSize, total_chunk_count: count },
  });

  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = i === count - 1 ? file.length : start + chunkSize;
    const res = await fetch(init.upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(end - start),
        "Content-Range": `bytes ${start}-${end - 1}/${file.length}`,
      },
      body: file.subarray(start, end),
    });
    if (!res.ok && res.status !== 206) throw new Error(`Upload chunk ${i + 1}/${count} lỗi HTTP ${res.status}`);
  }
  return init.publish_id;
}

export async function fetchPublishStatus(token: string, publishId: string): Promise<{ status: string; failReason?: string }> {
  const d = await api(token, "/post/publish/status/fetch/", { publish_id: publishId });
  return { status: d.status, failReason: d.fail_reason };
}

export interface TiktokVideo {
  id: string;
  title?: string;
  share_url?: string;
  cover_image_url?: string;
  create_time?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
}

export async function listVideos(token: string, maxPages = 5): Promise<TiktokVideo[]> {
  const fields = "id,title,share_url,cover_image_url,create_time,view_count,like_count,comment_count,share_count";
  const out: TiktokVideo[] = [];
  let cursor: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const d = await api(token, `/video/list/?fields=${fields}`, { max_count: 20, ...(cursor ? { cursor } : {}) });
    out.push(...(d.videos ?? []));
    if (!d.has_more) break;
    cursor = d.cursor;
  }
  return out;
}
