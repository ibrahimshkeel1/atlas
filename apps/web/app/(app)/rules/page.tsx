"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CategorySelect } from "@/components/category-select";
import { clientApi, type Category, type CategoryRule } from "@/lib/api";

export default function RulesPage() {
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        clientApi<CategoryRule[]>("/rules"),
        clientApi<Category[]>("/categories"),
      ]);
      setRules(r);
      setCategories(c);
      if (!categoryId && c[0]) setCategoryId(c[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rules");
    }
  }, [categoryId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    if (!pattern.trim() || !categoryId) return;
    setSaving(true);
    setError("");
    try {
      await clientApi("/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern: pattern.trim(),
          category_id: categoryId,
          match_type: "contains",
          priority: 10,
        }),
      });
      setPattern("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function changeCategory(ruleId: string, nextCategoryId: string) {
    await clientApi(`/rules/${ruleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: nextCategoryId }),
    });
    load();
  }

  async function removeRule(ruleId: string) {
    if (!window.confirm("Delete this learning rule?")) return;
    await fetch(`/api/proxy/rules/${ruleId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Learning rules</h1>
        <p className="mt-1 text-muted-foreground">
          When you fix a category, Atlas stores a merchant rule. Manage them here.
          Need a new bucket?{" "}
          <Link href="/categories" className="text-primary underline-offset-4 hover:underline">
            Add a custom category
          </Link>
          .
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Add rule</CardTitle>
          <CardDescription>
            Example: pattern <span className="font-medium">shell</span> → Fuel
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createRule} className="grid gap-3 sm:grid-cols-[1fr_220px_auto]">
            <div className="space-y-2">
              <Label htmlFor="pattern">Merchant pattern</Label>
              <Input
                id="pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="shell pakistan"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <CategorySelect
                categories={categories}
                value={categoryId || undefined}
                onValueChange={setCategoryId}
                onCategoriesChange={setCategories}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle>Active rules</CardTitle>
          <CardDescription className="max-w-none break-words">
            <span className="block sm:inline">Applied before AI/heuristic categories.</span>{" "}
            <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1 sm:mt-0 sm:inline-flex">
              <Link
                href="/transactions?needs_review=true"
                className="text-primary underline-offset-4 hover:underline"
              >
                Review queue
              </Link>
              <span className="hidden text-muted-foreground sm:inline">·</span>
              <Link href="/documents" className="text-primary underline-offset-4 hover:underline">
                PDF side-by-side
              </Link>
              <span className="hidden text-muted-foreground sm:inline">·</span>
              <Link href="/categories" className="text-primary underline-offset-4 hover:underline">
                Categories
              </Link>
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 overflow-visible">
          {rules.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No rules yet. Correct a category on Transactions to create one.
            </p>
          )}
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex flex-col gap-3 border-b border-border/60 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">“{rule.pattern}”</p>
                <p className="text-xs text-muted-foreground">
                  {rule.match_type} · priority {rule.priority}
                </p>
              </div>
              <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
                <div className="relative min-w-[180px] max-w-full flex-1 sm:flex-none">
                  <CategorySelect
                    categories={categories}
                    value={rule.category_id}
                    onValueChange={(v) => changeCategory(rule.id, v)}
                    onCategoriesChange={setCategories}
                    triggerClassName="h-8 w-full min-w-[180px] max-w-[240px]"
                  />
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeRule(rule.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
