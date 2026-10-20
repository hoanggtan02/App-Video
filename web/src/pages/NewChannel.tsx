import { useState, type FormEvent } from "react";
import { supabase, must } from "../lib/supabase";
import { useChannel } from "../lib/channel";
import type { Channel } from "../lib/types";

export function NewChannel({ first = false }: { first?: boolean }) {
  const { reload, select } = useChannel();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const row = must(
        await supabase.from("channels").insert({
          name: name.trim(),
          handle: handle.trim() ? `@${handle.trim().replace(/^@/, "")}` : null,
          settings: { scheduleTimes: ["07:00"], videosPerDay: 1, autoPost: false, timezone: "Asia/Ho_Chi_Minh" },
        }).select().single(),
      ) as Channel;
      await reload();
      select(row.id);
      window.location.hash = "/settings";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form className="card narrow" onSubmit={submit}>
      <h1>{first ? "Tạo kênh đầu tiên" : "Thêm kênh"}</h1>
      <p className="muted">Mỗi kênh có nguồn tin, lịch chạy và tài khoản TikTok riêng.</p>
      <label className="field">
        <span>Tên kênh (hiện trong video)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Tin Công Nghệ 24h" required maxLength={30} />
      </label>
      <label className="field">
        <span>TikTok @handle</span>
        <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="tincongnghe24h" />
      </label>
      {error && <div className="notice notice-bad">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Đang tạo…" : "Tạo kênh"}</button>
    </form>
  );

  return first ? <div className="center-screen">{form}</div> : <div className="content-narrow">{form}</div>;
}
