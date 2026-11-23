"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, RefreshCw, RotateCcw, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { ErrorNotice } from "@/components/ui/states";

type Content = { headline: string; summary: string; highlights: string[]; risks: string[]; blockers: string[]; goals: string[] };
const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

function useAct() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<unknown>, ok: string, then?: () => void) {
    setBusy(key); setError(null);
    try { await fn(); toast.success(ok); router.refresh(); then?.(); } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong."); } finally { setBusy(null); }
  }
  return { busy, error, run, setError };
}

export function ReviewActions({ id, status, canEdit, content }: { id: string; status: "GENERATED" | "PUBLISHED" | "REJECTED"; canEdit: boolean; content: Content }) {
  const a = useAct();
  const [edit, setEdit] = useState(false);
  const [reject, setReject] = useState(false);
  const [note, setNote] = useState("");
  const [v, setV] = useState({ headline: content.headline, summary: content.summary, highlights: content.highlights.join("\n"), goals: content.goals.join("\n"), risks: content.risks.join("\n"), blockers: content.blockers.join("\n") });
  const review = (action: "approve" | "reject" | "reopen", ok: string, n?: string) => a.run(action, () => api(`/api/reports/${id}/review`, { body: { action, note: n || null } }), ok, () => setReject(false));
  const ta = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-card focus-visible:border-ring";
  return (
    <div className="space-y-3">
      {a.error && <ErrorNotice>{a.error}</ErrorNotice>}
      <div className="flex flex-wrap items-center gap-2">
        {status !== "PUBLISHED" && <Button loading={a.busy === "approve"} onClick={() => review("approve", "Report published.")}><Check className="h-4 w-4" aria-hidden />Approve and publish</Button>}
        {status === "GENERATED" && <Button variant="secondary" onClick={() => setReject(true)}><X className="h-4 w-4" aria-hidden />Reject</Button>}
        {canEdit && <Button variant="secondary" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" aria-hidden />Edit</Button>}
        {status !== "GENERATED" && <Button variant="ghost" loading={a.busy === "reopen"} onClick={() => review("reopen", "Report reopened as a draft.")}><RotateCcw className="h-4 w-4" aria-hidden />Reopen</Button>}
      </div>
      <Dialog open={reject} onOpenChange={setReject} title="Reject this report?" description="It stays unpublished. Say why, so whoever regenerates or edits it knows what to fix.">
        <Field label="Reason (optional)" htmlFor="rj-note"><Input id="rj-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Misses the billing migration" /></Field>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setReject(false)}>Cancel</Button><Button variant="danger" loading={a.busy === "reject"} onClick={() => review("reject", "Report rejected.", note)}>Reject report</Button></div>
      </Dialog>
      <Dialog open={edit} onOpenChange={setEdit} title="Edit report" description="Your changes replace the AI text. The report is labelled as edited by a reviewer.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); a.run("edit", () => api(`/api/reports/${id}`, { method: "PATCH", body: { headline: v.headline, summary: v.summary, highlights: lines(v.highlights), goals: lines(v.goals), risks: lines(v.risks), blockers: lines(v.blockers) } }), "Report saved.", () => setEdit(false)); }}>
          <Field label="Headline" htmlFor="ed-h"><Input id="ed-h" value={v.headline} required maxLength={200} onChange={(e) => setV({ ...v, headline: e.target.value })} /></Field>
          <Field label="Summary" htmlFor="ed-s"><textarea id="ed-s" className={ta} rows={4} value={v.summary} required maxLength={2500} onChange={(e) => setV({ ...v, summary: e.target.value })} /></Field>
          {([["Highlights", "highlights"], ["Goals", "goals"], ["Risks to goals", "risks"], ["Blockers reported", "blockers"]] as const).map(([label, k]) => (
            <Field key={k} label={`${label} (one per line)`} htmlFor={`ed-${k}`}><textarea id={`ed-${k}`} className={ta} rows={3} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
          ))}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setEdit(false)}>Cancel</Button><Button type="submit" loading={a.busy === "edit"}>Save report</Button></div>
        </form>
      </Dialog>
    </div>
  );
}

export function RegenerateButton({ kind, subjectId, weekStart, label, variant }: { kind: string; subjectId?: string; weekStart: string; label?: string; variant?: "secondary" | "primary" }) {
  const a = useAct();
  const router = useRouter();
  return (
    <div className="space-y-2">
      <Button variant={variant ?? "secondary"} loading={a.busy === "gen"} onClick={() => a.run("gen", async () => { const r = await api<{ id: string }>("/api/reports/generate", { body: { kind, subjectId, weekStart } }); router.push(`/reports/${r.id}`); }, "Report written. Review it before publishing.")}><RefreshCw className="h-4 w-4" aria-hidden />{label ?? "Write report"}</Button>
      {a.error && <ErrorNotice>{a.error}</ErrorNotice>}
    </div>
  );
}

export function UpdateSummaryButton({ updateId, label }: { updateId: string; label: string }) {
  const a = useAct();
  return (
    <div className="space-y-2"><Button size="sm" variant="secondary" loading={a.busy === "s"} onClick={() => a.run("s", () => api(`/api/updates/${updateId}/summary`, { method: "POST" }), "Summary written.")}><RefreshCw className="h-3.5 w-3.5" aria-hidden />{label}</Button>{a.error && <ErrorNotice>{a.error}</ErrorNotice>}</div>
  );
}

export function RequestReportDialog({ weekStart, options }: { weekStart: string; options: { kinds: { id: string; label: string }[]; subjects: Record<string, { id: string; name: string }[]> } }) {
  const [open, setOpen] = useState(false);
  const a = useAct();
  const router = useRouter();
  const [kind, setKind] = useState(options.kinds[0]?.id ?? "TEAM_WEEK");
  const [subjectId, setSubjectId] = useState("");
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><RefreshCw className="h-4 w-4" aria-hidden />Write a report</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Write a report now" description={`For the week starting ${weekStart}. It is written by AI as a draft for you to review.`}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); a.run("g", async () => { const r = await api<{ id: string }>("/api/reports/generate", { body: { kind, subjectId: kind === "COMPANY_WEEK" ? undefined : subjectId, weekStart } }); setOpen(false); router.push(`/reports/${r.id}`); }, "Report written. Review it before publishing."); }}>
          {a.error && <ErrorNotice>{a.error}</ErrorNotice>}
          <Field label="Report about" htmlFor="rq-kind"><select id="rq-kind" value={kind} onChange={(e) => { setKind(e.target.value); setSubjectId(""); }} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm shadow-card">{options.kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></Field>
          {kind !== "COMPANY_WEEK" && <Field label="Which one" htmlFor="rq-sub"><select id="rq-sub" value={subjectId} required onChange={(e) => setSubjectId(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm shadow-card"><option value="">Choose…</option>{(options.subjects[kind] ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={a.busy === "g"}>Write report</Button></div>
        </form>
      </Dialog>
    </>
  );
}
