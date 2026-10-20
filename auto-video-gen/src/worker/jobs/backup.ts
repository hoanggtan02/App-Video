import type { SupabaseClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, readdir, rm, stat, copyFile, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkerConfig } from "../config.js";
import { must } from "../db.js";
import { log } from "../../utils/logger.js";

/** Restore order matters (foreign keys). tiktok_tokens stay encrypted in the backup. */
export const BACKUP_TABLES = [
  "channels", "stories", "videos", "posts", "tiktok_videos", "stats_daily", "jobs", "tiktok_tokens",
] as const;
const PAGE = 1000;
const PREVIEW_KEEP_DAYS = 7;

function tar(args: string[]): Promise<void> {
  // Windows 10+ ships bsdtar, which writes .zip with -a
  return new Promise((resolve, reject) => {
    const p = spawn("tar", args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`tar exit ${c}: ${err}`))));
  });
}

async function dumpTable(db: SupabaseClient, table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = must(await db.from(table).select("*").range(from, from + PAGE - 1), `dump ${table}`) as unknown[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export async function runBackup(db: SupabaseClient, cfg: WorkerConfig) {
  const work = await mkdtemp(join(tmpdir(), "appvideo-backup-"));
  try {
    const counts: Record<string, number> = {};
    for (const t of BACKUP_TABLES) {
      const rows = await dumpTable(db, t);
      counts[t] = rows.length;
      await writeFile(join(work, `${t}.json`), JSON.stringify(rows, null, 1));
    }

    if (cfg.backupIncludeVideos) {
      const videos = must(await db.from("videos").select("id,local_dir").not("local_dir", "is", null), "list videos") as
        { id: string; local_dir: string }[];
      await mkdir(join(work, "videos"));
      for (const v of videos) {
        const f = join(v.local_dir, "final.mp4");
        if (existsSync(f)) await copyFile(f, join(work, "videos", `${v.id}.mp4`));
      }
    }

    await mkdir(cfg.backupDir, { recursive: true });
    const name = `backup-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 13)}.zip`;
    const out = join(cfg.backupDir, name);
    await tar(["-a", "-cf", out, "-C", work, "."]);
    const sizeMB = Math.round((await stat(out)).size / 1e5) / 10;

    // Keep the newest N backups
    const all = (await readdir(cfg.backupDir)).filter((f) => /^backup-.*\.zip$/.test(f)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - cfg.backupKeep))) await rm(join(cfg.backupDir, old));

    const cleaned = await cleanupPreviews(db);
    log.info(`  backup → ${out} (${sizeMB} MB), xóa ${cleaned} preview cũ`);
    return { file: out, sizeMB, rows: counts, previewsDeleted: cleaned };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Free Supabase storage: drop previews of videos posted more than a week ago. */
async function cleanupPreviews(db: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - PREVIEW_KEEP_DAYS * 86_400_000).toISOString();
  const old = must(
    await db.from("videos").select("id,preview_path").in("status", ["posted", "rejected"])
      .not("preview_path", "is", null).lt("updated_at", cutoff),
    "list old previews",
  ) as { id: string; preview_path: string }[];
  if (!old.length) return 0;
  await db.storage.from("previews").remove(old.map((v) => v.preview_path));
  must(await db.from("videos").update({ preview_path: null }).in("id", old.map((v) => v.id)), "clear preview paths");
  return old.length;
}

/** Upsert every table from a backup zip. Existing rows with the same id are overwritten. */
export async function restoreBackup(db: SupabaseClient, zipPath: string) {
  const work = await mkdtemp(join(tmpdir(), "appvideo-restore-"));
  try {
    await tar(["-xf", zipPath, "-C", work]);
    for (const t of BACKUP_TABLES) {
      const f = join(work, `${t}.json`);
      if (!existsSync(f)) continue;
      const rows = JSON.parse(await readFile(f, "utf8")) as unknown[];
      const onConflict =
        t === "tiktok_videos" ? "channel_id,tiktok_id" :
        t === "stats_daily" ? "channel_id,day" :
        t === "tiktok_tokens" ? "channel_id" : "id";
      for (let i = 0; i < rows.length; i += PAGE) {
        must(await db.from(t).upsert(rows.slice(i, i + PAGE) as any[], { onConflict }), `restore ${t}`);
      }
      log.info(`  ${t}: ${rows.length} dòng`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
