import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePageContext } from "@/server/auth/context";
import { can } from "@/server/policy";
import { listMembers, listAssignableManagers } from "@/server/services/members";
import { listDepartments, listTeams } from "@/server/services/structure";
import { listInvitations } from "@/server/services/invitations";
import { isEmailConfigured } from "@/server/email/mailer";
import { PageHeader } from "@/components/ui/states";
import { EmployeesManager } from "./employees-manager";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const ctx = await requirePageContext();
  if (!can(ctx, "member:list")) redirect("/dashboard");
  const isAdmin = can(ctx, "member:manage");
  const sp = await searchParams;

  const [members, teams, departments, managers, invitations] = await Promise.all([
    listMembers(ctx),
    listTeams(ctx),
    listDepartments(ctx),
    isAdmin ? listAssignableManagers(ctx) : [],
    isAdmin ? listInvitations(ctx) : [],
  ]);

  return (
    <>
      <PageHeader
        title="Employees"
        description={isAdmin ? "Invite people, assign teams and managers, and manage access." : "People on the teams you manage or have been granted."}
      />
      <EmployeesManager
        canManage={isAdmin}
        selfId={ctx.membershipId}
        members={members}
        teams={teams}
        departments={departments}
        managers={managers}
        invitations={invitations}
        emailConfigured={isEmailConfigured()}
        openInvite={sp.invite === "1"}
      />
    </>
  );
}
