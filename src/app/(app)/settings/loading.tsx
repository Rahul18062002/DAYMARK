import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading settings">
      <Skeleton className="mb-2 h-7 w-32" /><Skeleton className="mb-6 h-4 w-72" />
      <Skeleton className="mb-4 h-10 w-80" /><Skeleton className="h-72" />
    </div>
  );
}
