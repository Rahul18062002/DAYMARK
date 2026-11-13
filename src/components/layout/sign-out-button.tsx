"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { authClient } from "@/server/auth/client";
import { Button, type ButtonProps } from "@/components/ui/button";

export function SignOutButton({ children, ...props }: ButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button {...props} loading={busy} onClick={async () => { setBusy(true); await authClient.signOut(); router.replace("/login"); router.refresh(); }}>
      {children ?? (<><LogOut className="h-4 w-4" aria-hidden /> Sign out</>)}
    </Button>
  );
}
