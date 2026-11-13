"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { ClipboardList, LayoutDashboard, Menu, Moon, PenLine, Settings, Sun, Users, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { SignOutButton } from "./sign-out-button";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav";

const ICONS = { dashboard: LayoutDashboard, users: Users, settings: Settings, updates: PenLine, team: ClipboardList } as const;

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground">
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="space-y-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors", active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-muted hover:text-foreground")}>
            <Icon className="h-4 w-4" aria-hidden /> {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Account({ name, email, roleLabel }: { name: string; email: string; roleLabel: string }) {
  return (
    <div className="space-y-3 border-t border-border p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{name}</span><Badge tone="primary">{roleLabel}</Badge></div>
        <div className="truncate text-xs text-muted">{email}</div>
      </div>
      <SignOutButton variant="secondary" size="sm" className="w-full" />
    </div>
  );
}

export function AppShell({ items, orgName, user, children }: { items: NavItem[]; orgName: string; user: { name: string; email: string; roleLabel: string }; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5"><Logo /></div>
      <div className="px-3"><div className="mb-2 truncate px-3 text-xs font-medium uppercase tracking-wide text-muted">{orgName}</div><NavLinks items={items} onNavigate={onNavigate} /></div>
      <div className="mt-auto"><Account {...user} /></div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-surface lg:block">{sidebar()}</aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/90 px-4 backdrop-blur lg:px-8">
        <button type="button" className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-muted lg:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" />
        </button>
        <div className="lg:hidden"><Logo className="[&_svg]:h-7 [&_svg]:w-7" /></div>
        <div className="hidden truncate text-sm text-muted lg:block">{orgName}</div>
        <ThemeToggle />
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface shadow-xl">
            <button type="button" className="absolute right-3 top-4 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-muted" aria-label="Close menu" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
            {sidebar(() => setOpen(false))}
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
