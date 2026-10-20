import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase";
import { useChannel } from "../lib/channel";
import { useLive, useAction } from "../lib/hooks";
import { enqueue } from "../lib/actions";
import { JOB_LABEL, JOB_STATUS, timeAgo, VIDEO_STATUS } from "../lib/format";
import { Badge, Notice, PageHeader, Stat, Empty } from "../components/ui";
import type { Heartbeat, Job, Video } from "../lib/types";

const OFFLINE_AFTER_MS = 3 * 60_000;

export function Dashboard() {
  const { channel } = useChannel();
  const action = useAction();

  const { data } = useLive(
    async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const [videos, jobs, hb] = await Promise.all([
        supabase.from("videos").select("id,title,status,created_at").eq("channel_id", channel!.id).gte("created_at", since),
        supabase.from("jobs").select("*").or(`channel_id.eq.${channel!.id},channel_id.is.null`).order("created_at", { ascending: false }).limit(12),
        supabase.from("worker_heartbeat").select("*").order("last_seen", { ascending: false }).limit(1),
      ]);
      return {
        videos: must(videos) as Pick<Video, "id" | "title" | "status" | "created_at">[],
        jobs: must(jobs) as Job[],
        worker: (must(hb) as Heartbeat[])[0] ?? null,
      };
    },
    ["videos", "jobs"],
    [channel?.id],
  );

  const videos = data?.videos ?? [];
  const today = new Date().toDateString();
  const count = (pred: (v: (typeof videos)[number]) => boolean) => videos.filter(pred).length;
  const online = data?.worker && Date.now() - new Date(data.worker.last_seen).getTime() < OFFLINE_AFTER_MS;

  return (
    <>
      <PageHeader
        title="Tổng quan"
        subtitle={channel!.name}
        actions={
          <button className="btn btn-primary" disabled={action.busy}
            onClick={() => action.run(() => enqueue(channel!.id, "find_news"), "Đã yêu cầu tìm tin — xem mục Tin hot sau ít phút")}>
            Tìm tin ngay
          </button>
        }
      />
      <Notice message={action.message} />

      <div className="grid stats-grid">
        <Stat label="Video hôm nay" value={count((v) => new Date(v.created_at).toDateString() === today)} />
        <Stat label="Chờ duyệt" value={<Link to="/videos?tab=review">{count((v) => v.status === "review")}</Link>} />
        <Stat label="Đã đăng (7 ngày)" value={count((v) => v.status === "posted")} />
        <Stat
          label="Worker (máy render)"
          value={<Badge tone={online ? "ok" : "bad"}>{online ? "Đang chạy" : "Tắt"}</Badge>}
          hint={data?.worker ? `${data.worker.info?.current ?? "rảnh"} · ${timeAgo(data.worker.last_seen)}` : "chưa từng kết nối"}
        />
        <Stat
          label="TikTok"
          value={<Badge tone={channel!.tiktok_connected_at ? "ok" : "warn"}>{channel!.tiktok_connected_at ? "Đã kết nối" : "Chưa kết nối"}</Badge>}
          hint={channel!.tiktok_display_name ?? <Link to="/settings">Kết nối trong Cài đặt</Link>}
        />
      </div>

      {!online && (
        <div className="notice notice-bad">
          Worker đang tắt: tin, render và đăng bài sẽ nằm chờ. Trên máy render chạy <code>npm run worker</code> trong thư mục <code>auto-video-gen</code>.
        </div>
      )}

      <section className="card">
        <h2>Hoạt động gần đây</h2>
        {data?.jobs.length ? (
          <table className="table">
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.id}>
                  <td>{JOB_LABEL[j.type]}</td>
                  <td><Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge></td>
                  <td className="muted small">{j.error ?? summarize(j)}</td>
                  <td className="muted small nowrap">{timeAgo(j.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>Chưa có hoạt động nào.</Empty>
        )}
      </section>

      <section className="card">
        <h2>Video 7 ngày qua</h2>
        {videos.length ? (
          <ul className="list">
            {[...videos].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8).map((v) => (
              <li key={v.id} className="row between">
                <span className="ellipsis">{v.title}</span>
                <Badge tone={VIDEO_STATUS[v.status].tone}>{VIDEO_STATUS[v.status].label}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Chưa có video. Vào <Link to="/stories">Tin hot</Link> để chọn tin.</Empty>
        )}
      </section>
    </>
  );
}

function summarize(j: Job): string {
  const r = j.result;
  if (!r) return j.payload?.slot ? `lịch ${j.payload.slot}` : "";
  if (j.type === "find_news") return `${r.found} tin mới${r.selected?.length ? `, chọn ${r.selected.length}` : ""}`;
  if (j.type === "render") return `${Math.round(r.durationSec)}s · ${r.sizeMB} MB`;
  if (j.type === "backup") return `${r.sizeMB} MB`;
  if (j.type === "fetch_stats") return `${r.videos} video · ${r.views} lượt xem`;
  if (j.type === "post") return r.status === "SEND_TO_USER_INBOX" ? "đã gửi vào hộp thư TikTok" : r.status;
  return "";
}
