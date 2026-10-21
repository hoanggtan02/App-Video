/**
 * Karaoke captions — word timings → short on-screen chunks.
 *
 * Timings come from the TTS provider (edge-tts WordBoundary) when available;
 * otherwise they are estimated by spreading the words over the scene audio
 * proportionally to their length, so every provider still gets captions.
 */
import { existsSync, readFileSync } from "node:fs";

export interface CaptionWord {
  text: string;
  /** seconds from the start of the scene audio */
  start: number;
  end: number;
}

export interface CaptionChunk {
  words: CaptionWord[];
  start: number;
  /** when the chunk disappears (next chunk start, or last word end + hold) */
  end: number;
}

const MAX_WORDS = 4;
const MAX_CHARS = 24;
/** a silence longer than this between words starts a new chunk */
const PAUSE_SEC = 0.25;
const TAIL_HOLD_SEC = 0.35;

const norm = (s: string) => s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "");

/**
 * TTS word boundaries drop punctuation; re-attach it by matching each
 * timed word to the next token of the original text.
 */
export function alignToText(words: CaptionWord[], text: string): CaptionWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  let ti = 0;
  return words.map((w) => {
    const key = norm(w.text);
    for (let look = ti; look < Math.min(tokens.length, ti + 4); look++) {
      if (norm(tokens[look]) === key) {
        ti = look + 1;
        return { ...w, text: tokens[look] };
      }
    }
    return w;
  });
}

/** Spread the words of `text` over `durationSec`, weighted by length. */
export function estimateWords(text: string, durationSec: number): CaptionWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const lead = 0.1;
  const span = Math.max(0.5, durationSec - lead - 0.1);
  const weights = tokens.map((t) => t.length + (/[.,!?;:]$/.test(t) ? 3 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = lead;
  return tokens.map((t, i) => {
    const d = (weights[i] / total) * span;
    const w = { text: t, start: cursor, end: cursor + d };
    cursor += d;
    return w;
  });
}

/** Read `<scene>.words.json` if the TTS wrote one, else estimate. */
export function loadSceneWords(text: string, durationSec: number, wordsJsonPath: string): CaptionWord[] {
  if (existsSync(wordsJsonPath)) {
    try {
      const words = JSON.parse(readFileSync(wordsJsonPath, "utf8")) as CaptionWord[];
      if (Array.isArray(words) && words.length > 0) return alignToText(words, text);
    } catch {
      /* fall through to estimate */
    }
  }
  return estimateWords(text, durationSec);
}

export function chunkWords(words: CaptionWord[]): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (cur.length) chunks.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end + TAIL_HOLD_SEC });
    cur = [];
  };
  words.forEach((w, i) => {
    const chars = cur.reduce((n, c) => n + c.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= MAX_WORDS || chars > MAX_CHARS)) flush();
    cur.push(w);
    const next = words[i + 1];
    const endsPhrase = /[.,!?;:]$/.test(w.text);
    if (!next || endsPhrase || next.start - w.end > PAUSE_SEC) flush();
  });
  // A chunk stays up until the next one replaces it (no flicker in short pauses)
  for (let i = 0; i < chunks.length - 1; i++) {
    chunks[i].end = Math.min(chunks[i].end, chunks[i + 1].start);
    if (chunks[i + 1].start - chunks[i].end < 0.4) chunks[i].end = chunks[i + 1].start;
  }
  return chunks;
}
