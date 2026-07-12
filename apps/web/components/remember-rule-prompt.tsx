"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { clientApi, type RuleSuggestion } from "@/lib/api";

type Props = {
  suggestion: RuleSuggestion;
  /** Original transaction description — required to learn merchant aliases. */
  description?: string;
  onDismiss: () => void;
  onSaved?: () => void;
};

export function RememberRulePrompt({
  suggestion,
  description,
  onDismiss,
  onSaved,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function remember() {
    setSaving(true);
    setError("");
    try {
      // Prefer merchant learn (alias + category rule) when we have a description
      if (description) {
        await clientApi("/merchants/learn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            category_id: suggestion.category_id,
            merchant_name: suggestion.merchant_name || undefined,
            also_create_category_rule: true,
          }),
        });
      } else {
        await clientApi("/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pattern: suggestion.pattern,
            category_id: suggestion.category_id,
            match_type: "contains",
            priority: 10,
          }),
        });
      }
      onSaved?.();
      onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save rule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-950">
      <div className="min-w-0">
        <p className="font-medium">{suggestion.preview}</p>
        <p className="text-xs text-emerald-900/80">
          Atlas will normalize similar descriptions to{" "}
          {suggestion.merchant_name || "this merchant"} and apply{" "}
          {suggestion.category_name} on future imports.
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" size="sm" onClick={remember} disabled={saving}>
          {saving ? "Saving…" : "Remember"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}
