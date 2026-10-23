#!/usr/bin/env node
/**
 * Bridge for Cowork (the AI that writes scripts). See App-Video/COWORK.md.
 *
 *   npm run cowork -- pending                              # list videos waiting for a script (JSON)
 *   npm run cowork -- submit <videoId> <script.json> [caption.txt]
 *   npm run cowork -- skip <videoId> <lý do>               # article unreadable / not suitable
 *
 * Premium films (lemo-opuscar, see App-Video/COWORK-FILM.md):
 *   npm run cowork -- films                                # list premium videos waiting for a film (JSON)
 *   npm run cowork -- film-start <videoId>                 # claim it (status rendering) before producing
 *   npm run cowork -- film-submit <videoId> <film.mp4> [caption.txt]
 */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ZodError } from "zod";
import { loadWorkerConfig, ENGINE_DIR } from "./config.js";
import { createDb, must, enqueue, getVideo, getChannel, resolveSettings } from "./db.js";
import { newVideoDir } from "./jobs/render.js";
import { getDurationSec, getVideoSize } from "../assets/audio-tools.js";
import { ScriptSchema } from "../render/script-schema.js";

/** TikTok-friendly bounds for a submitted film */
const FILM_MIN_SEC = 15;
const FILM_MAX_SEC = 180;

