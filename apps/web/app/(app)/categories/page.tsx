"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clientApi, type Category } from "@/lib/api";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<"expense" | "income">("expense");

  const load = useCallback(async () => {
    try {
      const cats = await clientApi<Category[]>("/categories");
      setCategories(cats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load categories");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { system, custom } = useMemo(
    () => ({
      system: categories.filter((c) => c.is_system),
      custom: categories.filter((c) => !c.is_system),
    }),
    [categories]
  );

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await clientApi("/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type }),
      });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id: string) {
    setSaving(true);
    setError("");
    try {
      await clientApi(`/categories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), type: editType }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function removeCategory(cat: Category) {
    const msg =
      `Delete “${cat.name}”? Transactions and rules using it will move to Other.`;
    if (!window.confirm(msg)) return;
    setError("");
    try {
      const qs = new URLSearchParams();
      await clientApi(`/categories/${cat.id}${qs.toString() ? `?${qs}` : ""}`, {
        method: "DELETE",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl tracking-tight">Categories</h1>
        <p className="mt-1 text-muted-foreground">
          Atlas includes standard income and expense categories. Add your own for
          things like software, travel, or client retainers — they show up in
          review, transactions, rules, and reports.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Add custom category</CardTitle>
          <CardDescription>
            Custom categories belong to your organization only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={createCategory}
            className="grid gap-3 sm:grid-cols-[1fr_140px_auto]"
          >
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Software subscriptions"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as "expense" | "income")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Add"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Your custom categories</CardTitle>
          <CardDescription>
            Edit or delete anytime.{" "}
            <Link
              href="/rules"
              className="text-primary underline-offset-4 hover:underline"
            >
              Learning rules
            </Link>{" "}
            can map merchants to these.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {custom.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No custom categories yet. Add one above, or create one while
              reviewing a transaction.
            </p>
          )}
          {custom.map((cat) => (
            <div
              key={cat.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 py-3 last:border-0"
            >
              {editingId === cat.id ? (
                <div className="flex w-full flex-wrap items-end gap-2">
                  <div className="min-w-[180px] flex-1 space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="w-[140px] space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={editType}
                      onValueChange={(v) =>
                        setEditType(v as "expense" | "income")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="expense">Expense</SelectItem>
                        <SelectItem value="income">Income</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" onClick={() => saveEdit(cat.id)} disabled={saving}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-medium">{cat.name}</p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {cat.type} · custom
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingId(cat.id);
                        setEditName(cat.name);
                        setEditType(
                          cat.type === "income" ? "income" : "expense"
                        );
                      }}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCategory(cat)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Standard categories</CardTitle>
          <CardDescription>
            Built-in defaults used by extraction. You can’t delete these, but you
            can still assign them anywhere.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {system.map((cat) => (
              <div
                key={cat.id}
                className="rounded-md border border-border/60 px-3 py-2 text-sm"
              >
                <p className="font-medium">{cat.name}</p>
                <p className="text-xs capitalize text-muted-foreground">
                  {cat.type}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
