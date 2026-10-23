export interface Feed {
  name: string;
  url: string;
  weight?: number;
}

export interface ChannelSettings {
  feeds?: Feed[];
  preferKeywords?: string[];
  blockKeywords?: string[];
  maxAgeHours?: number;
  voice?: string;
  rate?: string;
  theme?: "dark-neon" | "light-pro";
  scheduleTimes?: string[];
  videosPerDay?: number;
  autoPost?: boolean;
  timezone?: string;
}

export interface Channel {
  id: string;
  name: string;
  handle: string | null;
  avatar_url: string | null;
  settings: ChannelSettings;
  tiktok_display_name: string | null;
  tiktok_avatar_url: string | null;
  tiktok_connected_at: string | null;
  created_at: string;
}

export type StoryStatus = "new" | "selected" | "skipped" | "used";

export interface Story {
  id: string;
  channel_id: string;
  url: string;
  title: string;
  source: string | null;
  description: string | null;
  image: string | null;
  published_at: string | null;
  score: number;
  reasons: string[];
  trend_keyword: string | null;
  also_covered_by: string[];
  status: StoryStatus;
  found_at: string;
}

export type VideoStatus =
  | "waiting_script" | "script_ready" | "rendering" | "review" | "approved"
  | "posting" | "posted" | "rejected" | "failed";

export type VideoKind = "standard" | "premium";

export interface Video {
  id: string;
  channel_id: string;
  story_id: string | null;
  source_url: string | null;
  title: string;
  status: VideoStatus;
  /** standard = template render; premium = film made by Cowork with lemo-opuscar */
  kind: VideoKind;
  /** lemo-opuscar style name; null = Cowork picks */
  film_style: string | null;
  local_dir: string | null;
  script: any;
  caption: string | null;
  hashtags: string[];
  duration_sec: number | null;
  preview_path: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: string;
  video_id: string;
  mode: "inbox" | "direct";
  publish_id: string | null;
  status: "processing" | "sent_to_inbox" | "published" | "failed";
  error: string | null;
  created_at: string;
  video?: { title: string } | null;
}

export type JobType = "find_news" | "render" | "post" | "fetch_stats" | "backup";

export interface Job {
  id: string;
  channel_id: string | null;
  type: JobType;
  payload: Record<string, any>;
  status: "pending" | "running" | "done" | "failed";
  result: any;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface TiktokVideo {
  tiktok_id: string;
  title: string | null;
  share_url: string | null;
  cover_url: string | null;
  create_time: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
}

export interface StatsDay {
  day: string;
  videos: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface Heartbeat {
  id: string;
  last_seen: string;
  info: { current?: string | null };
}
