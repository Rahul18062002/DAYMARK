import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md pt-16">
      <EmptyState title="We couldn't find that" description="It may not exist, or you may not have access to it." action={<Button asChild><Link href="/dashboard">Back to dashboard</Link></Button>} />
    </div>
  );
}
