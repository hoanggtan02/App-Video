import { useEffect, useState } from "react";
import { HashRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase, configMissing } from "./lib/supabase";
import { ChannelProvider, useChannel } from "./lib/channel";
import { finishTiktokConnect } from "./lib/actions";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Stories } from "./pages/Stories";
import { Videos } from "./pages/Videos";
import { Posts } from "./pages/Posts";
import { Stats } from "./pages/Stats";
import { Settings } from "./pages/Settings";
import { NewChannel } from "./pages/NewChannel";

const NAV = [
  { to: "/", label: "Tổng quan", icon: "◧" },
  { to: "/stories", label: "Tin hot", icon: "✦" },
  { to: "/videos", label: "Video", icon: "▶" },
  { to: "/posts", label: "Đăng bài", icon: "↑" },
  { to: "/stats", label: "Thống kê", icon: "▤" },
  { to: "/settings", label: "Cài đặt", icon: "⚙" },
];

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (configMissing) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h1>Chưa cấu hình Supabase</h1>
          <p className="muted">Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY khi build. Xem README.</p>
        </div>
      </div>
    );
  }
  if (session === undefined) return <div className="center-screen muted">Đang tải…</div>;
  if (!session) return <Login />;

  return (
    <ChannelProvider>
      <TiktokCallback />
      <HashRouter>
        <Shell email={session.user.email ?? ""} />
      </HashRouter>
    </ChannelProvider>
  );
}

/** TikTok redirects back to the site root with ?code=&state= */
function TiktokCallback() {
  const { reload } = useChannel();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const code = p.get("code");
    const state = p.get("state");
    const err = p.get("error_description") ?? p.get("error");
    if (!code && !err) return;
    // Drop ?code=&state= from the address bar, then let the hash router show Settings
    window.history.replaceState(null, "", window.location.pathname);
    window.location.hash = "/settings";
    if (err) {
      setMsg(`TikTok báo lỗi: ${err}`);
      return;
    }
    finishTiktokConnect(code!, state ?? "")
      .then((r) => {
        setMsg(`Đã kết nối TikTok${r?.displayName ? `: ${r.displayName}` : ""}`);
        reload();
      })
      .catch((e) => setMsg(`Kết nối TikTok thất bại: ${(e as Error).message}`));
  }, [reload]);

  if (!msg) return null;
  return (
    <div className="toast" onClick={() => setMsg(null)}>
      {msg}
    </div>
  );
}

function Shell({ email }: { email: string }) {
  const { channels, channel, select, loading } = useChannel();
  const [navOpen, setNavOpen] = useState(false);

  if (loading) return <div className="center-screen muted">Đang tải kênh…</div>;
  if (!channel) return <NewChannel first />;

  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="logo">▶</span> App Video
        </div>
        <label className="field">
          <span className="muted small">Kênh</span>
          <select
            value={channel.id}
            onChange={(e) => (e.target.value === "__new" ? (window.location.hash = "#/new-channel") : select(e.target.value))}
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value="__new">+ Thêm kênh…</option>
          </select>
        </label>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} onClick={() => setNavOpen(false)}>
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="muted small ellipsis" title={email}>{email}</div>
          <button className="btn btn-ghost btn-sm" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="btn btn-ghost" onClick={() => setNavOpen((o) => !o)} aria-label="Menu">☰</button>
          <strong>{channel.name}</strong>
        </div>
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/stories" element={<Stories />} />
            <Route path="/videos" element={<Videos />} />
            <Route path="/posts" element={<Posts />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/new-channel" element={<NewChannel />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
