"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Network, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { timezoneOptions } from "@/lib/timezones";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorNotice } from "@/components/ui/states";
import { cn } from "@/lib/utils";

type Dept = { id: string; name: string; teamCount: number; memberCount: number };
type Team = { id: string; name: string; departmentId: string | null; departmentName: string | null; managerId: string | null; managerName: string | null; memberCount: number };
type Mgr = { id: string; name: string; role: string };
type Settings = { updateCutoffTime: string; editWindowHours: number; workingDays: number[]; aiEnabled: boolean };
type Tab = "organization" | "structure" | "schedule";

const TABS: { id: Tab; label: string }[] = [
  { id: "organization", label: "Organization" }, { id: "structure", label: "Departments & teams" }, { id: "schedule", label: "Update schedule" },
];

export function SettingsTabs(p: { initialTab: Tab; org: { name: string; timezone: string; logoUrl: string }; settings: Settings; departments: Dept[]; teams: Team[]; managers: Mgr[] }) {
  const [tab, setTab] = useState<Tab>(p.initialTab);
  return (
    <div>
      <div role="tablist" aria-label="Settings sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)}
            className={cn("-mb-px cursor-pointer whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium", tab === t.id ? "border-primary text-primary" : "border-transparent text-muted hover:text-foreground")}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "organization" && <OrganizationForm org={p.org} />}
        {tab === "structure" && <Structure departments={p.departments} teams={p.teams} managers={p.managers} />}
        {tab === "schedule" && <ScheduleForm settings={p.settings} />}
      </div>
    </div>
  );
}

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true); setError(null); setFields({});
    try { await fn(); toast.success(success); router.refresh(); return true; }
    catch (e) { if (e instanceof ApiError) { setFields(e.fields); setError(e.message); } else setError("Something went wrong."); return false; }
    finally { setBusy(false); }
  }
  return { busy, error, fields, run };
}

function OrganizationForm({ org }: { org: { name: string; timezone: string; logoUrl: string } }) {
  const s = useSave();
  const zones = timezoneOptions();
  const [v, setV] = useState(org);
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Organization profile" description="Shown to your team and in reports." />
      <CardBody>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); s.run(() => api("/api/organization", { method: "PATCH", body: { name: v.name, timezone: v.timezone, logoUrl: v.logoUrl } }), "Organization updated."); }}>
          {s.error && <ErrorNotice>{s.error}</ErrorNotice>}
          <Field label="Company name" htmlFor="o-name" error={s.fields.name}><Input id="o-name" value={v.name} required onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label="Timezone" htmlFor="o-tz" error={s.fields.timezone} hint="Daily cut-offs and weekly reports use this timezone."><Select id="o-tz" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</Select></Field>
          <Field label="Logo URL (optional)" htmlFor="o-logo" error={s.fields.logoUrl} hint="An https:// link to your logo image."><Input id="o-logo" type="url" value={v.logoUrl} placeholder="https://…" onChange={(e) => setV({ ...v, logoUrl: e.target.value })} /></Field>
          <Button type="submit" loading={s.busy}>Save changes</Button>
        </form>
      </CardBody>
    </Card>
  );
}

const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;

function ScheduleForm({ settings }: { settings: Settings }) {
  const s = useSave();
  const [v, setV] = useState(settings);
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Update schedule" description="When daily updates are expected and how long they stay editable." />
      <CardBody>
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); s.run(() => api("/api/organization/settings", { method: "PATCH", body: v }), "Settings saved."); }}>
          {s.error && <ErrorNotice>{s.error}</ErrorNotice>}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Working days</legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(([n, label]) => {
                const on = v.workingDays.includes(n);
                return (
                  <label key={n} className={cn("cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring", on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted")}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={(e) => setV({ ...v, workingDays: e.target.checked ? [...v.workingDays, n] : v.workingDays.filter((d) => d !== n) })} />{label}
                  </label>
                );
              })}
            </div>
            {s.fields.workingDays && <p role="alert" className="mt-1 text-xs text-danger">{s.fields.workingDays}</p>}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Daily cut-off time" htmlFor="s-cutoff" error={s.fields.updateCutoffTime} hint="Updates after this local time count as late."><Input id="s-cutoff" type="time" value={v.updateCutoffTime} required onChange={(e) => setV({ ...v, updateCutoffTime: e.target.value })} /></Field>
            <Field label="Edit window (hours)" htmlFor="s-edit" error={s.fields.editWindowHours} hint="How long after submitting an employee can edit. 0 = no edits."><Input id="s-edit" type="number" min={0} max={168} value={v.editWindowHours} onChange={(e) => setV({ ...v, editWindowHours: Number(e.target.value) })} /></Field>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
            <input type="checkbox" className="mt-1" checked={v.aiEnabled} onChange={(e) => setV({ ...v, aiEnabled: e.target.checked })} />
            <span><span className="text-sm font-medium">Enable AI summaries</span><span className="block text-xs text-muted">When on, submitted updates can be summarized by AI. Requires an AI provider configured on the server.</span></span>
          </label>
          <Button type="submit" loading={s.busy}>Save schedule</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Confirm({ open, title, body, onCancel, onConfirm, busy }: { open: boolean; title: string; body: string; onCancel: () => void; onConfirm: () => void; busy: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()} title={title} description={body}>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="danger" loading={busy} onClick={onConfirm}>Delete</Button></div>
    </Dialog>
  );
}

