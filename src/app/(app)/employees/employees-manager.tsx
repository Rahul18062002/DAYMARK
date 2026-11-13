"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Mail, Pencil, RefreshCw, Search, UserPlus, Users, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState, ErrorNotice, InfoNotice } from "@/components/ui/states";
import type { MemberDto } from "@/server/services/members";
import type { InvitationDto } from "@/server/services/invitations";

type Team = { id: string; name: string; departmentId: string | null; departmentName: string | null };
type Dept = { id: string; name: string };
type Mgr = { id: string; name: string; role: string };
type Props = {
  canManage: boolean; selfId: string; members: MemberDto[]; teams: Team[]; departments: Dept[]; managers: Mgr[];
  invitations: InvitationDto[]; emailConfigured: boolean; openInvite: boolean;
};

const ROLE_LABEL = { ADMIN: "Admin", MANAGER: "Manager", EMPLOYEE: "Employee" } as const;
const roleTone = { ADMIN: "primary", MANAGER: "warning", EMPLOYEE: "neutral" } as const;

export function EmployeesManager(p: Props) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [role, setRole] = useState("");
  const [teamId, setTeamId] = useState("");
  const [inviteOpen, setInviteOpen] = useState(p.openInvite && p.canManage);
  const [editing, setEditing] = useState<MemberDto | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return p.members.filter((m) =>
      (!status || m.status === status) && (!role || m.role === role) && (!teamId || m.teamId === teamId) &&
      (!needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle)),
    );
  }, [p.members, q, status, role, teamId]);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label="Search people" placeholder="Search by name or email" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select aria-label="Filter by status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ACTIVE">Active</option><option value="DEACTIVATED">Deactivated</option><option value="">All statuses</option>
          </Select>
          <Select aria-label="Filter by role" className="w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All roles</option><option value="ADMIN">Admin</option><option value="MANAGER">Manager</option><option value="EMPLOYEE">Employee</option>
          </Select>
          <Select aria-label="Filter by team" className="w-auto" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">All teams</option>{p.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          {p.canManage && <Button onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4" /> Invite</Button>}
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />}
            title={p.members.length === 0 ? "No people yet" : "No one matches these filters"}
            description={p.members.length === 0 ? (p.canManage ? "Invite your first employee to get started." : "Once your admin assigns people to your teams, they'll appear here.") : "Try clearing a filter."}
            action={p.canManage && p.members.length === 0 ? <Button onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4" /> Invite someone</Button> : undefined} />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <tr><th className="px-5 py-3 font-medium">Person</th><th className="px-3 py-3 font-medium">Role</th><th className="px-3 py-3 font-medium">Team</th><th className="px-3 py-3 font-medium">Manager</th><th className="px-3 py-3 font-medium">Status</th>{p.canManage && <th className="w-12 px-3 py-3"><span className="sr-only">Actions</span></th>}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((m) => (
                  <tr key={m.id} className="hover:bg-surface-muted/50">
                    <td className="px-5 py-3"><div className="font-medium">{m.name}{m.id === p.selfId && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}</div><div className="text-xs text-muted">{m.jobTitle ? `${m.jobTitle} · ` : ""}{m.email}</div></td>
                    <td className="px-3 py-3"><Badge tone={roleTone[m.role]}>{ROLE_LABEL[m.role]}</Badge></td>
                    <td className="px-3 py-3">{m.teamName ?? <span className="text-muted">—</span>}{m.departmentName && <div className="text-xs text-muted">{m.departmentName}</div>}</td>
                    <td className="px-3 py-3">{m.managerName ?? <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-3"><Badge tone={m.status === "ACTIVE" ? "success" : "danger"}>{m.status === "ACTIVE" ? "Active" : "Deactivated"}</Badge></td>
                    {p.canManage && <td className="px-3 py-3 text-right"><Button size="icon" variant="ghost" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}><Pencil className="h-4 w-4" /></Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {p.canManage && <PendingInvitations invitations={p.invitations} emailConfigured={p.emailConfigured} />}
      {p.canManage && <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} {...p} />}
      {p.canManage && editing && <EditDialog member={editing} onClose={() => setEditing(null)} {...p} />}
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  return (
    <div className="flex gap-2">
      <Input readOnly value={url} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
      <Button variant="secondary" onClick={async () => { await navigator.clipboard.writeText(url); toast.success("Invitation link copied"); }}><Copy className="h-4 w-4" /> Copy</Button>
    </div>
  );
}

