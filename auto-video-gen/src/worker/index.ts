#!/usr/bin/env node
/**
 * App-Video worker — runs on the machine that renders videos.
 *
 *   npm run worker                      # main loop (keep running)
 *   npm run worker -- restore <zip>     # restore a backup into Supabase
 *
 * Executes jobs queued by the web UI / scheduler: find_news, render, post, fetch_stats, backup.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWorkerConfig, type WorkerConfig } from "./config.js";
import { createDb, must, type Job } from "./db.js";
import { tickScheduler } from "./scheduler.js";
import { runFindNews } from "./jobs/find-news.js";
import { runRender } from "./jobs/render.js";
import { runPost } from "./jobs/post.js";
import { runFetchStats } from "./jobs/fetch-stats.js";
import { runBackup, restoreBackup } from "./jobs/backup.js";
import { log } from "../utils/logger.js";

const IDLE_POLL_MS = 3_000;
const TICK_MS = 60_000;
const MAX_ATTEMPTS = 2;

async function execute(db: SupabaseClient, cfg: WorkerConfig, job: Job): Promise<unknown> {
  switch (job.type) {
    case "find_news": return runFindNews(db, job);
    case "render": return runRender(db, job);
    case "post": return runPost(db, cfg, job);
    case "fetch_stats": return runFetchStats(db, cfg, job);
    case "backup": return runBackup(db, cfg);
  }
}

async function processJob(db: SupabaseClient, cfg: WorkerConfig, job: Job) {
  log.info(`▶ ${job.type} ${job.id}`);
  try {
    const result = await execute(db, cfg, job);
    await db.from("jobs").update({ status: "done", result: result ?? null, error: null, finished_at: new Date().toISOString() }).eq("id", job.id);
    log.info(`✓ ${job.type} ${job.id}`);
  } catch (e) {
    const msg = (e as Error).message;
    log.error(`✗ ${job.type} ${job.id}: ${msg}`);
    await db.from("jobs").update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", job.id);
    // Surface the failure on the video card too
    if (job.payload.videoId && (job.type === "render" || job.type === "post")) {
      await db.from("videos").update({ status: "failed", error: msg }).eq("id", job.payload.videoId);
    }
  }
}

async function heartbeat(db: SupabaseClient, cfg: WorkerConfig, current: string | null) {
  await db.from("worker_heartbeat").upsert({
    id: cfg.workerId,
    last_seen: new Date().toISOString(),
    info: { current, pid: process.pid, node: process.version },
  });
}

/** Jobs left "running" by a crash/restart go back to the queue (single-worker setup). */
async function recoverStuckJobs(db: SupabaseClient) {
  const stuck = must(await db.from("jobs").select("id,attempts").eq("status", "running"), "load stuck jobs") as
    { id: string; attempts: number }[];
  for (const j of stuck) {
    await db.from("jobs").update(
      j.attempts >= MAX_ATTEMPTS
        ? { status: "failed", error: "Worker dừng giữa chừng quá nhiều lần", finished_at: new Date().toISOString() }
        : { status: "pending" },
    ).eq("id", j.id);
  }
  if (stuck.length) log.warn(`Recovered ${stuck.length} job(s) left running`);
}

async function main() {
  const cfg = loadWorkerConfig();
  const db = createDb(cfg);

  if (process.argv[2] === "restore") {
    if (!process.argv[3]) throw new Error("Usage: npm run worker -- restore <backup.zip>");
    await restoreBackup(db, process.argv[3]);
    log.info("Khôi phục xong");
    return;
  }

  log.info(`Worker "${cfg.workerId}" started — Supabase ${cfg.supabaseUrl}`);
  await recoverStuckJobs(db);

  let current: string | null = null;
  let lastTick = 0;
  let stopping = false;
  process.on("SIGINT", () => {
    log.info("Stopping after current job...");
    stopping = true;
  });

  // Independent of the job loop so the UI still sees the worker alive during long renders
  const beat = () => heartbeat(db, cfg, current).catch((e) => log.warn(`heartbeat: ${(e as Error).message}`));
  await beat();
  const beatTimer = setInterval(beat, TICK_MS);

  while (!stopping) {
    if (Date.now() - lastTick >= TICK_MS) {
      lastTick = Date.now();
      try {
        await tickScheduler(db, cfg);
      } catch (e) {
        log.warn(`scheduler failed: ${(e as Error).message}`);
      }
    }

    const { data, error } = await db.rpc("claim_job");
    const job = (data as Job[] | null)?.[0];
    if (error) log.warn(`claim_job: ${error.message}`);
    if (!job) {
      await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
      continue;
    }

    current = `${job.type} ${job.id}`;
    await beat();
    await processJob(db, cfg, job);
    current = null;
  }
  clearInterval(beatTimer);
}

main().catch((e) => {
  log.error("worker crashed", e);
  process.exit(1);
});
