"use client";
import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export function Dialog({
  open, onOpenChange, title, description, children,
}: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <D.Content {...(description ? {} : { "aria-describedby": undefined })} className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description && <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>}
            </div>
            <D.Close className="rounded-md p-1 text-muted hover:bg-surface-muted" aria-label="Close"><X className="h-4 w-4" /></D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
