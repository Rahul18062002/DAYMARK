import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePageContext } from "@/server/auth/context";
import { getTodayStatus, MAX_BACKDATE_DAYS } from "@/server/services/updates";
import { PageHeader } from "@/components/ui/states";
import { UpdateForm } from "@/components/updates/update-form";
import { addDays, isValidDay } from "@/lib/dates";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "New update" };

export default async function NewUpdatePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await requirePageContext();
  const { today, update } = await getTodayStatus(ctx);
  const sp = await searchParams;
  const wanted = sp.date && isValidDay(sp.date) ? sp.date : today;
  // If there is already an update for today, continue it instead of starting a second one.
  if (update && wanted === today) redirect(update.status === "DRAFT" ? `/my-updates/${update.id}/edit` : `/my-updates/${update.id}`);
  const min = addDays(today, -MAX_BACKDATE_DAYS);
  const date = wanted > today ? today : wanted < min ? today : wanted;

  return (
    <>
      <Link href="/my-updates" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> My Updates</Link>
      <PageHeader title="Daily update" description="What did you get done? Keep it simple and in your own words." />
      <div className="max-w-3xl">
        <UpdateForm mode="create" updateDate={date} minDate={min} maxDate={today}
          initial={{ workedOn: [""], completed: [], pending: [], blockers: [], nextPriorities: [] }} initialLinks={[]} />
      </div>
    </>
  );
}
