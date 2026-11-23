import { AlertTriangle, CheckCircle2, CircleSlash, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Confidence } from "@/lib/goals";

export const LEVEL_LABEL = { COMPANY: "Company", DEPARTMENT: "Department", TEAM: "Team", INDIVIDUAL: "Individual" } as const;
export const HEALTH_LABEL: Record<Confidence, string> = { ON_TRACK: "On track", AT_RISK: "At risk", OFF_TRACK: "Off track" };

export function HealthBadge({ health, progress }: { health: Confidence; progress: number | null }) {
  if (progress === null) return <Badge>Not measured yet</Badge>;
  const tone = health === "ON_TRACK" ? "success" : health === "AT_RISK" ? "warning" : "danger";
  const Icon = health === "ON_TRACK" ? CheckCircle2 : health === "AT_RISK" ? AlertTriangle : TrendingDown;
  return <Badge tone={tone} className="gap-1"><Icon className="h-3 w-3" aria-hidden />{HEALTH_LABEL[health]}</Badge>;
}

export function StatusBadge({ status }: { status: "ACTIVE" | "DONE" | "CANCELLED" }) {
  if (status === "DONE") return <Badge tone="success" className="gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden />Done</Badge>;
  if (status === "CANCELLED") return <Badge className="gap-1"><CircleSlash className="h-3 w-3" aria-hidden />Cancelled</Badge>;
  return null;
}

export function LevelBadge({ level }: { level: keyof typeof LEVEL_LABEL }) {
  return <Badge tone={level === "COMPANY" ? "primary" : "neutral"}>{LEVEL_LABEL[level]}</Badge>;
}
