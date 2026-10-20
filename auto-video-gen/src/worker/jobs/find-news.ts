import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchText, parseRss, parseTrends, type TrendItem } from "../../news/rss.js";
import { scoreStories, normalize, type SourcedItem } from "../../news/scorer.js";
import { getChannel, resolveSettings, must, type Job } from "../db.js";
import { log } from "../../utils/logger.js";

/** Stories selected/used within this window are not suggested again */
const HISTORY_DAYS = 7;

/**
 * payload: { autoSelect?: number } — also create that many videos (status waiting_script)
 * from the best new stories, for Cowork to write scripts.
 */
export async function runFindNews(db: SupabaseClient, job: Job) {
  const channel = await getChannel(db, job.channel_id!);
  const s = resolveSettings(channel.settings);

  const feedResults = await Promise.allSettled(
    s.feeds.map(async (f) =>
      parseRss(await fetchText(f.url)).map((it): SourcedItem => ({ ...it, source: f.name, sourceWeight: f.weight ?? 1 })),
    ),
  );
  const items: SourcedItem[] = [];
  const feedErrors: string[] = [];
  feedResults.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else feedErrors.push(`${s.feeds[i].name}: ${(r.reason as Error).message}`);
  });

  let trends: TrendItem[] = [];
  if (s.trendsUrl) {
    try {
      trends = parseTrends(await fetchText(s.trendsUrl));
    } catch (e) {
      feedErrors.push(`Google Trends: ${(e as Error).message}`);
    }
  }

  // Everything already in the DB is skipped; selected/used titles also block near-duplicates
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  const existing = must(
    await db.from("stories").select("url,title,status").eq("channel_id", channel.id).gte("found_at", since),
    "load story history",
  ) as { url: string; title: string; status: string }[];

  const stories = scoreStories(items, trends, {
    maxAgeHours: s.maxAgeHours,
    preferKeywords: s.preferKeywords,
    blockKeywords: s.blockKeywords,
    usedUrls: new Set(existing.map((e) => e.url)),
    usedTitles: existing.filter((e) => e.status === "selected" || e.status === "used").map((e) => normalize(e.title)),
  }).slice(0, s.top);

  const inserted = stories.length
    ? (must(
        await db.from("stories").upsert(
          stories.map((st) => ({
            channel_id: channel.id,
            url: st.url,
            title: st.title,
            source: st.source,
            description: st.description,
            image: st.image,
            published_at: st.publishedAt,
            score: st.score,
            reasons: st.reasons,
            trend_keyword: st.trendKeyword,
            also_covered_by: st.alsoCoveredBy,
          })),
          { onConflict: "channel_id,url", ignoreDuplicates: true },
        ).select("id,url,title,score"),
        "save stories",
      ) as { id: string; url: string; title: string; score: number }[])
    : [];

  const autoSelect = Number(job.payload.autoSelect ?? 0);
  const selected = [...inserted].sort((a, b) => b.score - a.score).slice(0, autoSelect);
  for (const st of selected) {
    must(await db.from("stories").update({ status: "selected" }).eq("id", st.id), "select story");
    must(
      await db.from("videos").insert({
        channel_id: channel.id, story_id: st.id, source_url: st.url, title: st.title, status: "waiting_script",
      }),
      "create video",
    );
  }

  log.info(`  find_news ${channel.name}: ${inserted.length} tin mới, chọn ${selected.length}`);
  return {
    found: inserted.length,
    selected: selected.map((st) => st.title),
    trends: trends.map((t) => `${t.keyword} (${t.traffic}+)`),
    feedErrors,
  };
}
