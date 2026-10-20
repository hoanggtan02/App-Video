import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { TtsClient } from "./tts-client.js";
import type { EdgeTtsOpts } from "./edge-tts-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Project-local Python deps installed by `npm run tts:setup` */
const PYDEPS_DIR = join(__dirname, "..", "..", ".pydeps");
const TIMEOUT_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Edge TTS via the Python `edge-tts` CLI.
 *
 * The npm package edge-tts-universal lags behind Microsoft's auth changes
 * (handshake gets rejected with 403 and the promise hangs). The Python package
 * is updated quickly, so we shell out to it instead.
 */
export class EdgeTtsPythonClient implements TtsClient {
  constructor(private cfg: EdgeTtsOpts & { python: string }) {}

  async generate(text: string, audioOutPath: string, srtOutPath?: string): Promise<void> {
    const delays = [1000, 2000, 4000];
    for (let attempt = 0; ; attempt++) {
      try {
        await this.synthesize(text, audioOutPath, srtOutPath);
        return;
      } catch (e) {
        if (attempt === delays.length) throw e;
        await sleep(delays[attempt]);
      }
    }
  }

  private async synthesize(text: string, audioOutPath: string, srtOutPath?: string): Promise<void> {
    // Pass text via file to avoid Windows command-line encoding issues with Vietnamese
    const tmp = await mkdtemp(join(tmpdir(), "edge-tts-"));
    const textFile = join(tmp, "text.txt");
    await writeFile(textFile, text, "utf8");

    const args = [
      "-m", "edge_tts",
      `--voice=${this.cfg.voice}`,
      `--rate=${this.cfg.rate ?? "+0%"}`,
      `--pitch=${this.cfg.pitch ?? "+0Hz"}`,
      `--volume=${this.cfg.volume ?? "+0%"}`,
      "--file", textFile,
      "--write-media", audioOutPath,
    ];
    if (srtOutPath) args.push("--write-subtitles", srtOutPath);

    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: "utf-8" };
    if (existsSync(PYDEPS_DIR)) {
      env.PYTHONPATH = [PYDEPS_DIR, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":");
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(this.cfg.python, args, { env, stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        proc.stderr.on("data", (d) => (stderr += d));
        const timer = setTimeout(() => {
          proc.kill();
          reject(new Error(`edge-tts timed out after ${TIMEOUT_MS / 1000}s`));
        }, TIMEOUT_MS);
        proc.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        proc.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0 && existsSync(audioOutPath)) resolve();
          else reject(new Error(`edge-tts exited with code ${code}: ${stderr.trim().split("\n").pop()}`));
        });
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}
