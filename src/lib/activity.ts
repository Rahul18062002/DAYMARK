const LABELS: Record<string, string> = {
  "organization.created": "created the workspace",
  "organization.updated": "updated organization details",
  "settings.updated": "updated update settings",
  "department.created": "created a department",
  "department.renamed": "renamed a department",
  "department.deleted": "deleted a department",
  "team.created": "created a team",
  "team.updated": "updated a team",
  "team.deleted": "deleted a team",
  "invitation.created": "invited someone",
  "invitation.resent": "resent an invitation",
  "invitation.revoked": "revoked an invitation",
  "invitation.accepted": "joined the workspace",
  "member.updated": "updated a person's details",
  "member.deactivated": "deactivated an account",
  "member.reactivated": "reactivated an account",
};

export function describeActivity(action: string, metadata?: Record<string, unknown> | null): string {
  const base = LABELS[action] ?? action;
  const name = metadata && typeof metadata.name === "string" ? metadata.name : null;
  const email = metadata && typeof metadata.email === "string" ? metadata.email : null;
  const detail = name ?? email;
  return detail ? `${base} (${detail})` : base;
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
