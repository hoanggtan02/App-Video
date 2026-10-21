/**
 * Procedural background music + sound effects.
 *
 * Everything is synthesized from scratch (no downloads, no licensing risk) and
 * written as mp3 into:
 *   assets/music/gen-<name>.mp3          — looping background beds
 *   assets/sfx/<category>/gen-<name>.mp3 — categories used by sfx-selector.ts
 *
 * Run: npm run audio:make   (the pipeline also runs it when the folders are empty)
 * Your own royalty-free tracks can be dropped into assets/music/ as well.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
type Stereo = { L: Float32Array; R: Float32Array };

// ── deterministic noise ────────────────────────────────────────────────────
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

const buf = (sec: number): Stereo => ({ L: new Float32Array(Math.ceil(sec * SR)), R: new Float32Array(Math.ceil(sec * SR)) });
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Add a mono voice at `t0` with constant-power pan (-1..1). */
function add(out: Stereo, t0: number, samples: Float32Array, gain: number, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * gain;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
  for (let i = 0; i < samples.length && i0 + i < out.L.length; i++) {
    out.L[i0 + i] += samples[i] * gl;
    out.R[i0 + i] += samples[i] * gr;
  }
}

/** Tone with a few harmonics and an amp envelope function env(t). */
function tone(freq: number, sec: number, env: (t: number) => number, harmonics = [1, 0.35, 0.12], detune = 0): Float32Array {
  const s = new Float32Array(Math.ceil(sec * SR));
  for (let i = 0; i < s.length; i++) {
    const t = i / SR;
    let v = 0;
    harmonics.forEach((h, k) => { v += h * Math.sin(2 * Math.PI * freq * (k + 1) * (1 + detune) * t); });
    // 15 ms fade at the end so truncated notes don't click
    s[i] = v * env(t) * Math.min(1, (s.length - i) / (0.015 * SR));
  }
  return s;
}

const pluckEnv = (decay: number) => (t: number) => Math.min(1, t / 0.004) * Math.exp(-t * decay);
const padEnv = (len: number) => (t: number) => Math.min(1, t / 0.35) * Math.min(1, Math.max(0, (len - t) / 0.45));

function kick(): Float32Array {
  const s = new Float32Array(Math.ceil(0.35 * SR));
  let phase = 0;
  for (let i = 0; i < s.length; i++) {
    const t = i / SR;
    const f = 45 + 85 * Math.exp(-t * 28);
    phase += (2 * Math.PI * f) / SR;
    s[i] = Math.sin(phase) * Math.exp(-t * 9);
  }
  return s;
}

/** Noise burst, crude high-pass via first difference (repeat `hp` times). */
function noiseHit(sec: number, decay: number, hp: number, seed: number): Float32Array {
  const r = rng(seed);
  let s: Float32Array = new Float32Array(Math.ceil(sec * SR)).map(() => r());
  for (let k = 0; k < hp; k++) {
    const d = new Float32Array(s.length);
    for (let i = 1; i < s.length; i++) d[i] = s[i] - s[i - 1];
    s = d;
  }
  for (let i = 0; i < s.length; i++) s[i] *= Math.exp((-i / SR) * decay);
  return s;
}

// ── background music ───────────────────────────────────────────────────────
interface Track { name: string; bpm: number; root: number; chords: number[][]; drums: "full" | "light"; seed: number }

const TRACKS: Track[] = [
  // I – V – vi – IV, bright and upbeat
  { name: "upbeat", bpm: 112, root: 60, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], drums: "full", seed: 11 },
  // vi – IV – I – V, softer
  { name: "chill", bpm: 92, root: 57, chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], drums: "light", seed: 23 },
  // i – VI – III – VII, minor "tech news" drive
  { name: "tech", bpm: 120, root: 57, chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], drums: "full", seed: 37 },
];

