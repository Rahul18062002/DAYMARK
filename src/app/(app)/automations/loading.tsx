import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading automations">
      <Skeleton className="mb-2 h-7 w-44" /><Skeleton className="mb-6 h-4 w-96" />
      <Skeleton className="h-[420px]" /><Skeleton className="mt-6 h-56" />
    </div>
  );
}
