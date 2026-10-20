import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";
import { must, resolveSettings, enqueue, type Channel } from "./db.js";
import { log } from "../utils/logger.js";

/** Date "YYYY-MM-DD" and time "HH:MM" of `now` in a timezone. */
export function localParts(now: Date, timeZone: string): { date: string; time: string } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const g = (t: string) => f.find((p) => p.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

/** Slots of today that are due (time reached), e.g. ["2026-10-20 07:00"]. Missed slots still run the same day. */
export function dueSlots(now: Date, timeZone: string, times: string[]): string[] {
  const { date, time } = localParts(now, timeZone);
  return times.filter((t) => /^\d{2}:\d{2}$/.test(t) && t <= time).map((t) => `${date} ${t}`);
}

async function slotAlreadyQueued(db: SupabaseClient, channelId: string | null, type: string, slot: string) {
  let q = db.from("jobs").select("id", { count: "exact", head: true }).eq("type", type).eq("payload->>slot", slot);
  q = channelId ? q.eq("channel_id", channelId) : q.is("channel_id", null);
  const { count, error } = await q;
  if (error) throw new Error(`check slot: ${error.message}`);
  return (count ?? 0) > 0;
}

/** Enqueue scheduled work. Idempotent: each slot is recorded in jobs.payload.slot. */
export async function tickScheduler(db: SupabaseClient, cfg: WorkerConfig, now = new Date()) {
  const channels = must(await db.from("channels").select("*"), "load channels") as Channel[];
  for (const ch of channels) {
    const s = resolveSettings(ch.settings);
    for (const slot of dueSlots(now, s.timezone, s.scheduleTimes)) {
      if (await slotAlreadyQueued(db, ch.id, "find_news", slot)) continue;
      await enqueue(db, ch.id, "find_news", { slot, autoSelect: s.videosPerDay });
      if (ch.tiktok_connected_at) await enqueue(db, ch.id, "fetch_stats", { slot });
      log.info(`Scheduled ${ch.name} @ ${slot}`);
    }
  }

  for (const slot of dueSlots(now, cfg.timezone, [cfg.backupTime])) {
    if (await slotAlreadyQueued(db, null, "backup", slot)) continue;
    await enqueue(db, null, "backup", { slot });
    log.info(`Scheduled backup @ ${slot}`);
  }
}
