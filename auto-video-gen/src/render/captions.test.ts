import { describe, it, expect } from "vitest";
import { alignToText, chunkWords, estimateWords, type CaptionWord } from "./captions.js";

const w = (text: string, start: number, end: number): CaptionWord => ({ text, start, end });

describe("alignToText", () => {
  it("re-attaches punctuation dropped by the TTS word boundaries", () => {
    const words = [w("Samsung", 0.1, 0.6), w("chơi", 0.6, 0.9), w("lớn", 0.9, 1.2), w("tung", 1.5, 1.8)];
    const out = alignToText(words, "Samsung chơi lớn, tung");
    expect(out.map((x) => x.text)).toEqual(["Samsung", "chơi", "lớn,", "tung"]);
    expect(out[2].start).toBe(0.9);
  });

  it("keeps the TTS text when a token cannot be matched", () => {
    const out = alignToText([w("2027", 0, 0.5)], "năm hai nghìn");
    expect(out[0].text).toBe("2027");
  });
});

describe("chunkWords", () => {
  it("breaks on punctuation, pauses and the 4-word limit", () => {
    const words = [
      w("một", 0, 0.2), w("hai", 0.2, 0.4), w("ba,", 0.4, 0.6),       // punctuation
      w("bốn", 0.7, 0.9), w("năm", 0.9, 1.1),
      w("sáu", 1.6, 1.8),                                               // pause > 0.25s
      w("a", 1.8, 1.9), w("b", 1.9, 2.0), w("c", 2.0, 2.1), w("d", 2.1, 2.2), w("e", 2.2, 2.3),
    ];
    const chunks = chunkWords(words).map((c) => c.words.map((x) => x.text).join(" "));
    expect(chunks).toEqual(["một hai ba,", "bốn năm", "sáu a b c", "d e"]);
  });

  it("keeps a chunk on screen until the next one starts when the gap is short", () => {
    const chunks = chunkWords([w("xin", 0, 0.3), w("chào.", 0.3, 0.6), w("tạm", 0.8, 1.0)]);
    expect(chunks[0].end).toBe(chunks[1].start);
  });
});

describe("estimateWords", () => {
  it("spreads every word inside the audio duration in order", () => {
    const words = estimateWords("Đây là một câu thử nghiệm.", 3);
    expect(words).toHaveLength(6);
    expect(words[0].start).toBeGreaterThan(0);
    expect(words[words.length - 1].end).toBeLessThanOrEqual(3);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeCloseTo(words[i - 1].end);
  });
});
