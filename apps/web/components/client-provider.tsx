"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { clientApi } from "@/lib/api";
import { getActiveClientId, setActiveClientId } from "@/lib/active-client";

export type AtlasClient = {
  id: string;
  name: string;
  slug: string;
  is_default: boolean;
};

type ClientContextValue = {
  clients: AtlasClient[];
  activeClientId: string | null;
  activeClient: AtlasClient | null;
  loading: boolean;
  setActiveClientId: (id: string) => void;
  refresh: () => Promise<void>;
};

const ClientContext = createContext<ClientContextValue | null>(null);

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const [clients, setClients] = useState<AtlasClient[]>([]);
  const [activeClientId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await clientApi<{ clients: AtlasClient[]; default_client_id: string | null }>(
        "/clients"
      );
      setClients(data.clients);
      const stored = getActiveClientId();
      const validStored = stored && data.clients.some((c) => c.id === stored) ? stored : null;
      const next = validStored || data.default_client_id || data.clients[0]?.id || null;
      setActiveId(next);
      if (next) setActiveClientId(next);
    } catch {
      setClients([]);
      setActiveId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setActiveClient = useCallback((id: string) => {
    setActiveId(id);
    setActiveClientId(id);
  }, []);

  const activeClient = useMemo(
    () => clients.find((c) => c.id === activeClientId) || null,
    [clients, activeClientId]
  );

  const value = useMemo(
    () => ({
      clients,
      activeClientId,
      activeClient,
      loading,
      setActiveClientId: setActiveClient,
      refresh,
    }),
    [clients, activeClientId, activeClient, loading, setActiveClient, refresh]
  );

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClientContext() {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error("useClientContext must be used within ClientProvider");
  return ctx;
}
