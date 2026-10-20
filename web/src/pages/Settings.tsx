import { useEffect, useState, type FormEvent } from "react";
import { supabase, must } from "../lib/supabase";
import { useChannel } from "../lib/channel";
import { useLive, useAction } from "../lib/hooks";
import { connectTiktok, disconnectTiktok, enqueue } from "../lib/actions";
import { dateTime, JOB_STATUS } from "../lib/format";
import { Badge, Empty, Notice, PageHeader } from "../components/ui";
import type { ChannelSettings, Feed, Job } from "../lib/types";

const VOICES = [
  { id: "vi-VN-NamMinhNeural", label: "Nam Minh (nam)" },
  { id: "vi-VN-HoaiMyNeural", label: "Hoài My (nữ)" },
];

const lines = (s: string) => s.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);

function feedsToText(feeds?: Feed[]) {
  return (feeds ?? []).map((f) => [f.name, f.url, f.weight ?? 1].join(" | ")).join("\n");
}

function textToFeeds(text: string): Feed[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, url, weight] = l.split("|").map((x) => x.trim());
    if (!url || !/^https?:\/\//.test(url)) throw new Error(`Dòng nguồn tin không hợp lệ: "${l}" (dạng: Tên | URL | trọng số)`);
    return { name, url, weight: weight ? Number(weight) : 1 };
  });
}

