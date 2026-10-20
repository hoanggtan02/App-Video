import type { SupabaseClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WorkerConfig } from "../config.js";
import { getVideo, must, type Job } from "../db.js";
import { getAccessToken, uploadToInbox, fetchPublishStatus } from "../tiktok.js";
import { log } from "../../utils/logger.js";

const POLL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

/** payload: { videoId } — uploads to the TikTok inbox; the user finishes posting in the app. */
export async function runPost(db: SupabaseClient, cfg: WorkerConfig, job: Job) {
  const video = await getVideo(db, job.payload.videoId);
  if (!video.local_dir) throw new Error("Video chưa render");
  const file = join(video.local_dir, "final.mp4");
  if (!existsSync(file)) throw new Error(`Không tìm thấy file ${file}`);

  must(await db.from("videos").update({ status: "posting", error: null }).eq("id", video.id), "mark posting");
  const token = await getAccessToken(db, cfg, video.channel_id);

  const publishId = await uploadToInbox(token, file);
  const post = must(
    await db.from("posts").insert({ channel_id: video.channel_id, video_id: video.id, mode: "inbox", publish_id: publishId })
      .select("id").single(),
    "create post",
  ) as { id: string };
  log.info(`  post ${video.title}: uploaded, publish_id=${publishId}`);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const st = await fetchPublishStatus(token, publishId);
    if (st.status === "SEND_TO_USER_INBOX" || st.status === "PUBLISH_COMPLETE") {
      const published = st.status === "PUBLISH_COMPLETE";
      await db.from("posts").update({ status: published ? "published" : "sent_to_inbox" }).eq("id", post.id);
      await db.from("videos").update({ status: "posted" }).eq("id", video.id);
      return { publishId, status: st.status };
    }
    if (st.status === "FAILED") {
      await db.from("posts").update({ status: "failed", error: st.failReason ?? "FAILED" }).eq("id", post.id);
      throw new Error(`TikTok xử lý thất bại: ${st.failReason ?? "unknown"}`);
    }
  }
  throw new Error("Hết thời gian chờ TikTok xử lý video (5 phút) — kiểm tra hộp thư TikTok");
}
