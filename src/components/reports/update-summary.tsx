import { Card, CardBody } from "@/components/ui/card";
import { ReportBody } from "./report-body";
import { UpdateSummaryButton } from "./review-actions";
import type { ReportDto } from "@/server/services/summaries";

/** The AI summary of one update, or (when AI is on) a button to write it. Always labelled as AI-generated and unverified. */
export function UpdateSummaryCard({ summary, updateId, canGenerate, aiOn }: { summary: ReportDto | null; updateId: string; canGenerate: boolean; aiOn: boolean }) {
  if (!summary && !(aiOn && canGenerate)) return null;
  return (
    <Card data-testid="update-summary">
      <CardBody className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">AI summary</h2>
        {summary ? <ReportBody r={summary} compact /> : <p className="text-sm text-muted">A short summary is written automatically after an update is submitted. It isn&apos;t here yet.</p>}
        {aiOn && canGenerate && <UpdateSummaryButton updateId={updateId} label={summary ? "Write it again" : "Write summary"} />}
      </CardBody>
    </Card>
  );
}
