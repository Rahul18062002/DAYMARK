import { AlertTriangle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type DisplayStatus = "DRAFT" | "SUBMITTED" | "EDITED" | "MISSING";
const LABEL: Record<DisplayStatus, string> = { DRAFT: "Draft", SUBMITTED: "Submitted", EDITED: "Edited", MISSING: "Not submitted" };
const TONE = { DRAFT: "neutral", SUBMITTED: "success", EDITED: "primary", MISSING: "warning" } as const;

export const UpdateStatusBadge = ({ status }: { status: DisplayStatus }) => <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;

export function BlockerBadge({ has }: { has: boolean }) {
  return has ? (
    <Badge tone="danger"><AlertTriangle className="mr-1 h-3 w-3" aria-hidden />Blocker</Badge>
  ) : (
    <span className="text-xs text-muted">None</span>
  );
}

export const LateBadge = () => <Badge tone="warning"><Clock className="mr-1 h-3 w-3" aria-hidden />Late</Badge>;
