import type { Role } from "@/generated/prisma/enums";

export type NavItem = { href: string; label: string; icon: "dashboard" | "users" | "settings" | "updates" | "team" };

/** Navigation mirrors server-side permissions; the pages and APIs enforce them independently. */
export function navFor(role: Role): NavItem[] {
  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/my-updates", label: "My Updates", icon: "updates" },
  ];
  if (role === "ADMIN" || role === "MANAGER") items.push({ href: "/team-updates", label: "Team Updates", icon: "team" });
  if (role === "ADMIN" || role === "MANAGER") items.push({ href: "/employees", label: "Employees", icon: "users" });
  if (role === "ADMIN") items.push({ href: "/settings", label: "Settings", icon: "settings" });
  return items;
}

export const ROLE_LABEL: Record<Role, string> = { ADMIN: "Admin", MANAGER: "Manager", EMPLOYEE: "Employee" };
