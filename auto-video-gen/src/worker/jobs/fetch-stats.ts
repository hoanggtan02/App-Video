import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "../config.js";
import { must, type Job } from "../db.js";
import { getAccessToken, listVideos } from "../tiktok.js";

/** Snapshot the channel's latest TikTok videos and today's totals. */
export async function runFetchStats(db: SupabaseClient, cfg: WorkerConfig, job: Job) {
  const channelId = job.channel_id!;
  const token = await getAccessToken(db, cfg, channelId);
  const videos = await listVideos(token);
  const now = new Date().toISOString();

  if (videos.length) {
    must(
      await db.from("tiktok_videos").upsert(
        videos.map((v) => ({
          channel_id: channelId,
          tiktok_id: v.id,
          title: v.title ?? null,
          share_url: v.share_url ?? null,
          cover_url: v.cover_image_url ?? null,
          create_time: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
          view_count: v.view_count ?? 0,
          like_count: v.like_count ?? 0,
          comment_count: v.comment_count ?? 0,
          share_count: v.share_count ?? 0,
          fetched_at: now,
        })),
        { onConflict: "channel_id,tiktok_id" },
      ),
      "save tiktok videos",
    );
  }

  const sum = (k: keyof (typeof videos)[number]) => videos.reduce((a, v) => a + (Number(v[k]) || 0), 0);
  const totals = {
    channel_id: channelId,
    day: now.slice(0, 10),
    videos: videos.length,
    views: sum("view_count"),
    likes: sum("like_count"),
    comments: sum("comment_count"),
    shares: sum("share_count"),
  };
  must(await db.from("stats_daily").upsert(totals, { onConflict: "channel_id,day" }), "save daily stats");
  return totals;
}
