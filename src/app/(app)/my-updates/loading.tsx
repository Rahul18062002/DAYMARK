import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading updates">
      <Skeleton className="mb-2 h-7 w-40" /><Skeleton className="mb-6 h-4 w-72" />
      <Skeleton className="mb-6 h-20" /><Skeleton className="h-72" />
    </div>
  );
}
