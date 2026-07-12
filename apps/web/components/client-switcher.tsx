"use client";

import Link from "next/link";
import { Building2, ChevronDown, Plus } from "lucide-react";
import { useClientContext } from "@/components/client-provider";
import { cn } from "@/lib/utils";

export function ClientSwitcher({ className }: { className?: string }) {
  const { clients, activeClientId, activeClient, loading, setActiveClientId } = useClientContext();

  if (loading) {
    return (
      <div className={cn("rounded-md border border-border/70 bg-white px-2 py-2 text-xs text-muted-foreground", className)}>
        Loading clients…
      </div>
    );
  }

  const label = activeClient?.name || clients[0]?.name || "Default client";

  if (clients.length <= 1) {
    return (
      <div className={cn("rounded-md border border-border/70 bg-white px-2.5 py-2", className)}>
        <div className="flex items-center gap-2 text-sm">
          <Building2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate font-medium">{label}</span>
        </div>
        <Link
          href="/settings"
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary underline-offset-2 hover:underline"
        >
          <Plus className="h-3 w-3" />
          Add another client
        </Link>
      </div>
    );
  }

  return (
    <label className={cn("block rounded-md border border-border/70 bg-white px-2.5 py-2", className)}>
      <span className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" />
        Client
      </span>
      <div className="relative min-w-0">
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
