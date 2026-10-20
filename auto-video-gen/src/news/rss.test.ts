import { describe, it, expect } from "vitest";
import { parseRss, parseTrends } from "./rss.js";

describe("parseRss", () => {
  it("parses title, link, date and image from VnExpress-style items", () => {
    const xml = `<rss><channel><item>
      <title>Nhịp cầu &amp; bến cảng</title>
      <description><![CDATA[<a href="https://vnexpress.net/a.html"><img src="https://img.vn/a.jpg"></a></br>Mô tả ngắn.]]></description>
      <pubDate>Mon, 19 Oct 2026 00:00:00 +0700</pubDate>
      <link>https://vnexpress.net/a.html</link>
    </item></channel></rss>`;
    const [it] = parseRss(xml);
    expect(it.title).toBe("Nhịp cầu & bến cảng");
    expect(it.url).toBe("https://vnexpress.net/a.html");
    expect(it.image).toBe("https://img.vn/a.jpg");
    expect(it.description).toBe("Mô tả ngắn.");
    expect(it.publishedAt?.toISOString()).toBe("2026-10-18T17:00:00.000Z");
  });

  it("skips items without a valid link", () => {
    expect(parseRss("<item><title>X</title></item>")).toEqual([]);
  });
});

describe("parseTrends", () => {
  it("parses keyword, traffic and linked news", () => {
    const xml = `<rss><channel><item>
      <title>bất động sản</title>
      <ht:approx_traffic>1,000+</ht:approx_traffic>
      <ht:news_item>
        <ht:news_item_title>Giá chung cư giảm</ht:news_item_title>
        <ht:news_item_url>https://vnexpress.net/b.html</ht:news_item_url>
        <ht:news_item_source>VnExpress</ht:news_item_source>
      </ht:news_item>
    </item></channel></rss>`;
    expect(parseTrends(xml)).toEqual([
      {
        keyword: "bất động sản",
        traffic: 1000,
        news: [{ title: "Giá chung cư giảm", url: "https://vnexpress.net/b.html", source: "VnExpress" }],
      },
    ]);
  });
});
