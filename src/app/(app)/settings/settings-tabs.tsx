"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Network, Pencil, Plus, Trash2 } from "lucide-react";
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
type Scope = "OWN" | "TEAM" | "DEPARTMENT" | "COMPANY";
type Settings = { updateCutoffTime: string; editWindowHours: number; workingDays: number[]; aiEnabled: boolean; visibilityScope: Scope; peersSeeBlockers: boolean; reminderEnabled: boolean; reminderTime: string };
type Tab = "organization" | "structure" | "schedule" | "visibility";

const TABS: { id: Tab; label: string }[] = [
  { id: "organization", label: "Organization" }, { id: "structure", label: "Departments & teams" }, { id: "schedule", label: "Update schedule" }, { id: "visibility", label: "Visibility" },
];

export function SettingsTabs(p: { initialTab: Tab; org: { name: string; timezone: string; logoUrl: string }; settings: Settings; aiConfigured: boolean; departments: Dept[]; teams: Team[]; managers: Mgr[] }) {
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
        {tab === "schedule" && <ScheduleForm settings={p.settings} aiConfigured={p.aiConfigured} />}
        {tab === "visibility" && <VisibilityForm settings={p.settings} />}
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

function AiTest() {
  const [state, setState] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: false });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" size="sm" loading={state.busy} onClick={async () => {
        setState({ busy: true, msg: null, ok: false });
        try {
          const r = await api<{ ok: boolean; provider?: string; model?: string; ms?: number; reason?: string }>("/api/ai/test", { method: "POST", body: {} });
          setState({ busy: false, ok: r.ok, msg: r.ok ? `Connected to ${r.provider} (${r.model}) in ${r.ms} ms.` : r.reason === "NOT_CONFIGURED" ? "No AI key is configured on the server yet." : `The provider answered with a problem (${(r.reason ?? "error").toLowerCase().replace("_", " ")}).` });
        } catch (e) { setState({ busy: false, ok: false, msg: e instanceof ApiError ? e.message : "Couldn't run the test." }); }
      }}>Test AI connection</Button>
      {state.msg && <span role="status" className={`text-xs ${state.ok ? "text-success" : "text-danger"}`}>{state.msg}</span>}
    </div>
  );
}

function ScheduleForm({ settings, aiConfigured }: { settings: Settings; aiConfigured: boolean }) {
  const s = useSave();
  const [v, setV] = useState(settings);
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Update schedule" description="When daily updates are expected and how long they stay editable." />
      <CardBody>
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); s.run(() => api("/api/organization/settings", { method: "PATCH", body: { updateCutoffTime: v.updateCutoffTime, editWindowHours: v.editWindowHours, workingDays: v.workingDays, aiEnabled: v.aiEnabled, reminderEnabled: v.reminderEnabled, reminderTime: v.reminderTime } }), "Settings saved."); }}>
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
          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">Daily reminder</legend>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1" checked={v.reminderEnabled} onChange={(e) => setV({ ...v, reminderEnabled: e.target.checked })} />
              <span><span className="text-sm font-medium">Remind people who haven&apos;t submitted</span><span className="block text-xs text-muted">On working days, at the time below (your organization&apos;s timezone), each person without an update gets a reminder. It&apos;s sent through your viaSocket automations: link one to <strong>Daily Update Reminder</strong> on the Automations page (Slack, email, anything viaSocket supports).</span></span>
            </label>
            {v.reminderEnabled && (
              <Field label="Reminder time" htmlFor="s-remind" error={s.fields.reminderTime} hint="Must be earlier than the cut-off. After the cut-off, the “Daily Update Missing” event takes over."><Input id="s-remind" type="time" value={v.reminderTime} required className="max-w-40" onChange={(e) => setV({ ...v, reminderTime: e.target.value })} /></Field>
            )}
          </fieldset>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
            <input type="checkbox" className="mt-1" checked={v.aiEnabled} onChange={(e) => setV({ ...v, aiEnabled: e.target.checked })} />
            <span><span className="text-sm font-medium">Enable AI summaries and weekly reports</span><span className="block text-xs text-muted">When on, the text of submitted updates and your goal progress are sent to an outside AI provider to write short summaries and weekly reports. Nothing is published until a manager reviews it, and everything is labelled as AI-generated and unverified. By turning this on you agree on behalf of your organization, so tell your team first.</span></span>
          </label>
          {v.aiEnabled && (
            <div className="space-y-2 rounded-lg bg-surface-muted p-3">
              <p className="text-xs text-muted">{aiConfigured ? "An AI provider key is configured on the server." : "No AI provider key is configured on the server yet, so nothing is sent. Add ANTHROPIC_API_KEY (or OPENAI_API_KEY) to the server environment."}</p>
              {aiConfigured && <AiTest />}
            </div>
          )}
          <Button type="submit" loading={s.busy}>Save schedule</Button>
        </form>
      </CardBody>
    </Card>
  );
}

const SCOPES: { id: Scope; title: string; text: string }[] = [
  { id: "OWN", title: "Private to reporting lines", text: "People see only their own updates. Managers see everyone who reports to them, at any depth." },
  { id: "TEAM", title: "Team peers", text: "Everyone can also read updates from people on their team or with the same manager." },
  { id: "DEPARTMENT", title: "Department", text: "Everyone can also read updates from people in their department." },
  { id: "COMPANY", title: "Whole company", text: "Everyone can read everyone's submitted updates, all the way up to the CEO. Maximum transparency." },
];

function VisibilityForm({ settings }: { settings: Settings }) {
  const s = useSave();
  const [scope, setScope] = useState<Scope>(settings.visibilityScope);
  const [blockers, setBlockers] = useState(settings.peersSeeBlockers);
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Who can see updates" description="Decide how open work updates are across your company." />
      <CardBody>
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); s.run(() => api("/api/organization/settings", { method: "PATCH", body: { visibilityScope: scope, peersSeeBlockers: blockers } }), "Visibility saved."); }}>
          {s.error && <ErrorNotice>{s.error}</ErrorNotice>}
          <fieldset className="space-y-2">
            <legend className="sr-only">Visibility level</legend>
            {SCOPES.map((o) => (
              <label key={o.id} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors", scope === o.id ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-muted")}>
                <input type="radio" name="scope" className="mt-1" checked={scope === o.id} onChange={() => setScope(o.id)} />
                <span><span className="text-sm font-medium">{o.title}</span><span className="block text-xs text-muted">{o.text}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
            <input type="checkbox" className="mt-1" checked={blockers} onChange={(e) => setBlockers(e.target.checked)} />
            <span><span className="text-sm font-medium">Let colleagues see blockers</span><span className="block text-xs text-muted">Off by default. Managers always see blockers for the people they manage; this only decides whether peers can too.</span></span>
          </label>
          {scope !== "OWN" && (
            <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-xs text-warning"><Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Opening visibility lets people read their colleagues&apos; submitted updates. Tell your team before you change this. Updates remain each person&apos;s own report and are not independently verified.</p>
          )}
          <Button type="submit" loading={s.busy}>Save visibility</Button>
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
