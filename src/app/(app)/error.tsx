"use client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md pt-16">
      <EmptyState title="Something went wrong" description="We couldn't load this page. Please try again." action={<Button onClick={reset}>Try again</Button>} />
    </div>
  );
}
