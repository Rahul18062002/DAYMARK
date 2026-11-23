import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading goals">
      <Skeleton className="mb-2 h-8 w-40" /><Skeleton className="mb-6 h-4 w-80" />
      <div className="mb-6 grid gap-3 lg:grid-cols-4"><Skeleton className="h-32 lg:col-span-2" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      <Skeleton className="h-72" />
    </div>
  );
}