export function Settings() {
  const { channel, reload } = useChannel();
  const s = channel!.settings ?? {};
  const action = useAction();
  const tiktok = useAction();

  const [name, setName] = useState(channel!.name);
  const [handle, setHandle] = useState(channel!.handle ?? "");
  const [times, setTimes] = useState((s.scheduleTimes ?? ["07:00"]).join(", "));
  const [perDay, setPerDay] = useState(s.videosPerDay ?? 1);
  const [autoPost, setAutoPost] = useState(s.autoPost ?? false);
  const [voice, setVoice] = useState(s.voice ?? VOICES[0].id);
  const [rate, setRate] = useState(s.rate ?? "+0%");
  const [theme, setTheme] = useState(s.theme ?? "dark-neon");
  const [prefer, setPrefer] = useState((s.preferKeywords ?? []).join(", "));
  const [block, setBlock] = useState((s.blockKeywords ?? []).join(", "));
  const [feeds, setFeeds] = useState(feedsToText(s.feeds));

  // Reset the form when switching channel
  useEffect(() => {
    const s = channel!.settings ?? {};
    setName(channel!.name);
    setHandle(channel!.handle ?? "");
    setTimes((s.scheduleTimes ?? ["07:00"]).join(", "));
    setPerDay(s.videosPerDay ?? 1);
    setAutoPost(s.autoPost ?? false);
    setVoice(s.voice ?? VOICES[0].id);
    setRate(s.rate ?? "+0%");
    setTheme(s.theme ?? "dark-neon");
    setPrefer((s.preferKeywords ?? []).join(", "));
    setBlock((s.blockKeywords ?? []).join(", "));
    setFeeds(feedsToText(s.feeds));
  }, [channel?.id]);

  function save(e: FormEvent) {
    e.preventDefault();
    action.run(async () => {
      const scheduleTimes = lines(times);
      const bad = scheduleTimes.find((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t));
      if (bad) throw new Error(`Giờ "${bad}" không hợp lệ (dạng HH:MM, vd 07:00)`);
      const settings: ChannelSettings = {
        ...s,
        scheduleTimes,
        videosPerDay: Math.max(0, Math.min(5, perDay)),
        autoPost,
        voice,
        rate,
        theme,
        preferKeywords: prefer.trim() ? lines(prefer) : undefined,
        blockKeywords: block.trim() ? lines(block) : undefined,
        feeds: feeds.trim() ? textToFeeds(feeds) : undefined,
        timezone: s.timezone ?? "Asia/Ho_Chi_Minh",
      };
      must(await supabase.from("channels").update({
        name: name.trim(),
        handle: handle.trim() ? `@${handle.trim().replace(/^@/, "")}` : null,
        settings,
      }).eq("id", channel!.id));
      await reload();
    }, "Đã lưu cài đặt");
  }

  return (
    <>
      <PageHeader title="Cài đặt kênh" subtitle={channel!.name} />

      <section className="card">
        <h2>TikTok</h2>
        {channel!.tiktok_connected_at ? (
          <div className="row gap wrap">
            {channel!.tiktok_avatar_url && <img className="avatar" src={channel!.tiktok_avatar_url} alt="" referrerPolicy="no-referrer" />}
            <div className="grow">
              <strong>{channel!.tiktok_display_name ?? "Đã kết nối"}</strong>
              <div className="muted small">Kết nối lúc {dateTime(channel!.tiktok_connected_at)}</div>
            </div>
            <button className="btn btn-ghost" disabled={tiktok.busy}
              onClick={() => confirm("Ngắt kết nối TikTok?") && tiktok.run(async () => { await disconnectTiktok(channel!.id); await reload(); }, "Đã ngắt kết nối")}>
              Ngắt kết nối
            </button>
          </div>
        ) : (
          <div className="row gap wrap">
            <p className="grow muted">Kết nối để đăng video vào hộp thư nháp TikTok và lấy thống kê.</p>
            <button className="btn btn-primary" disabled={tiktok.busy} onClick={() => tiktok.run(() => connectTiktok(channel!.id))}>
              Kết nối TikTok
            </button>
          </div>
        )}
        <Notice message={tiktok.message} />
      </section>

      <form className="card form" onSubmit={save}>
        <h2>Kênh</h2>
        <div className="grid two">
          <label className="field"><span>Tên kênh (hiện ở cuối video)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={30} />
          </label>
          <label className="field"><span>@handle</span>
            <input value={handle} onChange={(e) => setHandle(e.target.value)} />
          </label>
        </div>

        <h2>Lịch tự động</h2>
        <div className="grid two">
          <label className="field"><span>Giờ chạy (cách nhau dấu phẩy)</span>
            <input value={times} onChange={(e) => setTimes(e.target.value)} placeholder="07:00, 17:00" />
          </label>
          <label className="field"><span>Số video mỗi lần chạy (0 = chỉ tìm tin)</span>
            <input type="number" min={0} max={5} value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} />
          <span>Tự đăng lên TikTok sau khi render (không cần bấm duyệt)</span>
        </label>
        <p className="muted small">
          Mỗi giờ chạy: worker tìm tin hot → chọn tin tốt nhất → Cowork viết kịch bản (cần lịch Cowork chạy sau giờ này ~15 phút) → worker render.
        </p>

        <h2>Giọng đọc & giao diện video</h2>
        <div className="grid three">
          <label className="field"><span>Giọng</span>
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Tốc độ đọc</span>
            <select value={rate} onChange={(e) => setRate(e.target.value)}>
              {["-10%", "+0%", "+10%", "+20%"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="field"><span>Giao diện</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value as "dark-neon" | "light-pro")}>
              <option value="dark-neon">Tối neon</option>
              <option value="light-pro">Sáng chuyên nghiệp</option>
            </select>
          </label>
        </div>

        <h2>Nguồn tin & chủ đề</h2>
        <p className="muted small">Để trống = dùng mặc định (8 báo lớn + Google Trends, chủ đề công nghệ).</p>
        <label className="field"><span>Từ khóa ưu tiên (chủ đề kênh)</span>
          <textarea rows={2} value={prefer} onChange={(e) => setPrefer(e.target.value)} placeholder="AI, iPhone, công nghệ, xe điện" />
        </label>
        <label className="field"><span>Từ khóa cấm</span>
          <textarea rows={2} value={block} onChange={(e) => setBlock(e.target.value)} placeholder="tử vong, xổ số" />
        </label>
        <label className="field"><span>Nguồn RSS (mỗi dòng: Tên | URL | trọng số)</span>
          <textarea rows={4} className="mono" value={feeds} onChange={(e) => setFeeds(e.target.value)}
            placeholder="VnExpress nổi bật | https://vnexpress.net/rss/tin-noi-bat.rss | 1.2" />
        </label>

        <Notice message={action.message} />
        <div><button className="btn btn-primary" disabled={action.busy}>Lưu cài đặt</button></div>
      </form>

      <Backups />
    </>
  );
}

function Backups() {
  const action = useAction();
  const { data: jobs } = useLive(
    async () => must(await supabase.from("jobs").select("*").eq("type", "backup").order("created_at", { ascending: false }).limit(10)) as Job[],
    ["jobs"],
    [],
  );

  return (
    <section className="card">
      <div className="row between wrap gap">
        <h2>Sao lưu</h2>
        <button className="btn" disabled={action.busy} onClick={() => action.run(() => enqueue(null, "backup"), "Đã yêu cầu sao lưu")}>
          Sao lưu ngay
        </button>
      </div>
      <p className="muted small">
        Tự động mỗi đêm, lưu file zip trên máy render (thư mục <code>App-Video\backups</code>, giữ 30 bản).
        Khôi phục: <code>npm run worker -- restore &lt;file.zip&gt;</code>.
      </p>
      <Notice message={action.message} />
      {jobs?.length ? (
        <table className="table">
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="nowrap">{dateTime(j.created_at)}</td>
                <td><Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge></td>
                <td className="muted small">{j.error ?? (j.result ? `${j.result.sizeMB} MB — ${j.result.file}` : "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>Chưa có bản sao lưu.</Empty>
      )}
    </section>
  );
}