function renderTrack(tr: Track): Stereo {
  const beat = 60 / tr.bpm;
  const bar = beat * 4;
  const bars = 16; // loops seamlessly (pipeline loops the file)
  const out = buf(bars * bar);
  const k = kick();
  for (let b = 0; b < bars; b++) {
    const chord = tr.chords[b % tr.chords.length];
    const t0 = b * bar;
    // pad: slightly detuned pair per note, spread in stereo
    chord.forEach((n, j) => {
      const f = midi(tr.root + n);
      add(out, t0, tone(f, bar + 0.3, padEnv(bar + 0.3), [1, 0.25, 0.08], 0.002), 0.08, -0.5 + j * 0.5);
      add(out, t0, tone(f, bar + 0.3, padEnv(bar + 0.3), [1, 0.25, 0.08], -0.002), 0.08, 0.5 - j * 0.5);
    });
    // bass on 1, the "and" of 2, and 3
    const bassF = midi(tr.root + chord[0] - 24);
    for (const at of [0, 1.5, 2]) add(out, t0 + at * beat, tone(bassF, beat * 1.2, pluckEnv(4), [1, 0.4]), 0.22);
    // arpeggio, 8th notes, alternating pan
    for (let e = 0; e < 8; e++) {
      const n = chord[[0, 1, 2, 1, 2, 0, 1, 2][e]] + 12 + (e === 4 ? 12 : 0);
      add(out, t0 + e * beat / 2, tone(midi(tr.root + n), 0.6, pluckEnv(9), [1, 0.3, 0.1]), 0.07, e % 2 ? 0.45 : -0.45);
    }
    // drums
    for (let q = 0; q < 4; q++) {
      const tq = t0 + q * beat;
      if (tr.drums === "full" || q % 2 === 0) add(out, tq, k, 0.5);
      if (q % 2 === 1) add(out, tq, noiseHit(0.25, 22, 1, tr.seed + b * 4 + q), tr.drums === "full" ? 0.07 : 0.035);
      add(out, tq + beat / 2, noiseHit(0.05, 90, 2, tr.seed + 99 + b * 4 + q), 0.018, 0.2);
    }
  }
  return out;
}

// ── sound effects ──────────────────────────────────────────────────────────
function whoosh(sec: number, seed: number, rising: boolean): Stereo {
  const out = buf(sec);
  const r = rng(seed);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < out.L.length; i++) {
    const t = i / SR, p = t / sec;
    const sweep = rising ? p : 1 - p;
    const a = 0.02 + 0.5 * sweep * sweep;          // one-pole cutoff sweep
    lp += a * (r() - lp);
    lp2 += 0.02 * (lp - lp2);
    const v = (lp - lp2) * Math.sin(Math.PI * Math.min(1, p * 1.15)) ** 2 * 2.2;
    const pan = -0.8 + 1.6 * p;
    out.L[i] = v * Math.cos(((pan + 1) * Math.PI) / 4);
    out.R[i] = v * Math.sin(((pan + 1) * Math.PI) / 4);
  }
  return out;
}

function mono(sec: number, ...parts: [number, Float32Array, number][]): Stereo {
  const out = buf(sec);
  for (const [t0, s, g] of parts) add(out, t0, s, g);
  return out;
}

const bell = (n: number, sec = 1.4, decay = 4) => tone(midi(n), sec, pluckEnv(decay), [1, 0.5, 0.0, 0.25, 0.0, 0.1]);

function popSfx(): Stereo {
  const s = new Float32Array(Math.ceil(0.12 * SR));
  let ph = 0;
  for (let i = 0; i < s.length; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (300 + 700 * Math.exp(-t * 60))) / SR;
    s[i] = Math.sin(ph) * Math.exp(-t * 35);
  }
  return mono(0.15, [0, s, 0.9]);
}

function impact(): Stereo {
  const boom = new Float32Array(Math.ceil(1.6 * SR));
  let ph = 0;
  for (let i = 0; i < boom.length; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (38 + 60 * Math.exp(-t * 12))) / SR;
    boom[i] = Math.sin(ph) * Math.exp(-t * 2.6);
  }
  return mono(1.7, [0, boom, 0.9], [0, noiseHit(0.5, 9, 0, 5), 0.25]);
}

