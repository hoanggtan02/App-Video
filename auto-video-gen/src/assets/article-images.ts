/**
 * Article photos — pull the in-article images from the source page so every
 * body scene gets its own background (the og:image only covers the hook).
 */
import axios from "axios";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { fetchImage } from "./image-fetcher.js";

const SKIP = /(logo|icon|avatar|banner|sprite|emoji|tracking|pixel|placeholder|ads?[\/_-]|qrcode|button)/i;
const MIN_WIDTH = 480;

/** Image URLs in page order (lazy-load attributes first), deduped, junk filtered out. */
export function extractImageUrls(html: string, pageUrl: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const attr = (name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
    const srcset = attr("data-srcset") ?? attr("srcset");
    // srcset → the last (largest) candidate
    const fromSrcset = srcset?.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
    const raw = attr("data-src") ?? attr("data-original") ?? attr("data-lazy-src") ?? fromSrcset ?? attr("src");
    if (!raw || raw.startsWith("data:")) continue;
    let url: URL;
    try {
      url = new URL(raw.replace(/&amp;/g, "&"), pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    if (/\.(svg|gif)$/i.test(url.pathname) || SKIP.test(url.pathname)) continue;
    const key = (url.host + url.pathname).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url.toString());
  }
  return out;
}

function imageWidth(path: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", path]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => resolve(parseInt(out.trim(), 10) || 0));
    p.on("error", () => resolve(0));
  });
}

/**
 * Download up to `max` article photos into `<outputDir>/images/scene-N.jpg`.
 * Returns paths relative to outputDir. Never throws — no photos is fine.
 */
export async function fetchArticleImages(
  articleUrl: string,
  outputDir: string,
  opts: { max?: number; excludeUrls?: (string | null)[] } = {},
): Promise<string[]> {
  const max = opts.max ?? 5;
  const exclude = new Set(
    (opts.excludeUrls ?? []).filter(Boolean).map((u) => {
      try { const x = new URL(u!); return (x.host + x.pathname).toLowerCase(); } catch { return ""; }
    }),
  );
  let html: string;
  try {
    const resp = await axios.get<string>(articleUrl, {
      timeout: 20000,
      responseType: "text",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
    });
    html = resp.data;
  } catch {
    return [];
  }

  const urls = extractImageUrls(html, articleUrl).filter((u) => {
    const x = new URL(u);
    return !exclude.has((x.host + x.pathname).toLowerCase());
  });

  const saved: string[] = [];
  for (const url of urls) {
    if (saved.length >= max) break;
    const rel = `images/scene-${saved.length + 1}.jpg`;
    const abs = join(outputDir, rel);
    const r = await fetchImage(url, abs);
    if (!r.success) continue;
    if ((await imageWidth(abs)) < MIN_WIDTH) {
      await rm(abs, { force: true }); // thumbnails, inline icons
      continue;
    }
    saved.push(rel);
  }
  return saved;
}
