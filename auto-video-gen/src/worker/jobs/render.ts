import type { SupabaseClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ENGINE_DIR } from "../config.js";
import { getChannel, getVideo, resolveSettings, must, enqueue, type Job } from "../db.js";
import { getDurationSec } from "../../assets/audio-tools.js";
import { toSlug } from "../../utils/slug.js";
import { log } from "../../utils/logger.js";

/** Supabase free plan rejects uploads above 50 MB */
const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ...opts, shell: process.platform === "win32" && cmd === "npx" });
    let tail = "";
    const keep = (d: Buffer) => (tail = (tail + d.toString()).slice(-4000));
    proc.stdout.on("data", keep);
    proc.stderr.on("data", keep);
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(tail) : reject(new Error(`${cmd} exit ${code}\n${tail.slice(-1500)}`))));
  });
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** payload: { videoId } */
export async function runRender(db: SupabaseClient, job: Job) {
  const video = await getVideo(db, job.payload.videoId);
  if (!video.script) throw new Error("Video chưa có kịch bản");
  const channel = await getChannel(db, video.channel_id);
  const s = resolveSettings(channel.settings);

  must(await db.from("videos").update({ status: "rendering", error: null }).eq("id", video.id), "mark rendering");

  // Channel identity always wins over whatever the script author wrote
  const script = structuredClone(video.script);
  script.metadata.channel = channel.name;
  script.voice = { provider: s.ttsProvider, voiceId: "${VOICE_ID}", speed: script.voice?.speed ?? 1.0 };
  for (const scene of script.scenes ?? []) {
    if (scene.templateData?.template === "outro") scene.templateData.channelName = channel.name.slice(0, 30);
  }

  const dir = join(ENGINE_DIR, "output", toSlug(channel.name), `${stamp()}-${toSlug(video.title)}`);
  await mkdir(dir, { recursive: true });
  const scriptPath = join(dir, "script.json");
  await writeFile(scriptPath, JSON.stringify(script, null, 2));

  log.info(`  render ${video.title} → ${dir}`);
  await run("npx", ["tsx", "src/cli.ts", scriptPath], {
    cwd: ENGINE_DIR,
    env: {
      ...process.env,
      TTS_PROVIDER: s.ttsProvider,
      EDGE_TTS_VOICE: s.voice,
      EDGE_TTS_RATE: s.rate,
      VIDEO_THEME: s.theme,
      TIKTOK_DISPLAY_NAME: channel.tiktok_display_name ?? channel.name,
      TIKTOK_HANDLE: channel.handle ?? "",
      ...(channel.tiktok_avatar_url || channel.avatar_url
        ? { TIKTOK_AVATAR_URL: (channel.tiktok_avatar_url ?? channel.avatar_url)! }
        : {}),
    },
  });

  // Re-encode: the raw render is ~100 MB; TikTok re-compresses anyway
  const finalPath = join(dir, "final.mp4");
  await run("ffmpeg", [
    "-y", "-i", join(dir, "video.mp4"),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", finalPath,
  ]);
  const size = (await stat(finalPath)).size;
  const duration = await getDurationSec(finalPath);

  let previewPath: string | null = null;
  if (size <= MAX_PREVIEW_BYTES) {
    previewPath = `${channel.id}/${video.id}.mp4`;
    const { error } = await db.storage.from("previews").upload(previewPath, await readFile(finalPath), {
      contentType: "video/mp4",
      upsert: true,
    });
    if (error) {
      log.warn(`  preview upload failed: ${error.message}`);
      previewPath = null;
    }
  } else {
    log.warn(`  final.mp4 ${(size / 1e6).toFixed(1)} MB > 50 MB, skip preview upload`);
  }

  const canAutoPost = s.autoPost && !!channel.tiktok_connected_at;
  must(
    await db.from("videos").update({
      status: canAutoPost ? "approved" : "review",
      duration_sec: Math.round(duration * 10) / 10,
      preview_path: previewPath,
      local_dir: dir,
    }).eq("id", video.id),
    "save render result",
  );
  if (video.story_id) await db.from("stories").update({ status: "used" }).eq("id", video.story_id);
  if (canAutoPost) await enqueue(db, channel.id, "post", { videoId: video.id });

  return { dir, sizeMB: Math.round(size / 1e5) / 10, durationSec: duration, preview: !!previewPath, autoPost: canAutoPost };
}
