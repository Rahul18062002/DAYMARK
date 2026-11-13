import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="mb-2 h-7 w-56" /><Skeleton className="mb-6 h-4 w-80" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="mt-6 h-64" />
    </div>
  );
}
