"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type MeResponse } from "@/lib/api";

export default function SettingsPage() {
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">Profile and workspace.</p>
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
