const STORAGE_KEY = "atlas-active-client-id";

export function getActiveClientId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function setActiveClientId(clientId: string | null) {
  if (typeof window === "undefined") return;
  if (clientId) localStorage.setItem(STORAGE_KEY, clientId);
  else localStorage.removeItem(STORAGE_KEY);
}

/** Append active client filter for list endpoints only */
export function clientListPath(path: string, clientId?: string | null): string {
  const id = clientId ?? getActiveClientId();
  if (!id) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}client_id=${encodeURIComponent(id)}`;
}
