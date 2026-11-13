import * as React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-muted", className)} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary">{icon}</div>}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger", className)}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function InfoNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-muted", className)}>{children}</div>;
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
