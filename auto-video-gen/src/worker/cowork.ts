#!/usr/bin/env node
/**
 * Bridge for Cowork (the AI that writes scripts). See App-Video/COWORK.md.
 *
 *   npm run cowork -- pending                              # list videos waiting for a script (JSON)
 *   npm run cowork -- submit <videoId> <script.json> [caption.txt]
 *   npm run cowork -- skip <videoId> <lý do>               # article unreadable / not suitable
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ZodError } from "zod";
import { loadWorkerConfig, ENGINE_DIR } from "./config.js";
import { createDb, must, enqueue, getVideo } from "./db.js";
import { ScriptSchema } from "../render/script-schema.js";

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

  console.log("Usage: npm run cowork -- pending | submit <videoId> <script.json> [caption.txt] | skip <videoId> <lý do>");
  process.exit(1);
}

// Allow importing parseCaption in tests without running the CLI
if (process.argv[1]?.replace(/\\/g, "/").endsWith("worker/cowork.ts")) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
