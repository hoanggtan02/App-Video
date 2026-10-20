import { useState, type FormEvent } from "react";
import { supabase, must } from "../lib/supabase";
import { useChannel } from "../lib/channel";
import { useLive, useAction } from "../lib/hooks";
import { createVideoFromStory, createVideoFromUrl, enqueue, skipStory } from "../lib/actions";
import { timeAgo } from "../lib/format";
import { Badge, Empty, Notice, PageHeader } from "../components/ui";
import type { Story, StoryStatus } from "../lib/types";

const TABS: { key: StoryStatus | "all"; label: string }[] = [
  { key: "new", label: "Mới" },
  { key: "selected", label: "Đã chọn" },
  { key: "used", label: "Đã làm video" },
  { key: "skipped", label: "Bỏ qua" },
];

export function Stories() {
  const { channel } = useChannel();
  const [tab, setTab] = useState<StoryStatus | "all">("new");
  const [url, setUrl] = useState("");
  const action = useAction();

  const { data: stories } = useLive(
    async () =>
      must(
        await supabase.from("stories").select("*").eq("channel_id", channel!.id).eq("status", tab)
          .order("found_at", { ascending: false }).order("score", { ascending: false }).limit(60),
      ) as Story[],
    ["stories"],
    [channel?.id, tab],
  );

  function addUrl(e: FormEvent) {
    e.preventDefault();
    action.run(async () => {
      await createVideoFromUrl(channel!.id, url.trim());
      setUrl("");
    }, "Đã thêm — Cowork sẽ viết kịch bản ở lần chạy tới");
  }

  return (
    <>
      <PageHeader
        title="Tin hot"
        subtitle="Tin được chấm điểm theo Google Trends, số báo cùng đưa, độ mới và chủ đề kênh"
        actions={
          <button className="btn btn-primary" disabled={action.busy}
            onClick={() => action.run(() => enqueue(channel!.id, "find_news"), "Đã yêu cầu tìm tin — danh sách tự cập nhật")}>
            Tìm tin ngay
          </button>
        }
      />
      <Notice message={action.message} />

      <form className="card row gap wrap" onSubmit={addUrl}>
        <input className="grow" type="url" placeholder="Dán link bài báo bất kỳ để làm video…" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <button className="btn" disabled={action.busy}>Làm video từ link</button>
      </form>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {stories?.length === 0 && <Empty>Không có tin nào ở mục này.</Empty>}
      <div className="grid cards-grid">
        {stories?.map((s) => (
          <article key={s.id} className="card story">
            {s.image && <img className="thumb" src={s.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
            <div className="story-body">
              <div className="row between">
                <Badge tone="info">{s.score} điểm</Badge>
                <span className="muted small">{s.source} · {timeAgo(s.published_at ?? s.found_at)}</span>
              </div>
              <h3><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></h3>
              {s.trend_keyword && <div className="small">🔥 Google Trends: <strong>{s.trend_keyword}</strong></div>}
              {s.also_covered_by.length > 0 && <div className="muted small">Cũng có trên: {s.also_covered_by.join(", ")}</div>}
              <details className="small muted">
                <summary>Vì sao được chọn</summary>
                <ul>{s.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </details>
              {s.status === "new" && (
                <div className="row gap">
                  <button className="btn btn-primary btn-sm" disabled={action.busy}
                    onClick={() => action.run(() => createVideoFromStory(s), "Đã chọn — Cowork sẽ viết kịch bản")}>
                    Tạo video
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={action.busy} onClick={() => action.run(() => skipStory(s))}>
                    Bỏ qua
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
