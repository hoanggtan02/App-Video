import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase";
import { useChannel } from "../lib/channel";
import { useLive, useAction } from "../lib/hooks";
import { enqueue } from "../lib/actions";
import { dateTime, num, timeAgo } from "../lib/format";
import { Empty, Notice, PageHeader, Stat } from "../components/ui";
import type { StatsDay, TiktokVideo } from "../lib/types";

export function Stats() {
  const { channel } = useChannel();
  const action = useAction();
  const { data } = useLive(
    async () => {
      const [days, vids] = await Promise.all([
        supabase.from("stats_daily").select("*").eq("channel_id", channel!.id).order("day").limit(60),
        supabase.from("tiktok_videos").select("*").eq("channel_id", channel!.id).order("create_time", { ascending: false }).limit(50),
      ]);
      return { days: must(days) as StatsDay[], videos: must(vids) as (TiktokVideo & { fetched_at: string })[] };
    },
    ["jobs"],
    [channel?.id],
  );

  if (!channel!.tiktok_connected_at) {
    return (
      <>
        <PageHeader title="Thống kê" />
        <Empty>Cần <Link to="/settings">kết nối TikTok</Link> để lấy lượt xem, like, bình luận.</Empty>
      </>
    );
  }

  const days = data?.days ?? [];
  const last = days[days.length - 1];
  const prev = days[days.length - 2];
  const delta = (k: keyof StatsDay) => (last && prev ? Number(last[k]) - Number(prev[k]) : 0);

  return (
    <>
      <PageHeader
        title="Thống kê"
        subtitle={data?.videos[0] ? `Cập nhật ${timeAgo(data.videos[0].fetched_at)}` : "Tự cập nhật theo lịch chạy của kênh"}
        actions={
          <button className="btn" disabled={action.busy}
            onClick={() => action.run(() => enqueue(channel!.id, "fetch_stats"), "Đã yêu cầu cập nhật số liệu")}>
            Cập nhật ngay
          </button>
        }
      />
      <Notice message={action.message} />

      <div className="grid stats-grid">
        <Stat label="Tổng lượt xem" value={num(last?.views)} hint={prev ? `+${num(delta("views"))} so với lần trước` : undefined} />
        <Stat label="Lượt thích" value={num(last?.likes)} hint={prev ? `+${num(delta("likes"))}` : undefined} />
        <Stat label="Bình luận" value={num(last?.comments)} />
        <Stat label="Chia sẻ" value={num(last?.shares)} />
      </div>

      <section className="card">
        <h2>Lượt xem theo ngày</h2>
        {days.length > 1 ? <LineChart points={days.map((d) => ({ x: d.day, y: d.views }))} /> : <Empty>Cần ít nhất 2 ngày số liệu.</Empty>}
      </section>

      <section className="card">
        <h2>Video trên TikTok</h2>
        {data?.videos.length ? (
          <table className="table">
            <thead>
              <tr><th>Video</th><th className="num">Xem</th><th className="num">Thích</th><th className="num">BL</th><th className="num">Share</th></tr>
            </thead>
            <tbody>
              {data.videos.map((v) => (
                <tr key={v.tiktok_id}>
                  <td>
                    <a href={v.share_url ?? "#"} target="_blank" rel="noreferrer">{v.title || "(không tiêu đề)"}</a>
                    <div className="muted small">{dateTime(v.create_time)}</div>
                  </td>
                  <td className="num">{num(v.view_count)}</td>
                  <td className="num">{num(v.like_count)}</td>
                  <td className="num">{num(v.comment_count)}</td>
                  <td className="num">{num(v.share_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>Chưa có số liệu — bấm "Cập nhật ngay".</Empty>
        )}
      </section>
    </>
  );
}

function LineChart({ points }: { points: { x: string; y: number }[] }) {
  const W = 600, H = 180, P = 28;
  const max = Math.max(1, ...points.map((p) => p.y));
  const sx = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, points.length - 1);
  const sy = (y: number) => H - P - (y / max) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Biểu đồ lượt xem">
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} className="chart-axis" />
      <path d={d} className="chart-line" />
      {points.map((p, i) => (
        <circle key={p.x} cx={sx(i)} cy={sy(p.y)} r={3} className="chart-dot">
          <title>{`${p.x}: ${p.y.toLocaleString("vi-VN")} lượt xem`}</title>
        </circle>
      ))}
      <text x={P} y={H - 8} className="chart-label">{points[0].x}</text>
      <text x={W - P} y={H - 8} textAnchor="end" className="chart-label">{points[points.length - 1].x}</text>
      <text x={P} y={P - 10} className="chart-label">{num(max)}</text>
    </svg>
  );
}
