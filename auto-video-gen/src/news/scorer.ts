import type { FeedItem, TrendItem } from "./rss.js";

export interface SourcedItem extends FeedItem {
  source: string;
  sourceWeight: number;
}

export interface ScoringConfig {
  maxAgeHours: number;
  preferKeywords: string[];
  blockKeywords: string[];
  /** URLs already turned into videos */
  usedUrls: Set<string>;
  /** Normalized titles of recently used stories (to skip re-covering the same event) */
  usedTitles: string[];
  now?: Date;
}

export interface ScoredStory {
  score: number;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  image: string | null;
  description: string;
  /** Other outlets covering the same story */
  alsoCoveredBy: string[];
  trendKeyword: string | null;
  reasons: string[];
}

const SIMILAR_THRESHOLD = 0.4;

/** Lowercase, strip Vietnamese diacritics, collapse to plain words. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Very common syllables that make unrelated titles look similar
const STOP = new Set(
  "va cua la co cho voi nhung cac mot nay khi da duoc trong tu tai den ra ve vao nguoi nam ngay sau truoc hon nhat bi se thi o de lam".split(" "),
);

export function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w)));
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function containsPhrase(haystack: string, phrase: string): boolean {
  // Short all-caps acronyms ("AI") collide with Vietnamese words once lowercased ("ai" = who),
  // so match them case-sensitively on the original text.
  if (/^[A-Z0-9]{2,4}$/.test(phrase)) {
    return new RegExp(`(^|[^\\p{L}\\p{N}])${phrase}($|[^\\p{L}\\p{N}])`, "u").test(haystack);
  }
  const p = normalize(phrase);
  return p.length > 0 && ` ${normalize(haystack)} `.includes(` ${p} `);
}

export function scoreStories(items: SourcedItem[], trends: TrendItem[], cfg: ScoringConfig): ScoredStory[] {
  const now = cfg.now ?? new Date();

  // URLs Google Trends explicitly links to a trending keyword
  const trendByUrl = new Map<string, TrendItem>();
  for (const t of trends) for (const n of t.news) trendByUrl.set(n.url, t);

  const fresh = items.filter((it) => {
    if (cfg.usedUrls.has(it.url)) return false;
    if (cfg.usedTitles.some((t) => similarity(t, it.title) >= SIMILAR_THRESHOLD)) return false;
    const text = `${it.title} ${it.description}`;
    if (cfg.blockKeywords.some((k) => containsPhrase(text, k))) return false;
    if (it.publishedAt) {
      const ageH = (now.getTime() - it.publishedAt.getTime()) / 3_600_000;
      if (ageH > cfg.maxAgeHours) return false;
    }
    return true;
  });

  // Cluster near-duplicate titles across outlets — coverage breadth is a strong "hot" signal
  const clusters: SourcedItem[][] = [];
  for (const it of fresh) {
    const c = clusters.find((cl) => similarity(cl[0].title, it.title) >= SIMILAR_THRESHOLD);
    if (c) c.push(it);
    else clusters.push([it]);
  }

  const stories = clusters.map((cluster) => {
    const scored = cluster.map((it) => ({ it, ...scoreOne(it, cluster, trends, trendByUrl, cfg, now) }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const others = [...new Set(cluster.map((c) => c.source).filter((s) => s !== best.it.source))];
    return {
      score: Math.round(best.score),
      title: best.it.title,
      url: best.it.url,
      source: best.it.source,
      publishedAt: best.it.publishedAt?.toISOString() ?? null,
      image: best.it.image,
      description: best.it.description.slice(0, 300),
      alsoCoveredBy: others,
      trendKeyword: best.trendKeyword,
      reasons: best.reasons,
    };
  });

  return stories.sort((a, b) => b.score - a.score);
}

function scoreOne(
  it: SourcedItem,
  cluster: SourcedItem[],
  trends: TrendItem[],
  trendByUrl: Map<string, TrendItem>,
  cfg: ScoringConfig,
  now: Date,
): { score: number; reasons: string[]; trendKeyword: string | null } {
  const reasons: string[] = [];
  let score = 0;

  // Freshness: 0–30
  if (it.publishedAt) {
    const ageH = Math.max(0, (now.getTime() - it.publishedAt.getTime()) / 3_600_000);
    const fresh = Math.max(0, 1 - ageH / cfg.maxAgeHours) * 30;
    score += fresh;
    reasons.push(`mới ${ageH.toFixed(1)}h (+${fresh.toFixed(0)})`);
  }

  // Source weight: ~10
  score += it.sourceWeight * 10;

  // Google Trends: direct link or keyword in title — the strongest signal
  let trend = trendByUrl.get(it.url) ?? null;
  let trendPts = 0;
  if (trend) {
    trendPts = 40;
  } else {
    trend = trends.find((t) => containsPhrase(it.title, t.keyword)) ?? null;
    if (trend) trendPts = 25;
  }
  if (trend) {
    // Bonus by search volume: 1000+ → +3, 100000+ → +5 ...
    trendPts += Math.log10(Math.max(10, trend.traffic));
    score += trendPts;
    reasons.push(`Google Trends "${trend.keyword}" ${trend.traffic}+ (+${trendPts.toFixed(0)})`);
  }

  // Coverage breadth: other outlets on the same story, +10 each, max 30
  const outlets = new Set(cluster.map((c) => c.source));
  if (outlets.size > 1) {
    const pts = Math.min(30, (outlets.size - 1) * 10);
    score += pts;
    reasons.push(`${outlets.size} báo cùng đưa tin (+${pts})`);
  }

  // Channel niche keywords: +15 each, max 30
  const text = `${it.title} ${it.description}`;
  const hits = cfg.preferKeywords.filter((k) => containsPhrase(text, k));
  if (hits.length) {
    const pts = Math.min(30, hits.length * 15);
    score += pts;
    reasons.push(`đúng chủ đề kênh: ${hits.join(", ")} (+${pts})`);
  }

  // Image makes a better background
  if (it.image) score += 5;

  return { score, reasons, trendKeyword: trend?.keyword ?? null };
}
