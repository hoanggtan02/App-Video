import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase, must } from "../lib/supabase";
import { useChannel } from "../lib/channel";
import { useLive, useAction } from "../lib/hooks";
import {
  approveVideo, deleteVideo, makePremiumFilm, postVideo, previewUrl, rejectVideo, rerenderVideo, rewriteScript, saveCaption,
} from "../lib/actions";
import { timeAgo, videoStatus } from "../lib/format";
import { Badge, Empty, FilmButton, Notice, PageHeader } from "../components/ui";
import type { Channel, Video, VideoStatus } from "../lib/types";

const TABS: { key: string; label: string; statuses: VideoStatus[] }[] = [
  { key: "review", label: "Chờ duyệt", statuses: ["review"] },
  { key: "progress", label: "Đang xử lý", statuses: ["waiting_script", "script_ready", "rendering", "approved", "posting"] },
  { key: "posted", label: "Đã đăng", statuses: ["posted"] },
  { key: "failed", label: "Lỗi / Từ chối", statuses: ["failed", "rejected"] },
];

export function Videos() {
  const { channel } = useChannel();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get("tab")) ?? TABS[0];

  const { data: videos } = useLive(
    async () =>
      must(
        await supabase.from("videos").select("*").eq("channel_id", channel!.id).in("status", tab.statuses)
          .order("updated_at", { ascending: false }).limit(50),
      ) as Video[],
    ["videos"],
    [channel?.id, tab.key],
  );

  return (
    <>
      <PageHeader title="Video" subtitle="Duyệt video trước khi đăng lên TikTok" />
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab.key === t.key ? "active" : ""} onClick={() => setParams({ tab: t.key })}>{t.label}</button>
        ))}
      </div>
      {videos?.length === 0 && <Empty>Không có video nào ở mục này.</Empty>}
      <div className="video-list">
        {videos?.map((v) => <VideoCard key={v.id} video={v} channel={channel!} />)}
      </div>
    </>
  );
}

function VideoCard({ video, channel }: { video: Video; channel: Channel }) {
  const [src, setSrc] = useState<string | null>(null);
  const [caption, setCaption] = useState(video.caption ?? "");
  const [tags, setTags] = useState(video.hashtags.map((t) => `#${t}`).join(" "));
  const [showScript, setShowScript] = useState(false);
  const action = useAction();
  const st = videoStatus(video);
  const premium = video.kind === "premium";
  const canRerender = premium ? !!video.local_dir : !!video.script;

  useEffect(() => {
    setCaption(video.caption ?? "");
    setTags(video.hashtags.map((t) => `#${t}`).join(" "));
  }, [video.caption, video.hashtags]);

  useEffect(() => {
    setSrc(null);
    if (video.preview_path) previewUrl(video.preview_path).then(setSrc).catch(() => setSrc(null));
  }, [video.preview_path]);

  const fullCaption = `${caption}\n\n${tags}`.trim();
  const dirty = caption !== (video.caption ?? "") || tags !== video.hashtags.map((t) => `#${t}`).join(" ");

  return (
    <article className="card video-card">
      <div className="video-frame">
        {src ? <video src={src} controls preload="metadata" playsInline /> : (
          <div className="video-placeholder muted small">
            {video.status === "rendering" ? "Đang render…" : video.preview_path ? "Đang tải…" : "Chưa có bản xem trước"}
          </div>
        )}
      </div>
      <div className="video-info">
        <div className="row between wrap gap">
          <span className="row gap">
            <Badge tone={st.tone}>{st.label}</Badge>
            {premium && <Badge tone="warn">★ Phim cao cấp{video.film_style ? ` · ${video.film_style}` : ""}</Badge>}
          </span>
          <span className="muted small">
            {video.duration_sec ? `${Math.round(video.duration_sec)}s · ` : ""}{timeAgo(video.updated_at)}
          </span>
        </div>
        <h3>{video.title}</h3>
        {video.source_url && <a className="small ellipsis" href={video.source_url} target="_blank" rel="noreferrer">{video.source_url}</a>}
        {video.error && <div className="notice notice-bad small">{video.error}</div>}

        <label className="field">
          <span className="small">Caption</span>
          <textarea rows={2} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </label>
        <label className="field">
          <span className="small">Hashtag</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <Notice message={action.message} />

        <div className="row gap wrap">
          {dirty && (
            <button className="btn btn-sm" disabled={action.busy} onClick={() => action.run(() => saveCaption(video, caption, tags), "Đã lưu caption")}>
              Lưu caption
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => action.run(() => navigator.clipboard.writeText(fullCaption), "Đã copy caption + hashtag")}>
            Copy caption
          </button>
          {video.status === "review" && (
            <>
              <button className="btn btn-primary btn-sm" disabled={action.busy}
                onClick={() => action.run(() => approveVideo(video, channel),
                  channel.tiktok_connected_at ? "Đã duyệt — đang gửi lên TikTok" : "Đã duyệt (chưa kết nối TikTok nên chưa đăng)")}>
                Duyệt & đăng
              </button>
              <button className="btn btn-ghost btn-sm" disabled={action.busy} onClick={() => action.run(() => rejectVideo(video))}>Từ chối</button>
            </>
          )}
          {video.status === "approved" && channel.tiktok_connected_at && (
            <button className="btn btn-primary btn-sm" disabled={action.busy} onClick={() => action.run(() => postVideo(video), "Đã gửi lệnh đăng")}>
              Đăng lên TikTok
            </button>
          )}
          {["review", "failed", "rejected", "posted"].includes(video.status) && canRerender && (
            <button className="btn btn-ghost btn-sm" disabled={action.busy} onClick={() => action.run(() => rerenderVideo(video), "Đã xếp hàng render lại")}>
              Render lại
            </button>
          )}
          {["review", "failed", "rejected"].includes(video.status) && (
            <button className="btn btn-ghost btn-sm" disabled={action.busy}
              onClick={() => action.run(() => rewriteScript(video),
                premium ? "Đã gửi lại cho Cowork dựng phim mới" : "Đã gửi lại cho Cowork viết kịch bản mới")}>
              {premium ? "Dựng lại phim" : "Viết lại kịch bản"}
            </button>
          )}
          {!premium && ["waiting_script", "review", "failed", "rejected"].includes(video.status) && (
            <FilmButton label="Làm thành phim cao cấp" disabled={action.busy}
              onConfirm={(film) => action.run(() => makePremiumFilm(video, film), "Đã chuyển — Cowork sẽ dựng phim cao cấp")} />
          )}
          {video.script && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowScript((s) => !s)}>{showScript ? "Ẩn kịch bản" : "Xem kịch bản"}</button>
          )}
          {["failed", "rejected"].includes(video.status) && (
            <button className="btn btn-danger btn-sm" disabled={action.busy}
              onClick={() => confirm("Xóa video này?") && action.run(() => deleteVideo(video))}>
              Xóa
            </button>
          )}
        </div>

        {showScript && video.script && (
          <ol className="script small">
            {video.script.scenes?.map((s: any) => <li key={s.id}><strong>{s.type}</strong> — {s.voiceText}</li>)}
          </ol>
        )}
        {video.status === "posted" && (
          <p className="muted small">Video đã vào hộp thư nháp TikTok — mở app TikTok → Hộp thư → hoàn tất đăng, dán caption đã copy.</p>
        )}
      </div>
    </article>
  );
}
