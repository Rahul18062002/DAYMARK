import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { BRAND } from "@/lib/brand";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
      <Link href="/" aria-label={`${BRAND.name} home`} className="mb-8"><Logo showTagline /></Link>
      <main className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-card sm:p-8">{children}</main>
      <p className="mt-6 text-xs text-muted">{BRAND.name} · {BRAND.tagline}</p>
    </div>
  );
}
