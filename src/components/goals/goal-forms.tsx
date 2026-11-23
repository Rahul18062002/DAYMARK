"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { ErrorNotice } from "@/components/ui/states";
import { LEVEL_LABEL } from "./badges";

type Level = keyof typeof LEVEL_LABEL;
export type FormOptions = {
  people: { id: string; name: string }[]; teams: { id: string; name: string; departmentId: string | null }[]; departments: { id: string; name: string }[];
  levels: Level[]; selfId: string;
};
export type ParentOption = { id: string; title: string; level: Level };

function useSubmit(onDone?: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    setBusy(true); setError(null); setFields({});
    try { const r = await fn(); if (success) toast.success(success); router.refresh(); onDone?.(); return r; }
    catch (e) { if (e instanceof ApiError) { setFields(e.fields); setError(e.message); } else setError("Something went wrong."); }
    finally { setBusy(false); }
  }
  return { busy, error, fields, run, setError };
}

const optLabel = (p: ParentOption) => `${p.title} (${LEVEL_LABEL[p.level]})`;
const rank = (l: Level) => ({ COMPANY: 0, DEPARTMENT: 1, TEAM: 2, INDIVIDUAL: 3 })[l];

// ───────────── new / edit goal ─────────────
export function ObjectiveDialog(p: {
  open: boolean; onClose: () => void; options: FormOptions; parents: ParentOption[]; period: { from: string; to: string };
  edit?: { id: string; title: string; description: string | null; ownerId: string; parentId: string | null; periodStart: string; periodEnd: string; level: Level };
  defaultParentId?: string; defaultLevel?: Level;
}) {
  const e = p.edit;
  const s = useSubmit(p.onClose);
  const [title, setTitle] = useState(e?.title ?? "");
  const [description, setDescription] = useState(e?.description ?? "");
  const [level, setLevel] = useState<Level>(e?.level ?? p.defaultLevel ?? p.options.levels[p.options.levels.length - 1]);
  const [ownerId, setOwnerId] = useState(e?.ownerId ?? p.options.selfId);
  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [parentId, setParentId] = useState(e?.parentId ?? p.defaultParentId ?? "");
  const [start, setStart] = useState(e?.periodStart ?? p.period.from);
  const [end, setEnd] = useState(e?.periodEnd ?? p.period.to);
  // a goal can only sit under one at the same or a higher level, and never under itself
  const parentChoices = p.parents.filter((x) => rank(x.level) <= rank(level) && x.id !== e?.id);

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    s.run(async () => {
      if (e) return api(`/api/objectives/${e.id}`, { method: "PATCH", body: { title, description: description || null, ownerId, parentId: parentId || null, periodStart: start, periodEnd: end } });
      return api("/api/objectives", { method: "POST", body: { title, description: description || null, level, ownerId, parentId: parentId || null, departmentId: level === "DEPARTMENT" ? departmentId || null : null, teamId: level === "TEAM" ? teamId || null : null, periodStart: start, periodEnd: end } });
    }, e ? "Goal updated." : "Goal created.");
  }
  return (
    <Dialog open={p.open} onOpenChange={(o) => !o && p.onClose()} title={e ? "Edit goal" : "New goal"} description={e ? undefined : "What do you want to achieve, and by when?"}>
      <form className="space-y-4" onSubmit={submit}>
        {s.error && <ErrorNotice>{s.error}</ErrorNotice>}
        <Field label="Goal" htmlFor="g-title" error={s.fields.title}><Input id="g-title" value={title} required maxLength={200} placeholder="e.g. Grow enterprise revenue" onChange={(x) => setTitle(x.target.value)} /></Field>
        <Field label="Why it matters (optional)" htmlFor="g-desc"><textarea id="g-desc" value={description} maxLength={2000} rows={3} onChange={(x) => setDescription(x.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-card focus-visible:border-ring" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Level" htmlFor="g-level" hint={e ? "The level can't be changed." : undefined}>
            <Select id="g-level" value={level} disabled={!!e || p.options.levels.length === 1} onChange={(x) => { setLevel(x.target.value as Level); setParentId(""); }}>
              {p.options.levels.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="g-owner"><Select id="g-owner" value={ownerId} disabled={p.options.people.length <= 1} onChange={(x) => setOwnerId(x.target.value)}>{p.options.people.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === p.options.selfId ? " (you)" : ""}</option>)}</Select></Field>
        </div>
        {!e && level === "DEPARTMENT" && (
          <Field label="Department" htmlFor="g-dept" error={s.fields.departmentId}><Select id="g-dept" value={departmentId} required onChange={(x) => setDepartmentId(x.target.value)}><option value="">Choose…</option>{p.options.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        )}
        {!e && level === "TEAM" && (
          <Field label="Team" htmlFor="g-team" error={s.fields.teamId}><Select id="g-team" value={teamId} required onChange={(x) => setTeamId(x.target.value)}><option value="">Choose…</option>{p.options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        )}
        <Field label="Contributes to (optional)" htmlFor="g-parent" hint="Link this to a higher goal so progress rolls up, from individuals to the company.">
          <Select id="g-parent" value={parentId} onChange={(x) => setParentId(x.target.value)}><option value="">Nothing above it</option>{parentChoices.map((x) => <option key={x.id} value={x.id}>{optLabel(x)}</option>)}</Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" htmlFor="g-start" error={s.fields.periodStart}><Input id="g-start" type="date" value={start} required onChange={(x) => setStart(x.target.value)} /></Field>
          <Field label="Ends" htmlFor="g-end" error={s.fields.periodEnd}><Input id="g-end" type="date" value={end} required onChange={(x) => setEnd(x.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={p.onClose}>Cancel</Button><Button type="submit" loading={s.busy}>{e ? "Save changes" : "Create goal"}</Button></div>
      </form>
    </Dialog>
  );
}

export function NewGoalButton(p: { options: FormOptions; parents: ParentOption[]; period: { from: string; to: string }; label?: string; defaultParentId?: string; defaultLevel?: Level; variant?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={p.variant} onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden />{p.label ?? "New goal"}</Button>
      {open && <ObjectiveDialog open onClose={() => setOpen(false)} options={p.options} parents={p.parents} period={p.period} defaultParentId={p.defaultParentId} defaultLevel={p.defaultLevel} />}
    </>
  );
}

export function EditGoalButton(p: { options: FormOptions; parents: ParentOption[]; period: { from: string; to: string }; goal: NonNullable<Parameters<typeof ObjectiveDialog>[0]["edit"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Pencil className="h-4 w-4" aria-hidden />Edit</Button>
      {open && <ObjectiveDialog open onClose={() => setOpen(false)} options={p.options} parents={p.parents} period={p.period} edit={p.goal} />}
    </>
  );
}

// ───────────── goal actions ─────────────
export function GoalActions({ id, status, hasChildren, parentId }: { id: string; status: "ACTIVE" | "DONE" | "CANCELLED"; hasChildren: boolean; parentId: string | null }) {
  const router = useRouter();
  const s = useSubmit();
  const [confirm, setConfirm] = useState(false);
  const set = (next: string, msg: string) => s.run(() => api(`/api/objectives/${id}`, { method: "PATCH", body: { status: next } }), msg);
  return (
    <>
      {status === "ACTIVE" ? (
        <Button variant="secondary" loading={s.busy} onClick={() => set("DONE", "Marked as done.")}><Check className="h-4 w-4" aria-hidden />Mark done</Button>
      ) : (
        <Button variant="secondary" loading={s.busy} onClick={() => set("ACTIVE", "Goal reopened.")}>Reopen</Button>
      )}
      {status === "ACTIVE" && <Button variant="ghost" onClick={() => set("CANCELLED", "Goal cancelled.")}>Cancel goal</Button>}
      <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => setConfirm(true)} aria-label="Delete goal"><Trash2 className="h-4 w-4" aria-hidden /></Button>
      <Dialog open={confirm} onOpenChange={setConfirm} title="Delete this goal?" description="Its key results, progress history and tasks are deleted with it. This can't be undone.">
        {hasChildren && <ErrorNotice className="mb-3">Move or delete the goals under this one first.</ErrorNotice>}
        {s.error && <ErrorNotice className="mb-3">{s.error}</ErrorNotice>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirm(false)}>Keep it</Button>
          <Button variant="danger" loading={s.busy} disabled={hasChildren} onClick={() => s.run(async () => { await api(`/api/objectives/${id}`, { method: "DELETE" }); router.push(parentId ? `/goals/${parentId}` : "/goals"); }, "Goal deleted.")}>Delete</Button></div>
      </Dialog>
    </>
  );
}

// ───────────── key results ─────────────
type KrType = "NUMBER" | "PERCENT" | "BOOLEAN";
export function NewKeyResultButton({ objectiveId, people, selfId, defaultOwnerId }: { objectiveId: string; people: { id: string; name: string }[]; selfId: string; defaultOwnerId: string }) {
  const [open, setOpen] = useState(false);
  const s = useSubmit(() => setOpen(false));
  const [title, setTitle] = useState(""); const [type, setType] = useState<KrType>("NUMBER");
  const [start, setStart] = useState("0"); const [target, setTarget] = useState(""); const [unit, setUnit] = useState("");
  const [isKpi, setIsKpi] = useState(false); const [weight, setWeight] = useState("1"); const [ownerId, setOwnerId] = useState(defaultOwnerId);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden />Add key result</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Add a key result" description="A measurable result that shows whether the goal is being achieved.">
        <form className="space-y-4" onSubmit={(ev) => { ev.preventDefault(); s.run(() => api(`/api/objectives/${objectiveId}/key-results`, { method: "POST", body: { title, type, startValue: type === "BOOLEAN" ? 0 : Number(start), targetValue: type === "BOOLEAN" ? 1 : Number(target), unit: type === "PERCENT" ? "%" : unit || null, isKpi, weight: Number(weight), ownerId } }), "Key result added."); }}>
          {s.error && <ErrorNotice>{s.error}</ErrorNotice>}
          <Field label="Key result" htmlFor="k-title" error={s.fields.title}><Input id="k-title" value={title} required maxLength={200} placeholder="e.g. Close 10 enterprise deals" onChange={(x) => setTitle(x.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Measured as" htmlFor="k-type"><Select id="k-type" value={type} onChange={(x) => setType(x.target.value as KrType)}><option value="NUMBER">A number</option><option value="PERCENT">A percentage</option><option value="BOOLEAN">Done / not done</option></Select></Field>
            <Field label="Owner" htmlFor="k-owner"><Select id="k-owner" value={ownerId} onChange={(x) => setOwnerId(x.target.value)}>{people.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === selfId ? " (you)" : ""}</option>)}</Select></Field>
          </div>
          {type !== "BOOLEAN" && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Starts at" htmlFor="k-start"><Input id="k-start" type="number" step="any" value={start} required onChange={(x) => setStart(x.target.value)} /></Field>
              <Field label="Target" htmlFor="k-target" error={s.fields.targetValue}><Input id="k-target" type="number" step="any" value={target} required onChange={(x) => setTarget(x.target.value)} /></Field>
              {type === "NUMBER" && <Field label="Unit (optional)" htmlFor="k-unit"><Input id="k-unit" value={unit} maxLength={20} placeholder="deals, $, ms…" onChange={(x) => setUnit(x.target.value)} /></Field>}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Weight" htmlFor="k-weight" hint="How much it counts towards the goal (1–10)."><Input id="k-weight" type="number" min={1} max={10} value={weight} onChange={(x) => setWeight(x.target.value)} /></Field>
            <label className="flex cursor-pointer items-start gap-2 pt-7 text-sm"><input type="checkbox" className="mt-1" checked={isKpi} onChange={(x) => setIsKpi(x.target.checked)} /><span><span className="font-medium">This is a KPI</span><span className="block text-xs text-muted">An ongoing indicator you read regularly; its history is kept as a trend.</span></span></label>
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={s.busy}>Add key result</Button></div>
        </form>
      </Dialog>
    </>
  );
}

export function CheckInButton({ kr }: { kr: { id: string; title: string; type: KrType; currentValue: number; unit: string | null; confidence: "ON_TRACK" | "AT_RISK" | "OFF_TRACK" } }) {
  const [open, setOpen] = useState(false);
  const s = useSubmit(() => setOpen(false));
  const [value, setValue] = useState(String(kr.currentValue)); const [confidence, setConfidence] = useState(kr.confidence); const [comment, setComment] = useState("");
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Check in</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Record progress" description={kr.title}>
        <form className="space-y-4" onSubmit={(ev) => { ev.preventDefault(); s.run(() => api(`/api/key-results/${kr.id}/check-ins`, { method: "POST", body: { value: Number(value), confidence, comment: comment || null } }), "Progress recorded."); }}>
          {s.error && <ErrorNotice>{s.error}</ErrorNotice>}
          {kr.type === "BOOLEAN" ? (
            <Field label="Status" htmlFor="c-value"><Select id="c-value" value={value} onChange={(x) => setValue(x.target.value)}><option value="0">Not done yet</option><option value="1">Done</option></Select></Field>
          ) : (
            <Field label={`Current value${kr.unit ? ` (${kr.unit})` : ""}`} htmlFor="c-value" error={s.fields.value}><Input id="c-value" type="number" step="any" value={value} required onChange={(x) => setValue(x.target.value)} /></Field>
          )}
          <Field label="How confident are you?" htmlFor="c-conf"><Select id="c-conf" value={confidence} onChange={(x) => setConfidence(x.target.value as typeof confidence)}><option value="ON_TRACK">On track</option><option value="AT_RISK">At risk</option><option value="OFF_TRACK">Off track</option></Select></Field>
          <Field label="Note (optional)" htmlFor="c-note"><Input id="c-note" value={comment} maxLength={1000} placeholder="What changed since the last check-in?" onChange={(x) => setComment(x.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={s.busy}>Save progress</Button></div>
        </form>
      </Dialog>
    </>
  );
}

export function DeleteKeyResultButton({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  const s = useSubmit(() => setOpen(false));
  return (
    <>
      <Button size="sm" variant="ghost" aria-label={`Delete key result ${title}`} onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
      <Dialog open={open} onOpenChange={setOpen} title="Delete this key result?" description={`"${title}" and its progress history will be removed. Linked tasks are kept.`}>
        {s.error && <ErrorNotice className="mb-3">{s.error}</ErrorNotice>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Keep it</Button><Button variant="danger" loading={s.busy} onClick={() => s.run(() => api(`/api/key-results/${id}`, { method: "DELETE" }), "Key result deleted.")}>Delete</Button></div>
      </Dialog>
    </>
  );
}

// ───────────── tasks ─────────────
export function AddTaskForm({ objectiveId, keyResults, people, selfId, canAssign }: { objectiveId: string; keyResults: { id: string; title: string }[]; people: { id: string; name: string }[]; selfId: string; canAssign: boolean }) {
  const s = useSubmit();
  const [title, setTitle] = useState(""); const [assigneeId, setAssigneeId] = useState(selfId); const [due, setDue] = useState(""); const [kr, setKr] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2 border-t border-border p-4" onSubmit={(ev) => { ev.preventDefault(); s.run(async () => { await api(`/api/objectives/${objectiveId}/tasks`, { method: "POST", body: { title, assigneeId: canAssign ? assigneeId : undefined, dueDate: due || null, keyResultId: kr || null } }); setTitle(""); setDue(""); }, "Task added."); }}>
      <div className="min-w-48 flex-1"><label htmlFor="t-title" className="sr-only">New task</label><Input id="t-title" value={title} required maxLength={200} placeholder="Add a task…" onChange={(x) => setTitle(x.target.value)} /></div>
      {canAssign && <div><label htmlFor="t-who" className="sr-only">Assign to</label><Select id="t-who" value={assigneeId} onChange={(x) => setAssigneeId(x.target.value)} className="w-40">{people.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === selfId ? " (you)" : ""}</option>)}</Select></div>}
      {keyResults.length > 0 && <div><label htmlFor="t-kr" className="sr-only">For key result</label><Select id="t-kr" value={kr} onChange={(x) => setKr(x.target.value)} className="w-44"><option value="">No key result</option>{keyResults.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}</Select></div>}
      <div><label htmlFor="t-due" className="sr-only">Due date</label><Input id="t-due" type="date" value={due} onChange={(x) => setDue(x.target.value)} className="w-40" /></div>
      <Button type="submit" loading={s.busy}><Plus className="h-4 w-4" aria-hidden />Add</Button>
      {s.error && <ErrorNotice className="w-full">{s.error}</ErrorNotice>}
    </form>
  );
}

export function TaskStatusSelect({ id, status, title, disabled }: { id: string; status: "TODO" | "IN_PROGRESS" | "DONE"; title: string; disabled: boolean }) {
  const s = useSubmit();
  return (
    <Select aria-label={`Status of ${title}`} value={status} disabled={disabled || s.busy} className="h-8 w-32 text-xs" onChange={(x) => s.run(() => api(`/api/tasks/${id}`, { method: "PATCH", body: { status: x.target.value } }))}>
      <option value="TODO">To do</option><option value="IN_PROGRESS">In progress</option><option value="DONE">Done</option>
    </Select>
  );
}

export function DeleteTaskButton({ id, title }: { id: string; title: string }) {
  const s = useSubmit();
  return <Button size="sm" variant="ghost" aria-label={`Delete task ${title}`} loading={s.busy} onClick={() => s.run(() => api(`/api/tasks/${id}`, { method: "DELETE" }), "Task deleted.")}><Trash2 className="h-4 w-4" aria-hidden /></Button>;
}
