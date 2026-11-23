import { AppShell } from "@/components/layout/app-shell";
import { getSessionState, requirePageContext } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { canOpenTeamView } from "@/server/policy";
import { navFor, ROLE_LABEL } from "@/lib/nav";
import { automationsAccess } from "@/server/integrations/viasocket/access";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const state = (await getSessionState())!;
  const org = await prisma.organization.findFirst({ where: { id: ctx.organizationId }, select: { name: true } });
  const teamView = await canOpenTeamView(prisma, ctx);
  return (
    <AppShell
      items={navFor(ctx.role, { automations: (await automationsAccess(ctx)).allowed, teamView, orgChart: true, goals: true, compare: teamView })}
      orgName={org?.name ?? "Workspace"}
      user={{ name: state.userName, email: state.userEmail, roleLabel: ROLE_LABEL[ctx.role] }}
    >
      {children}
    </AppShell>
  );
}
