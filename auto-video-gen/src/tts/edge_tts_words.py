"""Edge TTS with word timings — used by edge-tts-python-client.ts.

Usage: python edge_tts_words.py <voice> <rate> <pitch> <volume> <text-file> <media-out> <words-out> [srt-out]

Writes the mp3 to <media-out> and a JSON array of words
[{"text": "...", "start": sec, "end": sec}, ...] to <words-out> (for karaoke captions).
"""
import asyncio
import json
import sys

import edge_tts


async def main() -> None:
    voice, rate, pitch, volume, text_file, media_out, words_out = sys.argv[1:8]
    srt_out = sys.argv[8] if len(sys.argv) > 8 else None
    with open(text_file, encoding="utf-8") as f:
        text = f.read()

    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume, boundary="WordBoundary")
    sub = edge_tts.SubMaker()
    words = []
    with open(media_out, "wb") as media:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                media.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                sub.feed(chunk)
                start = chunk["offset"] / 1e7  # 100-ns units
                words.append({"text": chunk["text"], "start": round(start, 3),
                              "end": round(start + chunk["duration"] / 1e7, 3)})

    with open(words_out, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)
    if srt_out:
        with open(srt_out, "w", encoding="utf-8") as f:
            f.write(sub.get_srt())


asyncio.run(main())
