"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clientApi, type Category } from "@/lib/api";
import { cn } from "@/lib/utils";

export type CategorySelectHandle = {
  open: () => void;
};

type Props = {
  categories: Category[];
  value?: string;
  onValueChange: (categoryId: string) => void;
  onCategoriesChange?: (categories: Category[]) => void;
  placeholder?: string;
  triggerClassName?: string;
  allowCreate?: boolean;
  includeAllOption?: boolean;
  allValue?: string;
  suggestedCategoryId?: string | null;
  suggestedCategoryName?: string | null;
};

export const CategorySelect = forwardRef<CategorySelectHandle, Props>(
  function CategorySelect(
    {
      categories,
      value,
      onValueChange,
      onCategoriesChange,
      placeholder = "Category",
      triggerClassName,
      allowCreate = true,
      includeAllOption = false,
      allValue = "all",
      suggestedCategoryId,
      suggestedCategoryName,
    },
    ref
  ) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [type, setType] = useState<"expense" | "income">("expense");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [highlight, setHighlight] = useState(0);
    const searchRef = useRef<HTMLInputElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(
      null
    );

    useImperativeHandle(ref, () => ({
      open: () => {
        setOpen(true);
        setQuery("");
        setHighlight(0);
        requestAnimationFrame(() => searchRef.current?.focus());
      },
    }));

    useEffect(() => {
      if (!open) return;
      requestAnimationFrame(() => searchRef.current?.focus());
    }, [open]);

    useEffect(() => {
      if (!open) return;
      function onDoc(e: MouseEvent) {
        const target = e.target as Node;
        if (rootRef.current?.contains(target)) return;
        if (triggerRef.current?.contains(target)) return;
        const portal = document.getElementById("category-select-portal");
        if (portal?.contains(target)) return;
        setOpen(false);
        setQuery("");
      }
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    const selected = useMemo(
      () => categories.find((c) => c.id === value),
      [categories, value]
    );

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      let list = categories;
      if (q) {
        list = categories.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.slug.toLowerCase().includes(q)
        );
      }
      const expense = list.filter((c) => c.type === "expense");
      const income = list.filter((c) => c.type === "income");
      return [...expense, ...income];
    }, [categories, query]);

    const options = useMemo(() => {
      const items: { id: string; label: string; hint?: string }[] = [];
      if (includeAllOption) {
        items.push({ id: allValue, label: "All categories" });
      }
      for (const c of filtered) {
        items.push({
          id: c.id,
          label: c.name,
          hint: [
            c.type === "income" ? "income" : null,
            !c.is_system ? "custom" : null,
            suggestedCategoryId === c.id ? "suggested" : null,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      }
      if (allowCreate) {
        items.push({ id: "__create__", label: "Add custom category…" });
      }
      return items;
    }, [
      filtered,
      includeAllOption,
      allValue,
      allowCreate,
      suggestedCategoryId,
    ]);

    useEffect(() => {
      setHighlight(0);
    }, [query, open]);

    useEffect(() => {
      if (!open) {
        setMenuPos(null);
        return;
      }
      function place() {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setMenuPos({
          top: rect.bottom + 4,
          left: rect.left,
          width: Math.max(rect.width, 240),
        });
      }
      place();
      window.addEventListener("resize", place);
      window.addEventListener("scroll", place, true);
      return () => {
        window.removeEventListener("resize", place);
        window.removeEventListener("scroll", place, true);
      };
    }, [open]);

    async function createCategory(e: React.FormEvent) {
      e.preventDefault();
      if (!name.trim()) return;
      setSaving(true);
      setError("");
      try {
        const created = await clientApi<Category>("/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), type }),
        });
        const next = [...categories, created].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        onCategoriesChange?.(next);
        onValueChange(created.id);
        setName("");
        setCreating(false);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create category");
      } finally {
        setSaving(false);
      }
    }

    function pick(id: string) {
      if (id === "__create__") {
        setCreating(true);
        setOpen(false);
        return;
      }
      onValueChange(id);
      setOpen(false);
      setQuery("");
    }

    function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, Math.max(options.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const opt = options[highlight];
        if (opt) pick(opt.id);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setQuery("");
      }
    }

    return (
      <div ref={rootRef} className={cn("relative space-y-2", open && "z-50")}>
        <button
          ref={triggerRef}
          type="button"
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
            triggerClassName
          )}
          onClick={() => {
            setOpen((v) => !v);
            setQuery("");
          }}
          aria-expanded={open}
        >
          <span className={cn("truncate", !selected && value !== allValue && "text-muted-foreground")}>
            {value === allValue && includeAllOption
              ? "All categories"
              : selected?.name || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>

        {suggestedCategoryName &&
          suggestedCategoryId &&
          suggestedCategoryId !== value && (
            <button
              type="button"
              className="text-left text-[11px] text-amber-800 underline-offset-2 hover:underline"
              onClick={() => onValueChange(suggestedCategoryId)}
            >
              Suggested: {suggestedCategoryName}
            </button>
          )}

        {open &&
          menuPos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              id="category-select-portal"
              className="fixed z-[9999] overflow-hidden rounded-md border bg-white shadow-lg"
              style={{
                top: menuPos.top,
                left: menuPos.left,
                width: menuPos.width,
              }}
            >
              <div className="border-b p-2">
                <Input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder="Search categories…"
                  className="h-8"
                />
              </div>
              <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
                {options.length === 0 && (
                  <li className="px-3 py-2 text-sm text-muted-foreground">No matches</li>
                )}
                {options.map((opt, i) => (
                  <li key={opt.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={opt.id === value || i === highlight}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                        i === highlight ? "bg-accent" : "hover:bg-muted/60"
                      )}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => pick(opt.id)}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          opt.id === value ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {opt.id === "__create__" ? (
                          <span className="inline-flex items-center gap-1">
                            <Plus className="h-3.5 w-3.5" />
                            {opt.label}
                          </span>
                        ) : (
                          opt.label
                        )}
                      </span>
                      {opt.hint && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {opt.hint}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>,
            document.body
          )}

        {creating && (
          <form
            onSubmit={createCategory}
            className="rounded-lg border border-border/80 bg-muted/30 p-3 space-y-2"
          >
            <p className="text-xs font-medium">New custom category</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
              <div className="space-y-1">
                <Label htmlFor="new-cat-name" className="text-xs">
                  Name
                </Label>
                <Input
                  id="new-cat-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Software subscriptions"
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
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
              <div className="flex items-end gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? "Saving…" : "Add"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCreating(false);
                    setError("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </form>
        )}
      </div>
    );
  }
);
