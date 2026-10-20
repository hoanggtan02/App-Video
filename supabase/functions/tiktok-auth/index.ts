// Edge Function: connect a channel to a TikTok account (OAuth, Login Kit for Web).
//
// POST { action: "start", channelId }          → { url }   (open in browser)
// POST { action: "callback", code, state }     → { ok, displayName }
// POST { action: "disconnect", channelId }     → { ok }
//
// Secrets (Dashboard → Edge Functions → Secrets):
//   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI, TOKEN_ENC_KEY
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { encryptToken } from "../_shared/crypto.ts";

const SCOPES = "user.info.basic,video.upload,video.list";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    // Identify the caller from their Supabase session
    const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Chưa đăng nhập" }, 401);

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const body = await req.json();

    const ownsChannel = async (channelId: string) => {
      const { data } = await admin.from("channels").select("id").eq("id", channelId).eq("owner_id", user.id).maybeSingle();
      return !!data;
    };

    if (body.action === "start") {
      if (!(await ownsChannel(body.channelId))) return json({ error: "Không có quyền với kênh này" }, 403);
      const state = crypto.randomUUID();
      await admin.from("oauth_states").insert({ state, channel_id: body.channelId, user_id: user.id });
      const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
      url.searchParams.set("client_key", env("TIKTOK_CLIENT_KEY"));
      url.searchParams.set("scope", SCOPES);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", env("TIKTOK_REDIRECT_URI"));
      url.searchParams.set("state", state);
      return json({ url: url.toString() });
    }

    if (body.action === "callback") {
      const { data: st } = await admin.from("oauth_states").select("*").eq("state", body.state).maybeSingle();
      if (!st || st.user_id !== user.id) return json({ error: "State không hợp lệ, hãy kết nối lại" }, 400);
      await admin.from("oauth_states").delete().eq("state", body.state);
      if (Date.now() - new Date(st.created_at).getTime() > 15 * 60_000) return json({ error: "Phiên kết nối đã hết hạn" }, 400);

      const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: env("TIKTOK_CLIENT_KEY"),
          client_secret: env("TIKTOK_CLIENT_SECRET"),
          code: body.code,
          grant_type: "authorization_code",
          redirect_uri: env("TIKTOK_REDIRECT_URI"),
        }),
      });
      const tok = await tokenRes.json();
      if (!tok.access_token) return json({ error: `TikTok từ chối: ${tok.error_description ?? tok.error ?? tokenRes.status}` }, 400);

      const key = env("TOKEN_ENC_KEY");
      const now = Date.now();
      await admin.from("tiktok_tokens").upsert({
        channel_id: st.channel_id,
        open_id: tok.open_id,
        scope: tok.scope,
        access_token_enc: await encryptToken(tok.access_token, key),
        refresh_token_enc: await encryptToken(tok.refresh_token, key),
        expires_at: new Date(now + tok.expires_in * 1000).toISOString(),
        refresh_expires_at: new Date(now + tok.refresh_expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Public profile for display in the UI
      const infoRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      const info = (await infoRes.json())?.data?.user ?? {};
      await admin.from("channels").update({
        tiktok_display_name: info.display_name ?? null,
        tiktok_avatar_url: info.avatar_url ?? null,
        tiktok_connected_at: new Date().toISOString(),
      }).eq("id", st.channel_id);

      return json({ ok: true, channelId: st.channel_id, displayName: info.display_name ?? null });
    }

    if (body.action === "disconnect") {
      if (!(await ownsChannel(body.channelId))) return json({ error: "Không có quyền với kênh này" }, 403);
      await admin.from("tiktok_tokens").delete().eq("channel_id", body.channelId);
      await admin.from("channels").update({
        tiktok_display_name: null, tiktok_avatar_url: null, tiktok_connected_at: null,
      }).eq("id", body.channelId);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
