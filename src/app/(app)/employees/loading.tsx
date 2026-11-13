import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading employees">
      <Skeleton className="mb-2 h-7 w-40" /><Skeleton className="mb-6 h-4 w-72" />
      <Skeleton className="h-10 w-full" /><Skeleton className="mt-4 h-72" />
    </div>
  );
}
