import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, PenLine } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { getTodayStatus, listOwnUpdates } from "@/server/services/updates";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { BlockerBadge, LateBadge, UpdateStatusBadge } from "@/components/updates/badges";
import { formatDay, formatInstant } from "@/lib/dates";

export const metadata: Metadata = { title: "My Updates" };

export default async function MyUpdatesPage() {
  const ctx = await requirePageContext();
  const [today, history] = await Promise.all([getTodayStatus(ctx), listOwnUpdates(ctx)]);
  const t = today.update;

  const cta = !t
    ? { label: "Write today's update", href: "/my-updates/new", text: "You haven't submitted today's update yet." }
    : t.status === "DRAFT"
      ? { label: "Continue draft", href: `/my-updates/${t.id}/edit`, text: "You have a draft for today. Finish and submit it when you're ready." }
      : { label: "View today's update", href: `/my-updates/${t.id}`, text: "Today's update is submitted. Thank you!" };

  return (
    <>
      <PageHeader title="My Updates" description="Share what you worked on and look back at previous days." action={<Button asChild><Link href="/my-updates/new"><PenLine className="h-4 w-4" /> New update</Link></Button>} />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Today · {formatDay(today.today, { weekday: "long", day: "numeric", month: "long" })}</div>
            <p className="mt-1 text-sm">{cta.text}</p>
          </div>
          <Button asChild variant={t && t.status !== "DRAFT" ? "secondary" : "primary"}><Link href={cta.href}>{cta.label}</Link></Button>
        </div>
      </Card>

      <Card>
        {history.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title="No updates yet" description="Your submitted updates will be listed here so you can look back at them." action={<Button asChild><Link href="/my-updates/new">Write your first update</Link></Button>} />
        ) : (
          <ul className="divide-y divide-border">
            {history.map((u) => (
              <li key={u.id}>
                <Link href={u.status === "DRAFT" ? `/my-updates/${u.id}/edit` : `/my-updates/${u.id}`} className="block px-5 py-4 hover:bg-surface-muted/50">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{formatDay(u.updateDate)}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <UpdateStatusBadge status={u.status} />{u.submittedLate && <LateBadge />}{u.hasBlockers && <BlockerBadge has />}
                    </span>
                  </div>
                  {u.preview && <p className="mt-1 line-clamp-2 text-sm text-muted">{u.preview}</p>}
                  {u.firstSubmittedAt && <p className="mt-1 text-xs text-muted">Submitted {formatInstant(u.firstSubmittedAt, today.timezone)}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
