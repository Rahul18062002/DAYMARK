import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-border bg-surface shadow-card", className)} {...p} />;
}
export function CardHeader({ title, description, action, className }: { title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-border px-5 py-4", className)}>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export const CardBody = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5", className)} {...p} />;
