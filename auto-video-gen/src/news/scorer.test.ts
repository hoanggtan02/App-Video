import { describe, it, expect } from "vitest";
import { normalize, similarity, containsPhrase, scoreStories, type SourcedItem } from "./scorer.js";

const now = new Date("2026-10-20T10:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

function item(title: string, source: string, ageH = 1, url = `https://x.vn/${encodeURIComponent(title)}`): SourcedItem {
  return { title, url, description: "", publishedAt: hoursAgo(ageH), image: null, source, sourceWeight: 1 };
}

const baseCfg = { maxAgeHours: 24, preferKeywords: [], blockKeywords: [], usedUrls: new Set<string>(), usedTitles: [], now };

describe("normalize / similarity", () => {
  it("strips Vietnamese diacritics", () => {
    expect(normalize("Đội tuyển Việt Nam thắng!")).toBe("doi tuyen viet nam thang");
  });

  it("scores near-duplicate titles as similar", () => {
    expect(similarity("Apple ra mắt iPhone 18 giá rẻ", "iPhone 18 giá rẻ được Apple ra mắt")).toBeGreaterThan(0.6);
    expect(similarity("Apple ra mắt iPhone 18", "Giá vàng hôm nay tăng mạnh")).toBeLessThan(0.1);
  });
});

describe("containsPhrase", () => {
  it("matches acronyms case-sensitively so 'AI' does not match Vietnamese 'ai'", () => {
    expect(containsPhrase("Ai cũng muốn có cổ phiếu", "AI")).toBe(false);
    expect(containsPhrase("Hãng công nghệ tự làm chip AI", "AI")).toBe(true);
  });

  it("matches whole words ignoring diacritics", () => {
    expect(containsPhrase("Điện thoại mới của Samsung", "điện thoại")).toBe(true);
    expect(containsPhrase("Samsungs", "Samsung")).toBe(false);
  });
});

describe("scoreStories", () => {
  it("merges the same story from several outlets and ranks it higher", () => {
    const stories = scoreStories(
      [
        item("Apple ra mắt iPhone 18 giá rẻ", "A"),
        item("iPhone 18 giá rẻ được Apple ra mắt", "B"),
        item("Giá vàng hôm nay tăng nhẹ", "C"),
      ],
      [],
      baseCfg,
    );
    expect(stories).toHaveLength(2);
    expect(stories[0].title).toContain("iPhone 18");
    expect(stories[0].alsoCoveredBy).toHaveLength(1);
  });

  it("boosts stories linked from Google Trends", () => {
    const trendUrl = "https://x.vn/trend";
    const stories = scoreStories(
      [item("Tin bình thường", "A"), item("Tin đang hot", "A", 1, trendUrl)],
      [{ keyword: "hot", traffic: 1000, news: [{ title: "", url: trendUrl, source: "A" }] }],
      baseCfg,
    );
    expect(stories[0].url).toBe(trendUrl);
    expect(stories[0].trendKeyword).toBe("hot");
  });

  it("drops blocked, stale and already-used stories", () => {
    const stories = scoreStories(
      [
        item("Kết quả xổ số miền Nam", "A"),
        item("Tin cũ từ hôm kia", "A", 48),
        item("Tin đã làm video rồi", "A", 1, "https://x.vn/used"),
        item("Tin mới hoàn toàn", "A"),
      ],
      [],
      { ...baseCfg, blockKeywords: ["xổ số"], usedUrls: new Set(["https://x.vn/used"]) },
    );
    expect(stories.map((s) => s.title)).toEqual(["Tin mới hoàn toàn"]);
  });
});
