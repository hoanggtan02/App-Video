import { config as loadDotenv } from "dotenv";
import { hostname } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

loadDotenv({ path: ".env.local" });

const __dirname = dirname(fileURLToPath(import.meta.url));
/** auto-video-gen/ */
export const ENGINE_DIR = resolve(__dirname, "..", "..");
/** App-Video/ */
export const APP_DIR = resolve(ENGINE_DIR, "..");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Thiếu biến ${name} trong auto-video-gen/.env.local (xem .env.example)`);
  return v;
}

export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  tiktokClientKey?: string;
  tiktokClientSecret?: string;
  tokenEncKey?: string;
  backupDir: string;
  backupTime: string;
  backupKeep: number;
  backupIncludeVideos: boolean;
  workerId: string;
  timezone: string;
}

export function loadWorkerConfig(): WorkerConfig {
  return {
    supabaseUrl: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    tiktokClientKey: process.env.TIKTOK_CLIENT_KEY,
    tiktokClientSecret: process.env.TIKTOK_CLIENT_SECRET,
    tokenEncKey: process.env.TOKEN_ENC_KEY,
    backupDir: resolve(ENGINE_DIR, process.env.BACKUP_DIR ?? join("..", "backups")),
    backupTime: process.env.BACKUP_TIME ?? "02:00",
    backupKeep: parseInt(process.env.BACKUP_KEEP ?? "30", 10),
    backupIncludeVideos: process.env.BACKUP_INCLUDE_VIDEOS === "true",
    workerId: process.env.WORKER_ID ?? hostname(),
    timezone: process.env.WORKER_TIMEZONE ?? "Asia/Ho_Chi_Minh",
  };
}
