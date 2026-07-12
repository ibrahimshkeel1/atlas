"use client";

import { Building2, ChevronDown } from "lucide-react";
import { useClientContext } from "@/components/client-provider";
import { cn } from "@/lib/utils";

export function ClientSwitcher({ className }: { className?: string }) {
  const { clients, activeClientId, activeClient, loading, setActiveClientId } = useClientContext();

  if (loading) {
    return (
      <div className={cn("text-xs text-muted-foreground", className)}>Loading clients…</div>
    );
  }

  if (clients.length <= 1) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{activeClient?.name || "Default client"}</span>
      </div>
    );
  }

  return (
    <label className={cn("flex min-w-0 items-center gap-2 text-xs", className)}>
      <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-muted-foreground">Client</span>
      <div className="relative min-w-0 flex-1">
        <select
          value={activeClientId || ""}
          onChange={(e) => setActiveClientId(e.target.value)}
          className="w-full min-w-0 appearance-none truncate rounded-md border border-border/80 bg-white py-1.5 pl-2 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.is_default ? " (default)" : ""}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
    </label>
  );
}
