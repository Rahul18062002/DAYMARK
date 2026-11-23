import type { Role } from "@/generated/prisma/enums";

export type NavIcon = "dashboard" | "users" | "settings" | "updates" | "team" | "automations" | "goals" | "orgchart" | "compare" | "backup" | "reports";
export type NavItem = { href: string; label: string; icon: NavIcon; group: "Work" | "Goals" | "People" | "Admin" };

/** Navigation mirrors server-side permissions; the pages and APIs enforce them independently. */
export function navFor(role: Role, opts: { automations?: boolean; teamView?: boolean; goals?: boolean; orgChart?: boolean; compare?: boolean } = {}): NavItem[] {
  const manager = role === "ADMIN" || role === "MANAGER";
  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard", group: "Work" },
    { href: "/my-updates", label: "My Updates", icon: "updates", group: "Work" },
  ];
  if (manager || opts.teamView) items.push({ href: "/team-updates", label: manager ? "Team Updates" : "Colleagues", icon: "team", group: "Work" });
  items.push({ href: "/reports", label: "Reports", icon: "reports", group: "Work" });
  if (opts.goals) items.push({ href: "/goals", label: "Goals", icon: "goals", group: "Goals" });
  if (opts.orgChart) items.push({ href: "/org-chart", label: "Org chart", icon: "orgchart", group: "People" });
  if (opts.compare) items.push({ href: "/compare", label: "Compare", icon: "compare", group: "People" });
  if (manager) items.push({ href: "/employees", label: "Employees", icon: "users", group: "People" });
  if (opts.automations) items.push({ href: "/automations", label: "Automations", icon: "automations", group: "Admin" });
  if (role === "ADMIN") items.push({ href: "/settings", label: "Settings", icon: "settings", group: "Admin" });
  return items;
}

export const ROLE_LABEL: Record<Role, string> = { ADMIN: "Admin", MANAGER: "Manager", EMPLOYEE: "Employee" };
