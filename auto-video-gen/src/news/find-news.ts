#!/usr/bin/env node
/**
 * Find hot news worth turning into a video.
 *
 *   npm run news:find                    # rank stories, write output/news/<timestamp>.json
 *   npm run news:find -- --top 5
 *   npm run news:find -- --config my-channel.json
 *   npm run news:used -- <url> [title]   # mark a story as used so it is skipped next time
 *
 * Sources and channel keywords live in news-sources.json.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fetchText, parseRss, parseTrends, type TrendItem } from "./rss.js";
import { scoreStories, normalize, type SourcedItem } from "./scorer.js";
import { log } from "../utils/logger.js";

interface SourcesConfig {
  maxAgeHours: number;
  top: number;
  trends?: { url: string };
  feeds: { name: string; url: string; weight?: number }[];
  preferKeywords: string[];
  blockKeywords: string[];
}

interface HistoryEntry {
  url: string;
  title: string;
  usedAt: string;
}

const NEWS_DIR = join("output", "news");
const HISTORY_PATH = join(NEWS_DIR, "history.json");
/** Stories used within this window are not suggested again */
const HISTORY_DAYS = 7;

async function loadHistory(): Promise<HistoryEntry[]> {
  if (!existsSync(HISTORY_PATH)) return [];
  return JSON.parse(await readFile(HISTORY_PATH, "utf8"));
}

async function markUsed(url: string, title: string): Promise<void> {
  await mkdir(NEWS_DIR, { recursive: true });
  const history = await loadHistory();
  if (!history.some((h) => h.url === url)) {
    history.push({ url, title, usedAt: new Date().toISOString() });
    await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2));
  }
  log.info(`Marked as used: ${title || url}`);
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function findNews(configPath: string, topOverride?: number): Promise<void> {
  const cfg: SourcesConfig = JSON.parse(await readFile(configPath, "utf8"));
  const top = topOverride ?? cfg.top;

  // Fetch everything in parallel; one broken feed must not kill the run
  const feedResults = await Promise.allSettled(
    cfg.feeds.map(async (f) => {
      const items = parseRss(await fetchText(f.url));
      return items.map((it): SourcedItem => ({ ...it, source: f.name, sourceWeight: f.weight ?? 1 }));
    }),
  );
  const items: SourcedItem[] = [];
  feedResults.forEach((r, i) => {
    if (r.status === "fulfilled") {
      items.push(...r.value);
      log.info(`  ${cfg.feeds[i].name}: ${r.value.length} tin`);
    } else {
      log.warn(`  ${cfg.feeds[i].name}: lỗi (${(r.reason as Error).message})`);
    }
  });

  let trends: TrendItem[] = [];
  if (cfg.trends) {
    try {
      trends = parseTrends(await fetchText(cfg.trends.url));
      log.info(`  Google Trends: ${trends.map((t) => `${t.keyword} (${t.traffic}+)`).join(", ")}`);
    } catch (e) {
      log.warn(`  Google Trends: lỗi (${(e as Error).message})`);
    }
  }

  const cutoff = Date.now() - HISTORY_DAYS * 86_400_000;
  const history = (await loadHistory()).filter((h) => new Date(h.usedAt).getTime() >= cutoff);

  const stories = scoreStories(items, trends, {
    maxAgeHours: cfg.maxAgeHours,
    preferKeywords: cfg.preferKeywords,
    blockKeywords: cfg.blockKeywords,
    usedUrls: new Set(history.map((h) => h.url)),
    usedTitles: history.map((h) => normalize(h.title)),
  }).slice(0, top);

  await mkdir(NEWS_DIR, { recursive: true });
  const outPath = join(NEWS_DIR, `${stamp(new Date())}.json`);
  await writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), trends, stories }, null, 2));

  console.log(`\n=== Top ${stories.length} tin hot ===`);
  stories.forEach((s, i) => {
    console.log(`\n${i + 1}. [${s.score}] ${s.title}`);
    console.log(`   ${s.source}${s.alsoCoveredBy.length ? ` (+ ${s.alsoCoveredBy.join(", ")})` : ""}`);
    console.log(`   ${s.url}`);
    console.log(`   Lý do: ${s.reasons.join(" · ")}`);
  });
  console.log(`\nĐã lưu: ${outPath}`);
}

async function main() {
  const args = process.argv.slice(2);
  try {
    if (args[0] === "used") {
      if (!args[1]) throw new Error("Usage: npm run news:used -- <url> [title]");
      await markUsed(args[1], args.slice(2).join(" "));
      return;
    }
    const cfgIdx = args.indexOf("--config");
    const topIdx = args.indexOf("--top");
    await findNews(
      cfgIdx >= 0 ? args[cfgIdx + 1] : "news-sources.json",
      topIdx >= 0 ? parseInt(args[topIdx + 1], 10) : undefined,
    );
  } catch (e) {
    log.error("news finder failed", e);
    process.exit(1);
  }
}

main();
