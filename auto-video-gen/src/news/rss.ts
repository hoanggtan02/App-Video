import axios from "axios";

export interface FeedItem {
  title: string;
  url: string;
  description: string;
  publishedAt: Date | null;
  image: string | null;
}

export interface TrendNewsLink {
  title: string;
  url: string;
  source: string;
}

export interface TrendItem {
  keyword: string;
  /** Approximate search volume, e.g. "1000+" → 1000 */
  traffic: number;
  news: TrendNewsLink[];
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0 Safari/537.36";

export async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  const res = await axios.get<string>(url, {
    responseType: "text",
    timeout: timeoutMs,
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
  });
  return res.data;
}

// ── Minimal XML helpers (RSS is simple enough; avoids an extra dependency) ──

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripCdata(s: string): string {
  return s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? stripCdata(m[1]).trim() : null;
}

function allTags(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi");
  return [...xml.matchAll(re)].map((m) => m[1]);
}

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseRss(xml: string): FeedItem[] {
  return allTags(xml, "item").flatMap((item) => {
    const title = stripHtml(tag(item, "title") ?? "");
    const url = decodeEntities(tag(item, "link") ?? tag(item, "guid") ?? "").trim();
    if (!title || !/^https?:\/\//.test(url)) return [];

    const rawDesc = tag(item, "description") ?? "";
    const descHtml = decodeEntities(rawDesc);
    const enclosure = item.match(/<enclosure[^>]*url="([^"]+)"/i)?.[1];
    const media = item.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i)?.[1];
    const imgInDesc = descHtml.match(/<img[^>]*src="([^"]+)"/i)?.[1];
    const image = enclosure ?? media ?? imgInDesc ?? null;

    return [{
      title,
      url,
      description: stripHtml(descHtml),
      publishedAt: parseDate(tag(item, "pubDate")),
      image: image ? decodeEntities(image) : null,
    }];
  });
}

export function parseTrends(xml: string): TrendItem[] {
  return allTags(xml, "item").flatMap((item) => {
    const keyword = stripHtml(tag(item, "title") ?? "");
    if (!keyword) return [];
    const trafficRaw = tag(item, "ht:approx_traffic") ?? "0";
    const traffic = parseInt(trafficRaw.replace(/[^\d]/g, ""), 10) || 0;
    const news = allTags(item, "ht:news_item").flatMap((n) => {
      const url = decodeEntities(tag(n, "ht:news_item_url") ?? "").trim();
      if (!url) return [];
      return [{
        title: stripHtml(tag(n, "ht:news_item_title") ?? ""),
        url,
        source: stripHtml(tag(n, "ht:news_item_source") ?? ""),
      }];
    });
    return [{ keyword, traffic, news }];
  });
}
