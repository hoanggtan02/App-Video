import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_DIR, type WorkerConfig } from "./config.js";

export interface ChannelSettings {
  feeds: { name: string; url: string; weight?: number }[];
  trendsUrl: string | null;
  preferKeywords: string[];
  blockKeywords: string[];
  maxAgeHours: number;
  /** Stories saved per find_news run */
  top: number;
  ttsProvider: string;
  voice: string;
  rate: string;
  theme: "dark-neon" | "light-pro";
  /** "HH:MM" in channel timezone; each slot finds news + selects videosPerDay stories */
  scheduleTimes: string[];
  videosPerDay: number;
  /** Post to TikTok right after render without manual review */
  autoPost: boolean;
  timezone: string;
}

export interface Channel {
  id: string;
  owner_id: string;
  name: string;
  handle: string | null;
  avatar_url: string | null;
  settings: Partial<ChannelSettings>;
  tiktok_display_name: string | null;
  tiktok_avatar_url: string | null;
  tiktok_connected_at: string | null;
}

export interface Job {
  id: string;
  channel_id: string | null;
  type: "find_news" | "render" | "post" | "fetch_stats" | "backup";
  payload: Record<string, any>;
  status: string;
  attempts: number;
  created_at: string;
}

export interface Video {
  id: string;
  channel_id: string;
  story_id: string | null;
  source_url: string | null;
  title: string;
  status: string;
  /** standard = template render; premium = film made by Cowork with lemo-opuscar */
  kind: "standard" | "premium";
  /** lemo-opuscar style name; null = Cowork picks */
  film_style: string | null;
  script: any;
  caption: string | null;
  hashtags: string[];
  duration_sec: number | null;
  preview_path: string | null;
  local_dir: string | null;
}

export function createDb(cfg: WorkerConfig): SupabaseClient {
  return createClient(cfg.supabaseUrl, cfg.serviceRoleKey, { auth: { persistSession: false } });
}

/** Defaults come from news-sources.json so CLI and worker share one source of truth. */
export function resolveSettings(s: Partial<ChannelSettings>): ChannelSettings {
  const file = JSON.parse(readFileSync(join(ENGINE_DIR, "news-sources.json"), "utf8"));
  return {
    feeds: s.feeds?.length ? s.feeds : file.feeds,
    trendsUrl: s.trendsUrl === undefined ? file.trends?.url ?? null : s.trendsUrl,
    preferKeywords: s.preferKeywords ?? file.preferKeywords,
    blockKeywords: s.blockKeywords ?? file.blockKeywords,
    maxAgeHours: s.maxAgeHours ?? file.maxAgeHours,
    top: s.top ?? 20,
    ttsProvider: s.ttsProvider ?? process.env.TTS_PROVIDER ?? "edge-tts",
    voice: s.voice ?? process.env.EDGE_TTS_VOICE ?? "vi-VN-NamMinhNeural",
    rate: s.rate ?? process.env.EDGE_TTS_RATE ?? "+0%",
    theme: s.theme ?? (process.env.VIDEO_THEME === "light-pro" ? "light-pro" : "dark-neon"),
    scheduleTimes: s.scheduleTimes ?? ["07:00"],
    videosPerDay: s.videosPerDay ?? 1,
    autoPost: s.autoPost ?? false,
    timezone: s.timezone ?? "Asia/Ho_Chi_Minh",
  };
}

/** Throw on Supabase errors so job handlers fail loudly. */
export function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export async function getChannel(db: SupabaseClient, id: string): Promise<Channel> {
  return must(await db.from("channels").select("*").eq("id", id).single(), "load channel") as Channel;
}

export async function getVideo(db: SupabaseClient, id: string): Promise<Video> {
  return must(await db.from("videos").select("*").eq("id", id).single(), "load video") as Video;
}

export async function enqueue(db: SupabaseClient, channelId: string | null, type: Job["type"], payload: Record<string, unknown> = {}) {
  must(await db.from("jobs").insert({ channel_id: channelId, type, payload, created_by: null }), `enqueue ${type}`);
}
