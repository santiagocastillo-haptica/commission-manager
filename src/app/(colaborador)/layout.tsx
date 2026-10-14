import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/server/auth";

/** Área de los colaboradores: solo lectura de sus propios datos. */
export default async function CollaboratorLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  return (
    <AppShell variant="collaborator" user={{ name: session.name, email: session.email }}>
      {children}
    </AppShell>
  );
}
