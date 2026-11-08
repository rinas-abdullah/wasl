"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Subscribes to /api/stream (Server-Sent Events). Each message names the topics
 * that changed; matching TanStack Query caches are invalidated so every screen
 * re-reads the same server state (dashboard, tables, twin and reports stay consistent).
 */
export function useLiveUpdates() {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      es = new EventSource("/api/stream");
      es.addEventListener("hello", () => setConnected(true));
      es.addEventListener("change", (ev) => {
        const msg = JSON.parse((ev as MessageEvent).data) as { topics: string[]; at: string };
        setLastEventAt(msg.at);
        if (msg.topics.includes("*")) {
          qc.invalidateQueries();
          return;
        }
        qc.invalidateQueries({ predicate: (q) => msg.topics.includes(String(q.queryKey[0])) });
      });
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [qc]);
  return { connected, lastEventAt };
}