function PendingInvitations({ invitations, emailConfigured }: { invitations: InvitationDto[]; emailConfigured: boolean }) {
  const router = useRouter();
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (invitations.length === 0) return null;

  async function resend(i: InvitationDto) {
    setBusyId(i.id);
    try {
      const r = await api<{ inviteUrl: string; emailSent: boolean }>(`/api/invitations/${i.id}/resend`, { method: "POST", body: {} });
      if (r.emailSent) toast.success(`Invitation re-sent to ${i.email}`); else setLink({ email: i.email, url: r.inviteUrl });
      router.refresh();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't resend"); } finally { setBusyId(null); }
  }
  async function revoke(i: InvitationDto) {
    setBusyId(i.id);
    try { await api(`/api/invitations/${i.id}`, { method: "DELETE" }); toast.success("Invitation revoked"); router.refresh(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : "Couldn't revoke"); } finally { setBusyId(null); }
  }

  return (
    <Card>
      <CardHeader title="Pending invitations" description={emailConfigured ? "Resending issues a fresh link and emails it." : "Email isn't configured — resending gives you a new link to share yourself."} />
      {link && (
        <div className="space-y-2 border-b border-border bg-surface-muted/50 p-4">
          <p className="text-sm">New link for <strong>{link.email}</strong> (the previous link no longer works):</p>
          <CopyLink url={link.url} />
        </div>
      )}
      <ul className="divide-y divide-border">
        {invitations.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
            <div className="min-w-0"><div className="flex items-center gap-2 font-medium"><Mail className="h-4 w-4 text-muted" aria-hidden /><span className="truncate">{i.email}</span><Badge tone={roleTone[i.role]}>{ROLE_LABEL[i.role]}</Badge>{i.expired && <Badge tone="warning">Expired</Badge>}</div>
              <div className="text-xs text-muted">Expires {new Date(i.expiresAt).toLocaleDateString()}</div></div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" loading={busyId === i.id} onClick={() => resend(i)}><RefreshCw className="h-3.5 w-3.5" /> Resend</Button>
              <Button size="sm" variant="ghost" disabled={busyId === i.id} onClick={() => revoke(i)}><X className="h-3.5 w-3.5" /> Revoke</Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function InviteDialog({ open, onClose, teams, managers, departments, emailConfigured }: Props & { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ email: string; url: string; emailSent: boolean; emailError?: string } | null>(null);

  function close() { setResult(null); setError(null); setFields({}); onClose(); }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setFields({});
    const f = new FormData(e.currentTarget);
    const body = {
      email: String(f.get("email")), role: String(f.get("role")),
      teamId: String(f.get("teamId")) || null, departmentId: String(f.get("departmentId")) || null, managerId: String(f.get("managerId")) || null,
    };
    try {
      const r = await api<{ inviteUrl: string; emailSent: boolean; emailError?: string }>("/api/invitations", { body });
      router.refresh();
      if (r.emailSent) { toast.success(`Invitation emailed to ${body.email.trim().toLowerCase()}`); close(); }
      else setResult({ email: body.email.trim().toLowerCase(), url: r.inviteUrl, emailSent: false, emailError: r.emailError });
    } catch (err) {
      if (err instanceof ApiError) { setFields(err.fields); setError(Object.keys(err.fields).length ? null : err.message); } else setError("Something went wrong.");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} title={result ? "Invitation created" : "Invite someone"}
      description={result ? undefined : "They'll get a link to set their password and join your workspace."}>
      {result ? (
        <div className="space-y-4">
          <InfoNotice>{emailConfigured ? `The email to ${result.email} couldn't be delivered${result.emailError ? ` (${result.emailError})` : ""}.` : "Email isn't configured for this workspace."} Copy this link and send it to <strong className="text-foreground">{result.email}</strong> yourself. It's valid for 7 days and shown only once.</InfoNotice>
          <CopyLink url={result.url} />
          <Button className="w-full" variant="secondary" onClick={close}>Done</Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <Field label="Email" htmlFor="inv-email" error={fields.email}><Input id="inv-email" name="email" type="email" required autoFocus placeholder="name@company.com" aria-invalid={!!fields.email} /></Field>
          <Field label="Role" htmlFor="inv-role" hint="Admins manage the workspace; managers review their teams; employees submit updates.">
            <Select id="inv-role" name="role" defaultValue="EMPLOYEE"><option value="EMPLOYEE">Employee</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Team (optional)" htmlFor="inv-team"><Select id="inv-team" name="teamId"><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            <Field label="Department (optional)" htmlFor="inv-dept" hint="Follows the team if it has one."><Select id="inv-dept" name="departmentId"><option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          </div>
          <Field label="Manager (optional)" htmlFor="inv-mgr"><Select id="inv-mgr" name="managerId"><option value="">No manager</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button type="submit" loading={busy}>Send invitation</Button></div>
        </form>
      )}
    </Dialog>
  );
}

function EditDialog({ member, onClose, teams, managers, departments, selfId }: Props & { member: MemberDto; onClose: () => void }) {
  const router = useRouter();
  const isSelf = member.id === selfId;
  const [role, setRole] = useState<string>(member.role);
  const [teamId, setTeamId] = useState(member.teamId ?? "");
  const [departmentId, setDepartmentId] = useState(member.departmentId ?? "");
  const [managerId, setManagerId] = useState(member.managerId ?? "");
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? "");
  const [access, setAccess] = useState<string[]>(member.accessTeamIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamDept = teams.find((t) => t.id === teamId)?.departmentName ?? null;

  async function save(patch: Record<string, unknown>, success: string) {
    setBusy(true); setError(null);
    try {
      const r = await api<{ unassigned?: { teams: number; reports: number } }>(`/api/employees/${member.id}`, { method: "PATCH", body: patch });
      const u = r.unassigned;
      toast.success(u && (u.teams || u.reports) ? `${success} ${u.teams} team(s) and ${u.reports} report(s) were unassigned.` : success);
      router.refresh(); onClose();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't save changes."); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={member.name} description={member.email}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save({ role, jobTitle: jobTitle || null, teamId: teamId || null, departmentId: departmentId || null, managerId: managerId || null, accessTeamIds: role === "MANAGER" ? access : undefined }, "Changes saved."); }}>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {isSelf && <InfoNotice>You can&apos;t change your own role or deactivate your own account.</InfoNotice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role" htmlFor="e-role"><Select id="e-role" value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value)}><option value="EMPLOYEE">Employee</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></Select></Field>
          <Field label="Job title" htmlFor="e-title"><Input id="e-title" value={jobTitle} maxLength={100} onChange={(e) => setJobTitle(e.target.value)} /></Field>
          <Field label="Team" htmlFor="e-team"><Select id="e-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Department" htmlFor="e-dept" hint={teamDept ? `Set by the team (${teamDept}).` : undefined}>
            <Select id="e-dept" value={teamDept ? (teams.find((t) => t.id === teamId)?.departmentId ?? "") : departmentId} disabled={!!teamDept} onChange={(e) => setDepartmentId(e.target.value)}><option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          </Field>
        </div>
        <Field label="Manager" htmlFor="e-mgr"><Select id="e-mgr" value={managerId} onChange={(e) => setManagerId(e.target.value)}><option value="">No manager</option>{managers.filter((m) => m.id !== member.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>

        {role === "MANAGER" && teams.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Additional team access</legend>
            <p className="text-xs text-muted">Managers always see teams they manage. Tick teams they may also view.</p>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {teams.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-muted">
                  <input type="checkbox" checked={access.includes(t.id)} onChange={(e) => setAccess((a) => e.target.checked ? [...a, t.id] : a.filter((x) => x !== t.id))} /> {t.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          {!isSelf ? (
            member.status === "ACTIVE"
              ? <Button type="button" variant="danger" disabled={busy} onClick={() => save({ status: "DEACTIVATED" }, `${member.name} was deactivated and signed out.`)}>Deactivate</Button>
              : <Button type="button" variant="secondary" disabled={busy} onClick={() => save({ status: "ACTIVE" }, `${member.name} was reactivated.`)}>Reactivate</Button>
          ) : <span />}
          <div className="flex gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save changes</Button></div>
        </div>
      </form>
    </Dialog>
  );
}
