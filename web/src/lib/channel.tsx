import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, must } from "./supabase";
import type { Channel } from "./types";

interface ChannelCtx {
  channels: Channel[];
  channel: Channel | null;
  select: (id: string) => void;
  reload: () => Promise<void>;
  loading: boolean;
}

const Ctx = createContext<ChannelCtx>(null!);
const STORAGE_KEY = "app-video:channel";

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ChannelProvider({ children }: { children: ReactNode }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(readSaved);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const rows = must(await supabase.from("channels").select("*").order("created_at")) as Channel[];
    setChannels(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode: selection just won't persist */
    }
  };

  const channel = channels.find((c) => c.id === selectedId) ?? channels[0] ?? null;
  return <Ctx.Provider value={{ channels, channel, select, reload, loading }}>{children}</Ctx.Provider>;
}

export const useChannel = () => useContext(Ctx);
