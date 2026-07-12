"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CategorySelect } from "@/components/category-select";
import { clientApi, type Category } from "@/lib/api";

type MerchantAlias = {
  id: string;
  pattern: string;
  match_type: string;
  priority: number;
  source: string;
};

type Merchant = {
  id: string;
  name: string;
  slug: string;
  category_id: string | null;
  category: Category | null;
  is_system: boolean;
  aliases: MerchantAlias[];
};

type CategorizationReport = {
  fixtures: {
    fixture_count: number;
    before_rules_accuracy: number;
    after_rules_accuracy: number;
    merchant_match_rate: number;
    other_before: number;
    other_after: number;
    other_reduction: number;
    other_reduction_pct: number;
  };
  live: {
    transaction_count: number;
    other_count: number;
    other_rate: number;
    merchant_linked_count: number;
    merchant_link_rate: number;
    latest_document_categorization: {
      other_rate_before?: number;
      other_rate_after?: number;
      other_reduction?: number;
      merchants_matched?: number;
    } | null;
  };
};

export default function MerchantsPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<CategorizationReport | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, c, r] = await Promise.all([
        clientApi<Merchant[]>("/merchants"),
        clientApi<Category[]>("/categories"),
        clientApi<CategorizationReport>("/accuracy/categorization"),
      ]);
      // Custom categories first so they're easy to find when assigning a merchant
      const ordered = [...c].sort((a, b) => {
        const ac = a.is_system ? 1 : 0;
        const bc = b.is_system ? 1 : 0;
        if (ac !== bc) return ac - bc;
        return a.name.localeCompare(b.name);
      });
      setMerchants(m);
      setCategories(ordered);
      setReport(r);
      setCategoryId((prev) => {
        if (prev && ordered.some((cat) => cat.id === prev)) return prev;
        const fuel = ordered.find((cat) => cat.slug === "fuel");
        const firstCustom = ordered.find((cat) => !cat.is_system);
        return (fuel || firstCustom || ordered[0])?.id ?? "";
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load merchants");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orderedCategories = useMemo(() => {
    return [...categories].sort((a, b) => {
      const ac = a.is_system ? 1 : 0;
      const bc = b.is_system ? 1 : 0;
      if (ac !== bc) return ac - bc;
      return a.name.localeCompare(b.name);
    });
  }, [categories]);

  const { system, custom } = useMemo(
    () => ({
      system: merchants.filter((m) => m.is_system),
      custom: merchants.filter((m) => !m.is_system),
    }),
    [merchants]
  );

  async function createMerchant(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await clientApi("/merchants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category_id: categoryId || null,
          aliases: aliases
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean),
        }),
      });
      setName("");
      setAliases("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function removeMerchant(id: string) {
    if (!window.confirm("Delete this custom merchant and its aliases?")) return;
    try {
      await clientApi(`/merchants/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const fx = report?.fixtures;
  const live = report?.live;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Merchants</h1>
        <p className="mt-1 text-muted-foreground">
          Normalize bank descriptions like SHELL PAKISTAN LTD / SHELL PUMP LAHORE into one
          merchant (Shell) and a default category (Fuel). Deterministic rules run before AI.
        </p>
      </div>

      {(fx || live) && (
        <Card>
          <CardHeader>
            <CardTitle>Live categorization</CardTitle>
            <CardDescription>
              Other rate on your books. Full fixture measurements live on{" "}
              <Link href="/eval" className="underline underline-offset-2">
                Eval
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Live Other rate</p>
              <p className="font-display text-2xl">
                {live ? Math.round(live.other_rate * 100) : "—"}%
              </p>
              <p className="text-xs text-muted-foreground">
                {live
                  ? `${live.other_count} of ${live.transaction_count} · ${live.merchant_linked_count} merchant-linked`
                  : ""}
              </p>
            </div>
            {fx && (
              <div>
                <p className="text-xs text-muted-foreground">Fixture merchant match</p>
                <p className="font-display text-2xl">
                  {Math.round(fx.merchant_match_rate * 100)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  Measured on labeled description fixtures
                </p>
              </div>
            )}
            {fx && (
              <div>
                <p className="text-xs text-muted-foreground">Fixture category accuracy</p>
                <p className="font-display text-2xl">
                  {Math.round(fx.after_rules_accuracy * 100)}%
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="relative z-10 max-w-2xl overflow-visible">
        <CardHeader>
          <CardTitle>Add merchant</CardTitle>
          <CardDescription>
            Aliases are comma-separated patterns (e.g.{" "}
            <span className="font-medium">shell pakistan, shell pump</span>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createMerchant} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="m-name">Name</Label>
                <Input
                  id="m-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Shell"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Default category</Label>
                <CategorySelect
                  categories={orderedCategories}
                  value={categoryId || undefined}
                  onValueChange={setCategoryId}
                  onCategoriesChange={setCategories}
                  allowCreate
                  placeholder="Choose category"
                />
                <p className="text-[11px] text-muted-foreground">
                  Includes your custom categories. Use “Add custom category…” if you need a new
                  one — or manage them on{" "}
                  <Link href="/categories" className="underline underline-offset-2">
                    Categories
                  </Link>
                  .
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-aliases">Aliases</Label>
              <Input
                id="m-aliases"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                placeholder="shell pakistan, shell pump, shell pos"
              />
            </div>
            <Button type="submit" disabled={saving} className="w-fit">
              {saving ? "Saving…" : "Add merchant"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Your merchants</CardTitle>
          <CardDescription>
            Learned when you click Remember after a category fix. Also manage{" "}
            <Link href="/rules" className="text-primary underline-offset-4 hover:underline">
              learning rules
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {custom.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No custom merchants yet. Correct a category and choose Remember, or add one above.
            </p>
          )}
          {custom.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 py-3 last:border-0"
            >
              <div>
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-muted-foreground">
                  {m.category?.name || "No category"} ·{" "}
                  {m.aliases.map((a) => a.pattern).join(", ") || "no aliases"}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => removeMerchant(m.id)}>
                Delete
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Built-in merchants</CardTitle>
          <CardDescription>
            System aliases (Shell → Fuel, PSO, Hetzner, etc.). Firm-wide; client-specific
            overrides are schema-ready for later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {system.map((m) => (
              <div
                key={m.id}
                className="rounded-md border border-border/60 px-3 py-2 text-sm"
              >
                <p className="font-medium">{m.name}</p>
                <p className="text-xs text-muted-foreground">
                  {m.category?.name || "—"} · {m.aliases.length} aliases
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