function Structure({ departments, teams, managers }: { departments: Dept[]; teams: Team[]; managers: Mgr[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Departments departments={departments} />
      <Teams teams={teams} departments={departments} managers={managers} />
    </div>
  );
}

function Departments({ departments }: { departments: Dept[] }) {
  const s = useSave();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Dept | null>(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<Dept | null>(null);
  return (
    <Card>
      <CardHeader title="Departments" description="Optional groupings such as Sales, Finance or Support." />
      <CardBody className="space-y-4">
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await s.run(() => api("/api/departments", { body: { name } }), "Department created.")) setName(""); }}>
          <Input aria-label="New department name" placeholder="New department" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          <Button type="submit" loading={s.busy}><Plus className="h-4 w-4" /> Add</Button>
        </form>
        {s.error && <ErrorNotice>{s.error}</ErrorNotice>}
      </CardBody>
      {departments.length === 0 ? <EmptyState icon={<Network className="h-5 w-5" />} title="No departments yet" description="Departments are optional. Add one to group your teams." /> : (
        <ul className="divide-y divide-border border-t border-border">
          {departments.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div><div className="font-medium">{d.name}</div><div className="text-xs text-muted">{d.teamCount} team{d.teamCount === 1 ? "" : "s"} · {d.memberCount} {d.memberCount === 1 ? "person" : "people"}</div></div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" aria-label={`Rename ${d.name}`} onClick={() => { setEditing(d); setEditName(d.name); }}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={`Delete ${d.name}`} onClick={() => setDeleting(d)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Rename department">
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (editing && await s.run(() => api(`/api/departments/${editing.id}`, { method: "PATCH", body: { name: editName } }), "Department renamed.")) setEditing(null); }}>
          {s.error && <ErrorNotice>{s.error}</ErrorNotice>}
          <Field label="Name" htmlFor="d-edit"><Input id="d-edit" value={editName} onChange={(e) => setEditName(e.target.value)} required autoFocus /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" loading={s.busy}>Save</Button></div>
        </form>
      </Dialog>
      <Confirm open={!!deleting} busy={s.busy} title={`Delete ${deleting?.name ?? ""}?`} body="This can't be undone. A department with teams or people can't be deleted." onCancel={() => setDeleting(null)}
        onConfirm={async () => { if (deleting && await s.run(() => api(`/api/departments/${deleting.id}`, { method: "DELETE" }), "Department deleted.")) setDeleting(null); }} />
    </Card>
  );
}

function Teams({ teams, departments, managers }: { teams: Team[]; departments: Dept[]; managers: Mgr[] }) {
  const s = useSave();
  const [open, setOpen] = useState<Team | "new" | null>(null);
  const [deleting, setDeleting] = useState<Team | null>(null);
  const editing = open && open !== "new" ? open : null;
  return (
    <Card>
      <CardHeader title="Teams" description="Teams have a manager and can belong to a department." action={<Button size="sm" onClick={() => setOpen("new")}><Plus className="h-4 w-4" /> Add team</Button>} />
      {teams.length === 0 ? <EmptyState icon={<Network className="h-5 w-5" />} title="No teams yet" description="Create a team, then assign a manager and people to it." /> : (
        <ul className="divide-y divide-border">
          {teams.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div><div className="font-medium">{t.name}</div><div className="text-xs text-muted">{[t.departmentName, t.managerName ? `Managed by ${t.managerName}` : "No manager", `${t.memberCount} ${t.memberCount === 1 ? "person" : "people"}`].filter(Boolean).join(" · ")}</div></div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setOpen(t)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)} title={editing ? "Edit team" : "New team"}>
        <form key={editing?.id ?? "new"} className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const body = { name: String(f.get("name")), departmentId: String(f.get("departmentId")) || null, managerId: String(f.get("managerId")) || null };
          const ok = await s.run(() => editing ? api(`/api/teams/${editing.id}`, { method: "PATCH", body }) : api("/api/teams", { body }), editing ? "Team updated." : "Team created.");
          if (ok) setOpen(null);
        }}>
          {s.error && <ErrorNotice>{s.error}</ErrorNotice>}
          <Field label="Team name" htmlFor="t-name" error={s.fields.name}><Input id="t-name" name="name" defaultValue={editing?.name ?? ""} required autoFocus maxLength={80} /></Field>
          <Field label="Department" htmlFor="t-dept"><Select id="t-dept" name="departmentId" defaultValue={editing?.departmentId ?? ""}><option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Team manager" htmlFor="t-mgr" hint="Managers see everyone on the teams they manage."><Select id="t-mgr" name="managerId" defaultValue={editing?.managerId ?? ""}><option value="">No manager</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(null)}>Cancel</Button><Button type="submit" loading={s.busy}>{editing ? "Save" : "Create team"}</Button></div>
        </form>
      </Dialog>
      <Confirm open={!!deleting} busy={s.busy} title={`Delete ${deleting?.name ?? ""}?`} body="This can't be undone. A team that still has members can't be deleted." onCancel={() => setDeleting(null)}
        onConfirm={async () => { if (deleting && await s.run(() => api(`/api/teams/${deleting.id}`, { method: "DELETE" }), "Team deleted.")) setDeleting(null); }} />
    </Card>
  );
}
