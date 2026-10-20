import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

/**
 * Load data and reload it whenever one of `tables` changes (Supabase Realtime).
 * `deps` re-run the loader (e.g. when the selected channel changes).
 */
export function useLive<T>(loader: () => Promise<T>, tables: string[], deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    try {
      setData(await loaderRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload();
    const ch = supabase.channel(`live-${tables.join("-")}-${Math.random().toString(36).slice(2)}`);
    for (const t of tables) ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => reload());
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, reload };
}

/** Run an async action with a busy flag and a single error/toast message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ text: ok });
    } catch (e) {
      setMessage({ text: (e as Error).message, bad: true });
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, message, setMessage, run };
}
