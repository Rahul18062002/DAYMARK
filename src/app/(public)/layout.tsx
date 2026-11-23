import Link from "next/link";
import { BarChart3, Network, Target } from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { BRAND } from "@/lib/brand";

const POINTS = [
  { icon: Target, title: "Goals that cascade", text: "From company objectives down to each person's daily work." },
  { icon: Network, title: "Everyone in view", text: "Peers, leads and leadership see the same picture, including the CEO." },
  { icon: BarChart3, title: "Progress you can measure", text: "Daily updates, key results and KPIs in one place." },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:justify-between lg:p-12" style={{ background: "var(--brand-gradient)" }}>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <Link href="/" aria-label={`${BRAND.name} home`} className="relative flex items-center gap-2.5"><LogoMark className="h-9 w-9 [&_rect:first-child]:fill-white/20" /><span className="text-xl font-semibold tracking-tight">{BRAND.name}</span></Link>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-[1.1] tracking-tight">{BRAND.tagline}</h2>
          <p className="mt-4 text-base text-white/75">{BRAND.description}</p>
          <ul className="mt-10 space-y-6">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20"><Icon className="h-5 w-5" aria-hidden /></span>
                <div><div className="font-medium">{title}</div><div className="text-sm text-white/70">{text}</div></div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">© {new Date().getFullYear()} {BRAND.name}</p>
      </aside>

      <div className="flex flex-col items-center justify-center px-4 py-10">
        <Link href="/" aria-label={`${BRAND.name} home`} className="mb-8 lg:hidden"><Logo showTagline /></Link>
        <main className="animate-in w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-pop)] sm:p-8">{children}</main>
        <p className="mt-6 text-xs text-muted lg:hidden">{BRAND.name} · {BRAND.tagline}</p>
      </div>
    </div>
  );
}
