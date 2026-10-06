import { AppShell } from "@/components/app-shell";
import { requireSession } from "@/server/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  return <AppShell user={{ name: session.name, email: session.email }}>{children}</AppShell>;
}
