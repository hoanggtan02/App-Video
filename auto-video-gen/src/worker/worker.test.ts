import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken } from "./crypto.js";
import { parseCaption } from "./cowork.js";
import { chunkPlan } from "./tiktok.js";
import { dueSlots, localParts } from "./scheduler.js";

describe("token crypto", () => {
  const key = randomBytes(32).toString("base64");

  it("round-trips and uses a fresh IV each time", async () => {
    const a = await encryptToken("act.secret-token", key);
    const b = await encryptToken("act.secret-token", key);
    expect(a).toMatch(/^v1:/);
    expect(a).not.toBe(b);
    expect(await decryptToken(a, key)).toBe("act.secret-token");
  });

  it("fails with the wrong key", async () => {
    const enc = await encryptToken("x", key);
    await expect(decryptToken(enc, randomBytes(32).toString("base64"))).rejects.toThrow();
  });
});

describe("parseCaption", () => {
  it("splits caption and hashtags", () => {
    expect(parseCaption("Google vừa làm điều này 😱\n\n#congnghe #Google #ai #xuhuong\n")).toEqual({
      caption: "Google vừa làm điều này 😱",
      hashtags: ["congnghe", "google", "ai", "xuhuong"],
    });
  });

  it("handles a caption without hashtags", () => {
    expect(parseCaption("Chỉ có caption")).toEqual({ caption: "Chỉ có caption", hashtags: [] });
  });
});

describe("chunkPlan", () => {
  it("uses one chunk for files up to 64 MB", () => {
    expect(chunkPlan(15_000_000)).toEqual({ chunkSize: 15_000_000, count: 1 });
  });

  it("floors chunk count for big files so the last chunk takes the remainder", () => {
    const size = 100 * 1024 * 1024 + 123;
    expect(chunkPlan(size)).toEqual({ chunkSize: 10 * 1024 * 1024, count: 10 });
  });
});

describe("scheduler", () => {
  // 2026-10-20 00:30 UTC = 07:30 in Vietnam
  const now = new Date("2026-10-20T00:30:00Z");

  it("computes local date/time in the channel timezone", () => {
    expect(localParts(now, "Asia/Ho_Chi_Minh")).toEqual({ date: "2026-10-20", time: "07:30" });
  });

  it("returns only slots whose time has passed today", () => {
    expect(dueSlots(now, "Asia/Ho_Chi_Minh", ["07:00", "12:00", "bad"])).toEqual(["2026-10-20 07:00"]);
  });
});
