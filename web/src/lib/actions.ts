import { supabase, must } from "./supabase";
import type { Channel, JobType, Story, Video } from "./types";

export async function enqueue(channelId: string | null, type: JobType, payload: Record<string, unknown> = {}) {
  must(await supabase.from("jobs").insert({ channel_id: channelId, type, payload }));
}

export async function createVideoFromStory(story: Story) {
  must(await supabase.from("stories").update({ status: "selected" }).eq("id", story.id));
  must(
    await supabase.from("videos").insert({
      channel_id: story.channel_id, story_id: story.id, source_url: story.url, title: story.title, status: "waiting_script",
    }),
  );
}

export async function createVideoFromUrl(channelId: string, url: string) {
  if (!/^https?:\/\//.test(url)) throw new Error("URL phải bắt đầu bằng http:// hoặc https://");
  must(await supabase.from("videos").insert({ channel_id: channelId, source_url: url, title: url, status: "waiting_script" }));
}

export async function skipStory(story: Story) {
  must(await supabase.from("stories").update({ status: "skipped" }).eq("id", story.id));
}

export async function saveCaption(video: Video, caption: string, hashtags: string) {
  const tags = hashtags.split(/[\s,]+/).map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean);
  must(await supabase.from("videos").update({ caption, hashtags: tags }).eq("id", video.id));
}

/** Approve; if TikTok is connected, queue the upload right away. */
export async function approveVideo(video: Video, channel: Channel) {
  must(await supabase.from("videos").update({ status: "approved" }).eq("id", video.id));
  if (channel.tiktok_connected_at) await enqueue(channel.id, "post", { videoId: video.id });
}

export async function postVideo(video: Video) {
  await enqueue(video.channel_id, "post", { videoId: video.id });
}

export async function rejectVideo(video: Video) {
  must(await supabase.from("videos").update({ status: "rejected" }).eq("id", video.id));
}

export async function rerenderVideo(video: Video) {
  if (!video.script) throw new Error("Video chưa có kịch bản — chờ Cowork viết");
  must(await supabase.from("videos").update({ status: "script_ready", error: null }).eq("id", video.id));
  await enqueue(video.channel_id, "render", { videoId: video.id });
}

/** Send back to Cowork to rewrite the script. */
export async function rewriteScript(video: Video) {
  must(await supabase.from("videos").update({ status: "waiting_script", error: null }).eq("id", video.id));
}

export async function deleteVideo(video: Video) {
  if (video.preview_path) await supabase.storage.from("previews").remove([video.preview_path]);
  must(await supabase.from("videos").delete().eq("id", video.id));
}

export async function previewUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("previews").createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

async function callTiktokAuth(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("tiktok-auth", { body });
  if (error) {
    // Edge Function errors carry the JSON body in error.context
    const detail = await (error as any).context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return data;
}

export async function connectTiktok(channelId: string) {
  const { url } = await callTiktokAuth({ action: "start", channelId });
  window.location.href = url;
}

export async function finishTiktokConnect(code: string, state: string) {
  return callTiktokAuth({ action: "callback", code, state });
}

export async function disconnectTiktok(channelId: string) {
  await callTiktokAuth({ action: "disconnect", channelId });
}