/** caption.txt = caption line(s), blank line, then "#tag1 #tag2 ..." */
export function parseCaption(text: string): { caption: string; hashtags: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tagLine = lines.length > 1 && lines[lines.length - 1].startsWith("#") ? lines.pop()! : "";
  return {
    caption: lines.join(" "),
    hashtags: tagLine.split(/\s+/).filter((t) => /^#\S+$/.test(t)).map((t) => t.slice(1).toLowerCase()),
  };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const db = createDb(loadWorkerConfig());

  if (cmd === "pending") {
    const videos = must(
      await db.from("videos")
        .select("id,title,source_url,created_at,channel:channels(name,handle,settings),story:stories(title,url,source,description,image,trend_keyword)")
        .eq("status", "waiting_script")
        .eq("kind", "standard")
        .order("created_at"),
      "load pending videos",
    ) as any[];
    const out = videos.map((v) => ({
      videoId: v.id,
      url: v.story?.url ?? v.source_url,
      title: v.story?.title ?? v.title,
      source: v.story?.source ?? null,
      description: v.story?.description ?? null,
      image: v.story?.image ?? null,
      trendKeyword: v.story?.trend_keyword ?? null,
      channel: { name: v.channel?.name, handle: v.channel?.handle },
      workDir: join("output", "cowork", v.id),
    }));
    for (const v of out) await mkdir(join(ENGINE_DIR, v.workDir), { recursive: true });
    await mkdir(join(ENGINE_DIR, "output", "cowork"), { recursive: true });
    await writeFile(join(ENGINE_DIR, "output", "cowork", "pending.json"), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === "submit") {
    const [videoId, scriptPath, captionPath] = args;
    if (!videoId || !scriptPath) throw new Error("Usage: npm run cowork -- submit <videoId> <script.json> [caption.txt]");
    const video = await getVideo(db, videoId);
    if (video.kind === "premium") throw new Error("Đây là phim cao cấp — nộp bằng film-submit (xem COWORK-FILM.md)");
    if (video.status !== "waiting_script" && video.status !== "failed") {
      throw new Error(`Video đang ở trạng thái "${video.status}", không nhận kịch bản mới`);
    }

    const raw = JSON.parse(await readFile(scriptPath, "utf8"));
    // voiceId is filled by the pipeline at render time
    if (raw.voice && !raw.voice.voiceId) raw.voice.voiceId = "${VOICE_ID}";
    // Validate only — store the raw JSON (keeps "$source.image" placeholders), not zod's normalized copy
    try {
      ScriptSchema.parse(raw);
    } catch (e) {
      if (e instanceof ZodError) {
        console.error("Kịch bản KHÔNG hợp lệ — sửa các lỗi sau rồi submit lại:");
        for (const issue of e.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
        process.exit(2);
      }
      throw e;
    }

    const cap = captionPath ? parseCaption(await readFile(captionPath, "utf8")) : { caption: null, hashtags: [] };
    must(
      await db.from("videos").update({
        script: raw,
        title: raw.metadata.title,
        caption: cap.caption,
        hashtags: cap.hashtags,
        status: "script_ready",
        error: null,
      }).eq("id", videoId),
      "save script",
    );
    await enqueue(db, video.channel_id, "render", { videoId });
    console.log(`OK — đã nhận kịch bản "${raw.metadata.title}", worker sẽ render.`);
    return;
  }

  if (cmd === "skip") {
    const [videoId, ...reason] = args;
    if (!videoId) throw new Error("Usage: npm run cowork -- skip <videoId> <lý do>");
    must(
      await db.from("videos").update({ status: "failed", error: `Cowork bỏ qua: ${reason.join(" ") || "không rõ"}` }).eq("id", videoId),
      "skip video",
    );
    console.log("OK — đã bỏ qua");
    return;
  }

  if (cmd === "films") {
    const videos = must(
      await db.from("videos")
        .select("id,title,source_url,film_style,created_at,channel:channels(name,handle,settings),story:stories(title,url,source,description,image,trend_keyword)")
        .eq("status", "waiting_script")
        .eq("kind", "premium")
        .order("created_at"),
      "load pending films",
    ) as any[];
    const out = videos.map((v) => {
      const s = resolveSettings(v.channel?.settings ?? {});
      return {
        videoId: v.id,
        url: v.story?.url ?? v.source_url,
        title: v.story?.title ?? v.title,
        source: v.story?.source ?? null,
        description: v.story?.description ?? null,
        image: v.story?.image ?? null,
        trendKeyword: v.story?.trend_keyword ?? null,
        channel: { name: v.channel?.name, handle: v.channel?.handle },
        style: v.film_style ?? null,
        film: { size: "1080x1920", minSec: 45, maxSec: 75, language: "vi", voice: s.voice, rate: s.rate },
        projectDir: join(ENGINE_DIR, "output", "films", v.id),
      };
    });
    for (const f of out) {
      await mkdir(f.projectDir, { recursive: true });
      await writeFile(join(f.projectDir, "brief.json"), JSON.stringify(f, null, 2));
    }
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === "film-start") {
    const [videoId] = args;
    if (!videoId) throw new Error("Usage: npm run cowork -- film-start <videoId>");
    // Conditional update = claim: a second Cowork run gets 0 rows and stops
    const rows = must(
      await db.from("videos").update({ status: "rendering", error: null })
        .eq("id", videoId).eq("kind", "premium").eq("status", "waiting_script").select("id"),
      "claim film",
    ) as { id: string }[];
    if (!rows.length) throw new Error("Phim này không còn ở trạng thái chờ dựng (đã có người nhận, hoặc không phải phim cao cấp)");
    console.log("OK — đã nhận phim, bắt đầu dựng.");
    return;
  }

  if (cmd === "film-submit") {
    const [videoId, filmPath, captionPath] = args;
    if (!videoId || !filmPath) throw new Error("Usage: npm run cowork -- film-submit <videoId> <film.mp4> [caption.txt]");
    const video = await getVideo(db, videoId);
    if (video.kind !== "premium") throw new Error("Video này không phải phim cao cấp — dùng submit");
    if (!["waiting_script", "rendering", "failed"].includes(video.status)) {
      throw new Error(`Video đang ở trạng thái "${video.status}", không nhận phim mới`);
    }
    const src = resolve(filmPath);
    if (!existsSync(src)) throw new Error(`Không tìm thấy file ${src}`);

    const { width, height } = await getVideoSize(src);
    const duration = await getDurationSec(src);
    const problems = [
      ...(width >= height ? [`khung ${width}x${height} không phải dọc 9:16 (render lại với --size 1080x1920)`] : []),
      ...(duration < FILM_MIN_SEC || duration > FILM_MAX_SEC ? [`dài ${duration.toFixed(1)}s, cần ${FILM_MIN_SEC}–${FILM_MAX_SEC}s`] : []),
    ];
    if (problems.length) {
      console.error("Phim KHÔNG hợp lệ — sửa rồi nộp lại:");
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(2);
    }

    const channel = await getChannel(db, video.channel_id);
    const dir = newVideoDir(channel.name, video.title);
    await mkdir(dir, { recursive: true });
    await copyFile(src, join(dir, "video.mp4"));

    const cap = captionPath ? parseCaption(await readFile(captionPath, "utf8")) : { caption: video.caption, hashtags: video.hashtags };
    must(
      await db.from("videos").update({
        local_dir: dir,
        caption: cap.caption,
        hashtags: cap.hashtags,
        status: "script_ready",
        error: null,
      }).eq("id", videoId),
      "save film",
    );
    await enqueue(db, video.channel_id, "render", { videoId });
    console.log(`OK — đã nhận phim ${width}x${height}, ${duration.toFixed(1)}s. Worker sẽ nén và đưa lên mục Chờ duyệt.`);
    return;
  }

  console.log("Usage: npm run cowork -- pending | submit <videoId> <script.json> [caption.txt] | skip <videoId> <lý do>\n" +
    "       npm run cowork -- films | film-start <videoId> | film-submit <videoId> <film.mp4> [caption.txt]");
  process.exit(1);
}

// Allow importing parseCaption in tests without running the CLI
if (process.argv[1]?.replace(/\\/g, "/").endsWith("worker/cowork.ts")) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
