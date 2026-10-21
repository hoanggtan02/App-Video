import { describe, it, expect } from "vitest";
import { extractImageUrls } from "./article-images.js";

describe("extractImageUrls", () => {
  it("prefers lazy-load attributes and filters logos, icons, svg/gif and data URIs", () => {
    const html = `
      <img src="https://s1.vnecdn.net/v2/pc/graphics/logo_tagline.svg" alt="">
      <img src="data:image/gif;base64,R0lGOD" data-src="https://i1.vnecdn.net/2026/10/18/photo-a.webp?w=1020&amp;h=0">
      <img src="/images/icon-google.png">
      <img srcset="https://cdn.example.com/b-480.jpg 480w, https://cdn.example.com/b-1200.jpg 1200w" src="https://cdn.example.com/b-480.jpg">
      <img src="https://i1.vnecdn.net/2026/10/18/photo-a.webp?w=300">
      <img src="https://cdn.example.com/spinner.gif">`;
    expect(extractImageUrls(html, "https://vnexpress.net/bai-viet.html")).toEqual([
      "https://i1.vnecdn.net/2026/10/18/photo-a.webp?w=1020&h=0",
      "https://cdn.example.com/b-1200.jpg",
    ]);
  });

  it("resolves relative URLs against the page", () => {
    expect(extractImageUrls(`<img src="/media/x.jpg">`, "https://news.example.com/a/b.html"))
      .toEqual(["https://news.example.com/media/x.jpg"]);
  });
});
