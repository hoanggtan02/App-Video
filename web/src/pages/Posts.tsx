import { Link } from "react-router-dom";
import { supabase, must } from "../lib/supabase";
import { useChannel } from "../lib/channel";
import { useLive } from "../lib/hooks";
import { dateTime } from "../lib/format";
import { Badge, Empty, PageHeader } from "../components/ui";
import type { Post } from "../lib/types";

const STATUS: Record<Post["status"], { label: string; tone: string }> = {
  processing: { label: "Đang xử lý", tone: "info" },
  sent_to_inbox: { label: "Trong hộp thư nháp", tone: "warn" },
  published: { label: "Đã đăng", tone: "ok" },
  failed: { label: "Lỗi", tone: "bad" },
};

export function Posts() {
  const { channel } = useChannel();
  const { data: posts } = useLive(
    async () =>
      must(
        await supabase.from("posts").select("*, video:videos(title)").eq("channel_id", channel!.id)
          .order("created_at", { ascending: false }).limit(100),
      ) as Post[],
    ["posts"],
    [channel?.id],
  );

  return (
    <>
      <PageHeader
        title="Đăng bài"
        subtitle={channel!.tiktok_connected_at
          ? `Tài khoản: ${channel!.tiktok_display_name ?? "đã kết nối"} · chế độ: gửi vào hộp thư nháp TikTok`
          : <>Chưa kết nối TikTok — <Link to="/settings">kết nối ngay</Link></>}
      />
      <div className="notice">
        Video được đưa vào <strong>hộp thư nháp</strong> của app TikTok. Mở app → thông báo "Hộp thư" → chỉnh caption (đã copy ở mục Video),
        bật nhãn <em>Nội dung do AI tạo</em> → Đăng.
      </div>
      {posts?.length === 0 && <Empty>Chưa đăng video nào.</Empty>}
      {!!posts?.length && (
        <div className="card">
          <table className="table">
            <thead>
              <tr><th>Video</th><th>Trạng thái</th><th>Thời gian</th></tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.video?.title ?? "—"}
                    {p.error && <div className="small bad">{p.error}</div>}
                  </td>
                  <td><Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge></td>
                  <td className="muted small nowrap">{dateTime(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
