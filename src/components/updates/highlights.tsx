import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDay } from "@/lib/dates";

type Item = { updateId: string; date: string; employeeName: string; text: string };

function Column({ title, description, items, empty }: { title: string; description: string; items: Item[]; empty: string }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {items.length === 0 ? <p className="px-5 py-6 text-sm text-muted">{empty}</p> : (
        <ul className="divide-y divide-border">
          {items.map((i, n) => (
            <li key={`${i.updateId}-${n}`}>
              <Link href={`/team-updates/${i.updateId}`} className="block px-5 py-3 hover:bg-surface-muted/50">
                <p className="line-clamp-3 break-words text-sm">{i.text}</p>
                <p className="mt-1 text-xs text-muted">{i.employeeName} · {formatDay(i.date, { day: "numeric", month: "short" })}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The employees' own words from the last week — shown as written, not interpreted. */
export function Highlights({ h }: { h: { blockers: Item[]; pending: Item[]; completed: Item[] } }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Column title="Recent blockers" description="Reported in the last 7 days" items={h.blockers} empty="No blockers reported this week." />
      <Column title="Pending work" description="Still open, as reported" items={h.pending} empty="Nothing reported as pending." />
      <Column title="Completed work" description="Finished, as reported" items={h.completed} empty="Nothing reported as completed yet." />
    </div>
  );
}