const SFX: Record<string, Record<string, () => Stereo>> = {
  transition: {
    "whoosh-1": () => whoosh(0.55, 1, true),
    "whoosh-2": () => whoosh(0.45, 2, false),
    "whoosh-3": () => whoosh(0.7, 3, true),
    pop: popSfx,
  },
  emphasis: {
    ding: () => mono(1.5, [0, bell(88), 0.55]),
    "ding-low": () => mono(1.5, [0, bell(81), 0.55]),
    pop: popSfx,
  },
  success: {
    chime: () => mono(1.8, [0, bell(84), 0.4], [0.09, bell(88), 0.4], [0.18, bell(91), 0.45]),
    sparkle: () => mono(1.6, ...[96, 100, 103, 108, 103, 108].map((n, i) => [i * 0.06, bell(n, 0.8, 7), 0.25] as [number, Float32Array, number])),
  },
  reveal: {
    sparkle: () => mono(1.6, ...[91, 96, 100, 103, 108].map((n, i) => [i * 0.07, bell(n, 0.9, 6), 0.28] as [number, Float32Array, number])),
    riser: () => whoosh(1.0, 7, true),
  },
  alert: {
    notify: () => mono(1.0, [0, tone(880, 0.35, pluckEnv(9), [1, 0.2]), 0.45], [0.16, tone(660, 0.5, pluckEnv(7), [1, 0.2]), 0.45]),
  },
  fail: {
    "down-tone": () => mono(1.0, [0, tone(440, 0.4, pluckEnv(6), [1, 0.5, 0.3]), 0.4], [0.22, tone(330, 0.6, pluckEnv(5), [1, 0.5, 0.3]), 0.4]),
  },
  cinematic: { impact },
  drumroll: { impact },
  outro: {
    tada: () => mono(2.2, [0, bell(72, 2), 0.35], [0, bell(76, 2), 0.3], [0, bell(79, 2), 0.3], [0.12, bell(84, 2, 3), 0.4]),
  },
};

// ── encoding ───────────────────────────────────────────────────────────────
function normalize(x: Stereo, peak = 0.89) {
  let m = 0;
  for (let i = 0; i < x.L.length; i++) m = Math.max(m, Math.abs(x.L[i]), Math.abs(x.R[i]));
  const g = m > 0 ? peak / m : 1;
  for (let i = 0; i < x.L.length; i++) { x.L[i] = Math.tanh(x.L[i] * g); x.R[i] = Math.tanh(x.R[i] * g); }
}

function wav(x: Stereo): Buffer {
  const n = x.L.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 4, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x.L[i])) * 32767), 44 + i * 4);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x.R[i])) * 32767), 46 + i * 4);
  }
  return b;
}

async function writeMp3(x: Stereo, outPath: string) {
  normalize(x);
  await mkdir(dirname(outPath), { recursive: true });
  const tmp = outPath.replace(/\.mp3$/, ".tmp.wav");
  await writeFile(tmp, wav(x));
  await new Promise<void>((res, rej) => {
    const p = spawn("ffmpeg", ["-y", "-v", "error", "-i", tmp, "-c:a", "libmp3lame", "-b:a", "160k", outPath]);
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c} for ${outPath}`))));
    p.on("error", rej);
  });
  await rm(tmp, { force: true });
}

export async function generateAudioAssets(assetsDir: string): Promise<void> {
  for (const tr of TRACKS) await writeMp3(renderTrack(tr), join(assetsDir, "music", `gen-${tr.name}.mp3`));
  for (const [cat, items] of Object.entries(SFX)) {
    for (const [name, make] of Object.entries(items)) await writeMp3(make(), join(assetsDir, "sfx", cat, `gen-${name}.mp3`));
  }
}

const hasMp3 = (dir: string) => existsSync(dir) && readdirSync(dir, { recursive: true }).some((f) => String(f).endsWith(".mp3"));

/** Generate the library once if music/ or sfx/ has nothing in it. */
export async function ensureAudioAssets(assetsDir: string): Promise<void> {
  if (hasMp3(join(assetsDir, "music")) && hasMp3(join(assetsDir, "sfx"))) return;
  await generateAudioAssets(assetsDir);
}

// CLI: npm run audio:make
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets");
  generateAudioAssets(dir).then(() => console.log(`Audio assets written to ${dir}`));
}
