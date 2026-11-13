import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading team updates">
      <Skeleton className="mb-2 h-7 w-44" /><Skeleton className="mb-6 h-4 w-72" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="mt-6 h-64" /><Skeleton className="mt-6 h-72" />
    </div>
  );
}
