"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clientApi, type MeResponse } from "@/lib/api";
import { useClientContext } from "@/components/client-provider";

export default function SettingsPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const { clients, activeClientId, refresh, setActiveClientId } = useClientContext();
  const [newClientName, setNewClientName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const addClient = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newClientName.trim()) return;
      setSaving(true);
      setError("");
      try {
        const created = await clientApi<{ id: string; name: string }>("/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newClientName.trim() }),
        });
        setNewClientName("");
        await refresh();
        setActiveClientId(created.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create client");
      } finally {
        setSaving(false);
      }
    },
    [newClientName, refresh, setActiveClientId]
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">Profile, clients, and workspace.</p>
      </div>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your Atlas account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Name" value={me?.user.full_name} />
          <Row label="Email" value={me?.user.email} />
          <Row label="Organization" value={me?.organization.name} />
          <Row label="Workspace slug" value={me?.organization.slug} />
        </CardContent>
      </Card>

      <Card className="max-w-xl overflow-visible">
        <CardHeader>
          <CardTitle>Clients</CardTitle>
          <CardDescription>
            Switch clients from the sidebar. Uploads and lists filter to the active client.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2 text-sm">
            {clients.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.is_default ? "Default workspace client" : "Additional client"}
                  </p>
                </div>
                {c.id === activeClientId ? (
                  <span className="shrink-0 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase text-emerald-800">
                    Active
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={() => setActiveClientId(c.id)}>
                    Switch
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <form onSubmit={addClient} className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-4">
            <div className="min-w-[200px] flex-1 space-y-1">
              <Label htmlFor="client-name">New client</Label>
              <Input
                id="client-name"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="e.g. Acme Ltd"
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add client"}
            </Button>
          </form>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Internal evaluation</CardTitle>
          <CardDescription>
            Parser and categorization readiness lives on the Eval dashboard — measured from test
            fixtures only, not shown to customers here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/eval"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Open extraction evaluation →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || "—"}</span>
    </div>
  );
}
