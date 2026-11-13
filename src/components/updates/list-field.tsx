"use client";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A section of one or more free-text entries. One long paragraph and several short items are equally valid. */
export function ListField({
  id, label, hint, placeholder, values, onChange, required, max = 20,
}: {
  id: string; label: string; hint?: string; placeholder?: string; values: string[]; onChange: (v: string[]) => void; required?: boolean; max?: number;
}) {
  const rows = values.length ? values : [""];
  const set = (i: number, v: string) => onChange(rows.map((r, j) => (j === i ? v : r)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}{required && <span aria-hidden className="text-danger"> *</span>}</legend>
      {hint && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
      <div className="space-y-2">
        {rows.map((value, i) => (
          <div key={i} className="flex items-start gap-2">
            <textarea
              id={`${id}-${i}`}
              aria-label={rows.length > 1 ? `${label} — entry ${i + 1}` : label}
              aria-describedby={hint ? `${id}-hint` : undefined}
              aria-required={required && i === 0 ? true : undefined}
              rows={2}
              maxLength={2000}
              value={value}
              placeholder={i === 0 ? placeholder : undefined}
              onChange={(e) => set(i, e.target.value)}
              className={cn("min-h-[3.25rem] w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-foreground shadow-card placeholder:text-muted/70 focus-visible:border-ring")}
            />
            {rows.length > 1 && (
              <Button type="button" size="icon" variant="ghost" aria-label={`Remove entry ${i + 1} from ${label}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
      {rows.length < max && (
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...rows, ""])}>
          <Plus className="h-3.5 w-3.5" /> Add another
        </Button>
      )}
    </fieldset>
  );
}
